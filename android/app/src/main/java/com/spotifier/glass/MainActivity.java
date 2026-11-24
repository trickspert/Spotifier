package com.spotifier.glass;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(PlaybackPlugin.class); // "now playing" notification + keeps music running
        super.onCreate(savedInstanceState);
    }
}
