package com.aerospectra.hygiene

import android.os.Bundle
import com.getcapacitor.BridgeActivity
import com.aerospectra.plugins.AeroAcousticAmbientSensorPlugin
import com.aerospectra.plugins.MacroTyndallCameraTorchPlugin

class MainActivity : BridgeActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        registerPlugin(MacroTyndallCameraTorchPlugin::class.java)
        registerPlugin(AeroAcousticAmbientSensorPlugin::class.java)
        super.onCreate(savedInstanceState)
    }
}
