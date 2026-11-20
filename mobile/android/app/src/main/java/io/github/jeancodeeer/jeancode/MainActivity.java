package io.github.jeancodeeer.jeancode;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // mini agente del móvil (Shizuku): se registra antes de crear el puente
        registerPlugin(JeanDevicePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
