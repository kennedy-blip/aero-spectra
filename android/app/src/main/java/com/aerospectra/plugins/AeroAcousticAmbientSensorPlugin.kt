package com.aerospectra.plugins

import android.Manifest
import android.content.Context
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import android.os.Build
import android.os.SystemClock
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.PermissionState
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import kotlin.math.max
import kotlin.math.sqrt

/** 48 kHz local acoustic level frames plus available barometer/temperature/humidity sensors. */
@CapacitorPlugin(
    name = "AeroAcousticAmbientSensor",
    permissions = [Permission(alias = "microphone", strings = [Manifest.permission.RECORD_AUDIO])]
)
class AeroAcousticAmbientSensorPlugin : Plugin(), SensorEventListener {
    private val sampleRate = 48_000
    private var audioRecord: AudioRecord? = null
    private var audioThread: Thread? = null
    private var sensorManager: SensorManager? = null
    private var audioRunning = false
    private var pressureHpa: Float? = null
    private var ambientC: Float? = null
    private var humidityPct: Float? = null
    private var lastEnvironmentSent = 0L

    @PluginMethod
    fun startTelemetry(call: PluginCall) {
        if (getPermissionState("microphone") != PermissionState.GRANTED) {
            requestPermissionForAlias("microphone", call, "microphonePermissionResult")
            return
        }
        beginTelemetry(call)
    }

    @com.getcapacitor.annotation.PermissionCallback
    private fun microphonePermissionResult(call: PluginCall) {
        if (getPermissionState("microphone") == PermissionState.GRANTED) beginTelemetry(call)
        else call.reject("Microphone permission is required to start the local audio analyzer")
    }

    private fun beginTelemetry(call: PluginCall) {
        try {
            stopAudio()
            val bufferBytes = max(AudioRecord.getMinBufferSize(sampleRate, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_FLOAT), sampleRate / 2)
            val source = if (Build.VERSION.SDK_INT >= 24) MediaRecorder.AudioSource.UNPROCESSED else MediaRecorder.AudioSource.MIC
            val floatRecorder = try {
                AudioRecord.Builder()
                    .setAudioSource(source)
                    .setAudioFormat(AudioFormat.Builder().setEncoding(AudioFormat.ENCODING_PCM_FLOAT)
                        .setSampleRate(sampleRate).setChannelMask(AudioFormat.CHANNEL_IN_MONO).build())
                    .setBufferSizeInBytes(bufferBytes)
                    .build()
            } catch (_: Exception) { null }
            val useFloatPcm = floatRecorder?.state == AudioRecord.STATE_INITIALIZED
            val readyRecord = if (useFloatPcm) floatRecorder!! else {
                try { floatRecorder?.release() } catch (_: Exception) { }
                AudioRecord(source, sampleRate, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, bufferBytes)
            }
            if (readyRecord.state != AudioRecord.STATE_INITIALIZED) {
                readyRecord.release()
                call.reject("AudioRecord could not initialize at 48 kHz")
                return
            }
            audioRecord = readyRecord
            audioRunning = true
            startEnvironmentSensors()
            readyRecord.startRecording()
            audioThread = Thread({ audioLoop(readyRecord, useFloatPcm) }, "AeroSpectra-AudioRecord").apply { isDaemon = true; start() }
            call.resolve(JSObject().put("started", true).put("sampleRate", sampleRate)
                .put("source", if (source == MediaRecorder.AudioSource.UNPROCESSED) "UNPROCESSED" else "MIC")
                .put("format", if (useFloatPcm) "PCM_FLOAT" else "PCM_16BIT"))
        } catch (error: SecurityException) { call.reject("Microphone permission is required", error) }
        catch (error: Exception) { stopAudio(); call.reject("Unable to start acoustic telemetry", error) }
    }

