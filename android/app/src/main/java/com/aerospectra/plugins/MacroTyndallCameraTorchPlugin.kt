package com.aerospectra.plugins

import android.Manifest
import android.content.Context
import android.graphics.ImageFormat
import android.hardware.camera2.CameraAccessException
import android.hardware.camera2.CameraCaptureSession
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraDevice
import android.hardware.camera2.CameraManager
import android.hardware.camera2.CaptureRequest
import android.media.ImageReader
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import com.getcapacitor.JSObject
import com.getcapacitor.PermissionState
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission

/** Camera2 manual capture controller for a short-range, dark-field aerosol sampling zone. */
@CapacitorPlugin(
    name = "MacroTyndallCameraTorch",
    permissions = [Permission(alias = "camera", strings = [Manifest.permission.CAMERA])]
)
class MacroTyndallCameraTorchPlugin : Plugin() {
    private var cameraDevice: CameraDevice? = null
    private var captureSession: CameraCaptureSession? = null
    private var imageReader: ImageReader? = null
    private var selectedCameraId: String? = null
    private var torchEnabled = false
    private var lastFrameEventMs = 0L
    private val mainHandler = Handler(Looper.getMainLooper())

    @PluginMethod
    fun getCapabilities(call: PluginCall) {
        try {
            val manager = context.getSystemService(Context.CAMERA_SERVICE) as CameraManager
            val backId = manager.cameraIdList.firstOrNull { id ->
                manager.getCameraCharacteristics(id).get(CameraCharacteristics.LENS_FACING) == CameraCharacteristics.LENS_FACING_BACK
            }
            if (backId == null) {
                call.resolve(JSObject().put("available", false).put("reason", "No rear camera found"))
                return
            }
            selectedCameraId = backId
            val info = manager.getCameraCharacteristics(backId)
            val maxFocus = info.get(CameraCharacteristics.LENS_INFO_MINIMUM_FOCUS_DISTANCE) ?: 0f
            val manualSensor = info.get(CameraCharacteristics.REQUEST_AVAILABLE_CAPABILITIES)
                ?.contains(CameraCharacteristics.REQUEST_AVAILABLE_CAPABILITIES_MANUAL_SENSOR) ?: false
            call.resolve(JSObject()
                .put("available", true)
                .put("cameraId", backId)
                .put("manualFocus", maxFocus > 0f)
                .put("maxFocusDiopters", maxFocus.toDouble())
                .put("manualExposure", manualSensor)
                .put("torch", info.get(CameraCharacteristics.FLASH_INFO_AVAILABLE) == true)
                .put("apiLevel", Build.VERSION.SDK_INT))
        } catch (error: Exception) {
            call.reject("Unable to query Camera2 capabilities", error)
        }
    }

    @PluginMethod
    fun startManualCapture(call: PluginCall) {
        if (getPermissionState("camera") != PermissionState.GRANTED) {
            requestPermissionForAlias("camera", call, "cameraPermissionResult")
            return
        }
        openManualSession(call)
    }

    @com.getcapacitor.annotation.PermissionCallback
    private fun cameraPermissionResult(call: PluginCall) {
        if (getPermissionState("camera") == PermissionState.GRANTED) openManualSession(call)
        else call.reject("Camera permission is required for native macro capture")
    }

