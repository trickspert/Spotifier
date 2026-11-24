package com.spotifier.glass;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.support.v4.media.MediaMetadataCompat;
import android.support.v4.media.session.MediaSessionCompat;
import android.support.v4.media.session.PlaybackStateCompat;
import androidx.core.app.NotificationCompat;
import androidx.media.app.NotificationCompat.MediaStyle;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Publishes what Spotifier is playing to Android as a real media session, so it shows up in
 * Samsung's Now Bar and status bar chip, on the lock screen and in the quick-settings media
 * player, all with working play/pause, previous, next and seeking. It also keeps the app
 * running in the background (a foreground "media playback" service) so the music doesn't stop.
 */
public class PlaybackService extends Service {

    static final String CHANNEL = "playback";
    static final int ID = 7;
    static final String ACTION_UPDATE = "com.spotifier.glass.UPDATE";
    static final String ACTION_TOGGLE = "com.spotifier.glass.TOGGLE";
    static final String ACTION_NEXT = "com.spotifier.glass.NEXT";
    static final String ACTION_PREV = "com.spotifier.glass.PREV";

    private MediaSessionCompat session;
    private PowerManager.WakeLock wakeLock;
    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private final Handler main = new Handler(Looper.getMainLooper());

    // what's showing right now
    private String title = "Spotifier", artist = "", album = "", artUrl = "";
    private boolean playing = true;
    private long position = 0, duration = 0;
    private String loadedArtUrl = null;
    private Bitmap art = null;

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public void onCreate() {
        super.onCreate();
        session = new MediaSessionCompat(this, "Spotifier");
        session.setCallback(new MediaSessionCompat.Callback() {
            @Override public void onPlay() { PlaybackPlugin.emit("play", -1); }
            @Override public void onPause() { PlaybackPlugin.emit("pause", -1); }
            @Override public void onSkipToNext() { PlaybackPlugin.emit("next", -1); }
            @Override public void onSkipToPrevious() { PlaybackPlugin.emit("prev", -1); }
            @Override public void onStop() { PlaybackPlugin.emit("pause", -1); }
            @Override public void onSeekTo(long pos) {
                position = pos;
                publishState();
                PlaybackPlugin.emit("seek", pos);
            }
        });
        Intent open = new Intent(this, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        session.setSessionActivity(PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT));
        session.setActive(true);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent != null ? intent.getAction() : null;
        if (ACTION_TOGGLE.equals(action)) {
            PlaybackPlugin.emit(playing ? "pause" : "play", -1);
            return START_NOT_STICKY;
        }
        if (ACTION_NEXT.equals(action)) {
            PlaybackPlugin.emit("next", -1);
            return START_NOT_STICKY;
        }
        if (ACTION_PREV.equals(action)) {
            PlaybackPlugin.emit("prev", -1);
            return START_NOT_STICKY;
        }
        if (intent != null) {
            title = orEmpty(intent.getStringExtra("title"), "Spotifier");
            artist = orEmpty(intent.getStringExtra("artist"), "");
            album = orEmpty(intent.getStringExtra("album"), "");
            artUrl = orEmpty(intent.getStringExtra("artUrl"), "");
            playing = intent.getBooleanExtra("playing", true);
            position = intent.getLongExtra("position", 0);
            duration = intent.getLongExtra("duration", 0);
        }
        publishMetadata();
        publishState();
        Notification n = buildNotification();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
        } else {
            startForeground(ID, n);
        }
        holdWakeLock(playing);
        loadArt();
        return START_NOT_STICKY;
    }

    private static String orEmpty(String v, String fallback) {
        return v == null || v.isEmpty() ? fallback : v;
    }

    private void publishMetadata() {
        MediaMetadataCompat.Builder m = new MediaMetadataCompat.Builder()
            .putString(MediaMetadataCompat.METADATA_KEY_TITLE, title)
            .putString(MediaMetadataCompat.METADATA_KEY_ARTIST, artist)
            .putString(MediaMetadataCompat.METADATA_KEY_ALBUM, album)
            .putString(MediaMetadataCompat.METADATA_KEY_DISPLAY_TITLE, title)
            .putString(MediaMetadataCompat.METADATA_KEY_DISPLAY_SUBTITLE, artist)
            .putLong(MediaMetadataCompat.METADATA_KEY_DURATION, duration > 0 ? duration : -1);
        if (art != null && artUrl.equals(loadedArtUrl)) {
            m.putBitmap(MediaMetadataCompat.METADATA_KEY_ALBUM_ART, art);
            m.putBitmap(MediaMetadataCompat.METADATA_KEY_DISPLAY_ICON, art);
        }
        session.setMetadata(m.build());
    }

    private void publishState() {
        long actions = PlaybackStateCompat.ACTION_PLAY | PlaybackStateCompat.ACTION_PAUSE | PlaybackStateCompat.ACTION_PLAY_PAUSE
            | PlaybackStateCompat.ACTION_SKIP_TO_NEXT | PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS | PlaybackStateCompat.ACTION_SEEK_TO
            | PlaybackStateCompat.ACTION_STOP;
        session.setPlaybackState(new PlaybackStateCompat.Builder()
            .setActions(actions)
            .setState(playing ? PlaybackStateCompat.STATE_PLAYING : PlaybackStateCompat.STATE_PAUSED, position, playing ? 1f : 0f)
            .build());
    }

    /** Downloads the cover once per song (in the background) and refreshes everything when it arrives. */
    private void loadArt() {
        if (artUrl.isEmpty() || artUrl.equals(loadedArtUrl) || !artUrl.startsWith("http")) return;
        final String url = artUrl;
        io.execute(() -> {
            Bitmap bmp = null;
            try {
                HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
                c.setConnectTimeout(8000);
                c.setReadTimeout(8000);
                try (InputStream in = c.getInputStream()) {
                    bmp = BitmapFactory.decodeStream(in);
                }
                if (bmp != null && bmp.getWidth() > 640) bmp = Bitmap.createScaledBitmap(bmp, 640, 640 * bmp.getHeight() / bmp.getWidth(), true);
            } catch (Exception ignored) {
            }
            final Bitmap result = bmp;
            main.post(() -> {
                if (!url.equals(artUrl)) return; // song changed meanwhile
                art = result;
                loadedArtUrl = url;
                publishMetadata();
                NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
                nm.notify(ID, buildNotification());
            });
        });
    }

    private void holdWakeLock(boolean on) {
        if (on && wakeLock == null) {
            PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
            wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "spotifier:playback");
            wakeLock.setReferenceCounted(false);
            wakeLock.acquire(6 * 60 * 60 * 1000L); // safety limit: 6 hours
        } else if (!on && wakeLock != null) {
            wakeLock.release();
            wakeLock = null;
        }
    }

    private PendingIntent action(String name, int code) {
        Intent i = new Intent(this, PlaybackService.class).setAction(name);
        return PendingIntent.getService(this, code, i, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    private Notification buildNotification() {
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && nm.getNotificationChannel(CHANNEL) == null) {
            NotificationChannel ch = new NotificationChannel(CHANNEL, "Now playing", NotificationManager.IMPORTANCE_LOW);
            ch.setShowBadge(false);
            nm.createNotificationChannel(ch);
        }
        NotificationCompat.Builder b = new NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_spotifier)
            .setContentTitle(title)
            .setContentText(artist)
            .setSubText(album)
            .setContentIntent(session.getController().getSessionActivity())
            .setDeleteIntent(action(ACTION_TOGGLE, 4))
            .setOngoing(playing)
            .setSilent(true)
            .setShowWhen(false)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setCategory(NotificationCompat.CATEGORY_TRANSPORT)
            .addAction(R.drawable.ic_skip_prev, "Previous", action(ACTION_PREV, 3))
            .addAction(playing ? R.drawable.ic_pause : R.drawable.ic_play, playing ? "Pause" : "Play", action(ACTION_TOGGLE, 1))
            .addAction(R.drawable.ic_skip_next, "Next", action(ACTION_NEXT, 2))
            .setStyle(new MediaStyle().setMediaSession(session.getSessionToken()).setShowActionsInCompactView(0, 1, 2));
        if (art != null && artUrl.equals(loadedArtUrl)) b.setLargeIcon(art);
        return b.build();
    }

    @Override
    public void onDestroy() {
        holdWakeLock(false);
        if (session != null) {
            session.setActive(false);
            session.release();
        }
        io.shutdownNow();
        super.onDestroy();
    }
}