    private fun audioLoop(recorder: AudioRecord, floatPcm: Boolean) {
        val floatBuffer = FloatArray(2048)
        val shortBuffer = ShortArray(2048)
        while (audioRunning && !Thread.currentThread().isInterrupted) {
            val read = try {
                if (floatPcm) recorder.read(floatBuffer, 0, floatBuffer.size, AudioRecord.READ_BLOCKING)
                else recorder.read(shortBuffer, 0, shortBuffer.size, AudioRecord.READ_BLOCKING)
            } catch (_: Exception) { break }
            if (read <= 0) continue
            var sumSquares = 0.0
            var peak = 0f
            val waveform = JSArray()
            val decimation = max(1, read / 96)
            for (i in 0 until read) {
                val value = if (floatPcm) floatBuffer[i] else shortBuffer[i] / 32768f
                sumSquares += value * value
                peak = max(peak, kotlin.math.abs(value))
                if (i % decimation == 0 && waveform.length() < 96) waveform.put(value.toDouble())
            }
            val frame = JSObject().put("sampleRate", sampleRate).put("rms", sqrt(sumSquares / read).toFloat().toDouble())
                .put("peak", peak.toDouble()).put("waveform", waveform).put("timestampMs", SystemClock.elapsedRealtime())
            notifyListeners("audioFrame", frame)
        }
    }

    private fun startEnvironmentSensors() {
        val manager = context.getSystemService(Context.SENSOR_SERVICE) as SensorManager
        sensorManager = manager
        listOf(Sensor.TYPE_PRESSURE, Sensor.TYPE_AMBIENT_TEMPERATURE, Sensor.TYPE_RELATIVE_HUMIDITY).forEach { type ->
            manager.getDefaultSensor(type)?.let { manager.registerListener(this, it, SensorManager.SENSOR_DELAY_NORMAL) }
        }
    }

    override fun onSensorChanged(event: SensorEvent) {
        when (event.sensor.type) {
            Sensor.TYPE_PRESSURE -> pressureHpa = event.values.firstOrNull()
            Sensor.TYPE_AMBIENT_TEMPERATURE -> ambientC = event.values.firstOrNull()
            Sensor.TYPE_RELATIVE_HUMIDITY -> humidityPct = event.values.firstOrNull()
        }
        val now = SystemClock.elapsedRealtime()
        if (now - lastEnvironmentSent < 1000) return
        lastEnvironmentSent = now
        val tempK = (ambientC ?: 20f) + 273.15f
        val pressurePa = (pressureHpa ?: 1013.25f) * 100f
        val rh = (humidityPct ?: 50f).coerceIn(0f, 100f)
        val tempC = tempK - 273.15f
        val saturationPa = 611.2 * kotlin.math.exp(17.67 * tempC / (tempC + 243.5))
        val vaporPa = saturationPa * rh / 100.0
        val dryPa = max(0.0, pressurePa - vaporPa)
        val density = dryPa / (287.05 * tempK) + vaporPa / (461.5 * tempK)
        notifyListeners("environmentalTelemetry", JSObject()
            .put("pressureHpa", (pressureHpa ?: 1013.25f).toDouble())
            .put("ambientC", (ambientC ?: 20f).toDouble())
            .put("relativeHumidity", (humidityPct ?: 50f).toDouble())
            .put("pressureSensorAvailable", pressureHpa != null)
            .put("temperatureSensorAvailable", ambientC != null)
            .put("humiditySensorAvailable", humidityPct != null)
            .put("airDensityKgM3", density)
            .put("timestampMs", now))
    }

    override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) { }

    @PluginMethod
    fun stopTelemetry(call: PluginCall) {
        stopAudio()
        sensorManager?.unregisterListener(this)
        sensorManager = null
        call.resolve(JSObject().put("stopped", true))
    }

    override fun handleOnDestroy() {
        stopAudio()
        super.handleOnDestroy()
    }

    private fun stopAudio() {
        audioRunning = false
        audioThread?.interrupt()
        audioThread = null
        try { audioRecord?.stop() } catch (_: Exception) { }
        try { audioRecord?.release() } catch (_: Exception) { }
        audioRecord = null
        sensorManager?.unregisterListener(this)
        sensorManager = null
    }
}