    private fun openManualSession(call: PluginCall) {
        try {
            stopSession()
            val manager = context.getSystemService(Context.CAMERA_SERVICE) as CameraManager
            val cameraId = manager.cameraIdList.firstOrNull { id ->
                manager.getCameraCharacteristics(id).get(CameraCharacteristics.LENS_FACING) == CameraCharacteristics.LENS_FACING_BACK
            } ?: run { call.reject("No rear camera available"); return }
            selectedCameraId = cameraId
            val characteristics = manager.getCameraCharacteristics(cameraId)
            val maxFocus = characteristics.get(CameraCharacteristics.LENS_INFO_MINIMUM_FOCUS_DISTANCE) ?: 0f
            val manualSensor = characteristics.get(CameraCharacteristics.REQUEST_AVAILABLE_CAPABILITIES)
                ?.contains(CameraCharacteristics.REQUEST_AVAILABLE_CAPABILITIES_MANUAL_SENSOR) ?: false
            val requestedFocus = call.getFloat("focusDiopters") ?: minOf(12f, maxFocus)
            val focus = requestedFocus.coerceIn(0f, maxFocus)
            val sensitivityRange = characteristics.get(CameraCharacteristics.SENSOR_INFO_SENSITIVITY_RANGE)
            val requestedIso = call.getInt("iso") ?: 640
            val iso = requestedIso.coerceIn(sensitivityRange?.lower ?: 100, sensitivityRange?.upper ?: 1600)
            val exposureRange = characteristics.get(CameraCharacteristics.SENSOR_INFO_EXPOSURE_TIME_RANGE)
            val requestedExposure = call.getLong("exposureTimeNs") ?: 5_000_000L
            val exposureNs = requestedExposure.coerceIn(exposureRange?.lower ?: 100_000L, exposureRange?.upper ?: 100_000_000L)
            val size = characteristics.get(CameraCharacteristics.SCALER_STREAM_CONFIGURATION_MAP)
                ?.getOutputSizes(ImageFormat.YUV_420_888)
                ?.firstOrNull { it.width <= 1280 } ?: android.util.Size(640, 480)
            imageReader = ImageReader.newInstance(size.width, size.height, ImageFormat.YUV_420_888, 2).apply {
                setOnImageAvailableListener({ reader ->
                    val image = reader.acquireLatestImage() ?: return@setOnImageAvailableListener
                    try {
                        val now = SystemClock.elapsedRealtime()
                        if (now - lastFrameEventMs >= 1000L) {
                            val plane = image.planes.firstOrNull()
                            if (plane != null) {
                                val bytes = plane.buffer
                                val stepX = maxOf(1, image.width / 48)
                                val stepY = maxOf(1, image.height / 36)
                                var sum = 0L
                                var bright = 0
                                var samples = 0
                                for (y in 0 until image.height step stepY) {
                                    for (x in 0 until image.width step stepX) {
                                        val index = y * plane.rowStride + x * plane.pixelStride
                                        if (index < bytes.limit()) {
                                            val luma = bytes.get(index).toInt() and 0xff
                                            sum += luma
                                            if (luma >= 220) bright++
                                            samples++
                                        }
                                    }
                                }
                                if (samples > 0) {
                                    notifyListeners("cameraFrame", JSObject()
                                        .put("meanLuma", sum.toDouble() / samples / 255.0)
                                        .put("brightPixelFraction", bright.toDouble() / samples)
                                        .put("width", image.width).put("height", image.height)
                                        .put("timestampMs", now))
                                    lastFrameEventMs = now
                                }
                            }
                        }
                    } catch (error: Exception) {
                        android.util.Log.w("AeroSpectraCamera", "Unable to summarize camera luma frame", error)
                    } finally { image.close() }
                }, mainHandler)
            }
            manager.openCamera(cameraId, object : CameraDevice.StateCallback() {
                override fun onOpened(device: CameraDevice) {
                    cameraDevice = device
                    val target = imageReader?.surface
                    if (target == null) { call.reject("Camera frame surface unavailable"); stopSession(); return }
                    try {
                        device.createCaptureSession(listOf(target), object : CameraCaptureSession.StateCallback() {
                            override fun onConfigured(session: CameraCaptureSession) {
                                captureSession = session
                                try {
                                    val request = device.createCaptureRequest(CameraDevice.TEMPLATE_PREVIEW).apply {
                                        addTarget(target)
                                        set(CaptureRequest.CONTROL_MODE, CaptureRequest.CONTROL_MODE_AUTO)
                                        set(CaptureRequest.CONTROL_AF_MODE, if (maxFocus > 0f) CaptureRequest.CONTROL_AF_MODE_OFF else CaptureRequest.CONTROL_AF_MODE_CONTINUOUS_PICTURE)
                                        if (maxFocus > 0f) set(CaptureRequest.LENS_FOCUS_DISTANCE, focus)
                                        if (manualSensor) {
                                            set(CaptureRequest.CONTROL_AE_MODE, CaptureRequest.CONTROL_AE_MODE_OFF)
                                            set(CaptureRequest.SENSOR_SENSITIVITY, iso)
                                            set(CaptureRequest.SENSOR_EXPOSURE_TIME, exposureNs)
                                        } else set(CaptureRequest.CONTROL_AE_MODE, CaptureRequest.CONTROL_AE_MODE_ON)
                                        set(CaptureRequest.CONTROL_AWB_MODE, CaptureRequest.CONTROL_AWB_MODE_AUTO)
                                    }.build()
                                    session.setRepeatingRequest(request, null, mainHandler)
                                    call.resolve(JSObject().put("started", true).put("cameraId", cameraId)
                                        .put("focusDiopters", focus.toDouble()).put("iso", iso).put("exposureTimeNs", exposureNs))
                                } catch (error: Exception) {
                                    call.reject("Camera2 manual request failed", error)
                                    stopSession()
                                }
                            }
                            override fun onConfigureFailed(session: CameraCaptureSession) {
                                call.reject("Camera2 could not configure its capture session")
                                stopSession()
                            }
                        }, mainHandler)
                    } catch (error: Exception) { call.reject("Unable to configure Camera2 session", error); stopSession() }
                }
                override fun onDisconnected(device: CameraDevice) { device.close(); cameraDevice = null; call.reject("Camera disconnected") }
                override fun onError(device: CameraDevice, error: Int) { device.close(); cameraDevice = null; call.reject("Camera2 failed with code $error") }
            }, mainHandler)
        } catch (error: SecurityException) { call.reject("Camera permission is required", error) }
        catch (error: CameraAccessException) { call.reject("Camera2 access failed", error) }
        catch (error: Exception) { call.reject("Unable to start manual camera capture", error) }
    }

