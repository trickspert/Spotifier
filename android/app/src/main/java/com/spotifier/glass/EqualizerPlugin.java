package com.spotifier.glass;

import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.media.audiofx.AudioEffect;
import android.media.audiofx.Equalizer;
import android.provider.Settings;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Equalizer for everything the phone plays, using Android's system equalizer on the output mix.
 * Spotify's audio is copy-protected, so no app can filter the stream itself; this works at the
 * system level instead. Some phones ignore it, so openSystem() opens the phone's own equalizer
 * (on Samsung: SoundAlive / Sound quality and effects) as a fallback.
 */
@CapacitorPlugin(name = "Equalizer")
public class EqualizerPlugin extends Plugin {

    private Equalizer eq;

    private Equalizer get() {
        if (eq == null) eq = new Equalizer(1000, 0); // high priority, global output mix
        return eq;
    }

    @PluginMethod
    public void info(PluginCall call) {
        JSObject ret = new JSObject();
        try {
            Equalizer e = get();
            short n = e.getNumberOfBands();
            short[] range = e.getBandLevelRange();
            JSArray bands = new JSArray();
            for (short b = 0; b < n; b++) {
                JSObject band = new JSObject();
                band.put("hz", e.getCenterFreq(b) / 1000);
                band.put("level", e.getBandLevel(b));
                bands.put(band);
            }
            ret.put("supported", true);
            ret.put("enabled", e.getEnabled());
            ret.put("min", range[0]);
            ret.put("max", range[1]);
            ret.put("bands", bands);
        } catch (Throwable t) {
            ret.put("supported", false);
            ret.put("reason", String.valueOf(t.getMessage()));
        }
        call.resolve(ret);
    }

    @PluginMethod
    public void set(PluginCall call) {
        try {
            Equalizer e = get();
            JSArray levels = call.getArray("levels");
            if (levels != null) {
                for (int i = 0; i < levels.length() && i < e.getNumberOfBands(); i++) {
                    e.setBandLevel((short) i, (short) levels.getInt(i));
                }
            }
            if (call.getData().has("enabled")) e.setEnabled(call.getBoolean("enabled", false));
            call.resolve();
        } catch (Throwable t) {
            call.reject("Equalizer not available: " + t.getMessage());
        }
    }

    @PluginMethod
    public void openSystem(PluginCall call) {
        Intent i = new Intent(AudioEffect.ACTION_DISPLAY_AUDIO_EFFECT_CONTROL_PANEL)
            .putExtra(AudioEffect.EXTRA_AUDIO_SESSION, 0)
            .putExtra(AudioEffect.EXTRA_PACKAGE_NAME, getContext().getPackageName())
            .putExtra(AudioEffect.EXTRA_CONTENT_TYPE, AudioEffect.CONTENT_TYPE_MUSIC)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        JSObject ret = new JSObject();
        try {
            getContext().startActivity(i);
            ret.put("opened", "equalizer");
        } catch (ActivityNotFoundException e) {
            getContext().startActivity(new Intent(Settings.ACTION_SOUND_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
            ret.put("opened", "sound-settings");
        }
        call.resolve(ret);
    }

    @Override
    protected void handleOnDestroy() {
        if (eq != null) {
            eq.release();
            eq = null;
        }
    }
}
