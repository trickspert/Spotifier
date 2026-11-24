package com.spotifier.glass;

import android.Manifest;
import android.content.Intent;
import android.os.Build;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

/** Lets the web app show/update/hide the "now playing" notification and hear its buttons. */
@CapacitorPlugin(
    name = "Playback",
    permissions = { @Permission(strings = { Manifest.permission.POST_NOTIFICATIONS }, alias = "notifications") }
)
public class PlaybackPlugin extends Plugin {

    private static PlaybackPlugin instance;

    @Override
    public void load() {
        instance = this;
    }

    /** Called by the notification buttons. */
    static void emit(String action) {
        if (instance == null) return;
        JSObject data = new JSObject();
        data.put("action", action);
        instance.notifyListeners("action", data);
    }

    @PluginMethod
    public void show(PluginCall call) {
        if (Build.VERSION.SDK_INT >= 33 && getPermissionState("notifications") != PermissionState.GRANTED) {
            // ask once; music keeps playing either way, the notification just may not be visible
            requestPermissionForAlias("notifications", call, "afterPermission");
            return;
        }
        startService(call);
    }

    @PermissionCallback
    private void afterPermission(PluginCall call) {
        startService(call);
    }

    private void startService(PluginCall call) {
        Intent i = new Intent(getContext(), PlaybackService.class)
            .setAction(PlaybackService.ACTION_UPDATE)
            .putExtra("title", call.getString("title", "Spotifier"))
            .putExtra("artist", call.getString("artist", ""))
            .putExtra("playing", call.getBoolean("playing", true));
        try {
            ContextCompat.startForegroundService(getContext(), i);
            call.resolve();
        } catch (Exception e) {
            call.reject("Couldn't start playback service: " + e.getMessage());
        }
    }

    @PluginMethod
    public void hide(PluginCall call) {
        getContext().stopService(new Intent(getContext(), PlaybackService.class));
        call.resolve();
    }
}