    @PluginMethod
    fun setTorch(call: PluginCall) {
        val enable = call.getBoolean("enabled") ?: false
        val cameraId = selectedCameraId ?: call.getString("cameraId")
        if (cameraId.isNullOrBlank()) { call.reject("Query capabilities or start Camera2 before controlling the torch"); return }
        try {
            val manager = context.getSystemService(Context.CAMERA_SERVICE) as CameraManager
            val strength = call.getInt("strength") ?: 0
            if (enable && Build.VERSION.SDK_INT >= 33 && strength > 0) {
                manager.turnOnTorchWithStrengthLevel(cameraId, strength)
            } else manager.setTorchMode(cameraId, enable)
            torchEnabled = enable
            call.resolve(JSObject().put("enabled", enable).put("cameraId", cameraId))
        } catch (error: Exception) { call.reject("Unable to update LED torch", error) }
    }

    @PluginMethod
    fun stopManualCapture(call: PluginCall) {
        val wasEnabled = torchEnabled
        stopSession()
        call.resolve(JSObject().put("stopped", true).put("torchWasEnabled", wasEnabled))
    }

    override fun handleOnDestroy() {
        stopSession()
        super.handleOnDestroy()
    }

    private fun stopSession() {
        if (torchEnabled && !selectedCameraId.isNullOrBlank()) {
            try { (context.getSystemService(Context.CAMERA_SERVICE) as CameraManager).setTorchMode(selectedCameraId!!, false) } catch (_: Exception) { }
        }
        torchEnabled = false
        try { captureSession?.stopRepeating() } catch (_: Exception) { }
        try { captureSession?.close() } catch (_: Exception) { }
        captureSession = null
        try { cameraDevice?.close() } catch (_: Exception) { }
        cameraDevice = null
        try { imageReader?.close() } catch (_: Exception) { }
        imageReader = null
    }
}
