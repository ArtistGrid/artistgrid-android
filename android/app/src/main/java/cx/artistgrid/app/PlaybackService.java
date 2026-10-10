package cx.artistgrid.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.support.v4.media.MediaMetadataCompat;
import android.support.v4.media.session.MediaSessionCompat;
import android.support.v4.media.session.PlaybackStateCompat;
import androidx.core.app.NotificationCompat;
import androidx.core.app.ServiceCompat;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * Foreground service that keeps the app alive while music plays with the screen off or the app
 * in the background. It shows the media notification and owns a MediaSession, so the lock screen,
 * Quick Settings media player, headsets and Bluetooth controls all drive the web player.
 */
public class PlaybackService extends Service {

    static final String ACTION_UPDATE = "cx.artistgrid.app.UPDATE";
    private static final String ACTION_PLAY = "cx.artistgrid.app.PLAY";
    private static final String ACTION_PAUSE = "cx.artistgrid.app.PAUSE";
    private static final String ACTION_NEXT = "cx.artistgrid.app.NEXT";
    private static final String ACTION_PREV = "cx.artistgrid.app.PREV";
    private static final String CHANNEL = "playback";
    private static final int NOTIFICATION_ID = 7300;

    /** Latest state sent by the web player. */
    static final class State {
        String title = "", artist = "", album = "", artwork;
        boolean playing;
        long positionMs, durationMs;
        float speed = 1f;
    }
    static final State STATE = new State();

    private MediaSessionCompat session;
    private final Handler main = new Handler(Looper.getMainLooper());
    private String artworkUrl;
    private Bitmap artwork;

    @Override
    public void onCreate() {
        super.onCreate();
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationChannel ch = new NotificationChannel(CHANNEL, getString(R.string.playback_channel), NotificationManager.IMPORTANCE_LOW);
            ch.setShowBadge(false);
            getSystemService(NotificationManager.class).createNotificationChannel(ch);
        }
        session = new MediaSessionCompat(this, "ArtistGrid");
        session.setCallback(new MediaSessionCompat.Callback() {
            @Override public void onPlay() { NativePlugin.dispatch("play", -1); }
            @Override public void onPause() { NativePlugin.dispatch("pause", -1); }
            @Override public void onSkipToNext() { NativePlugin.dispatch("next", -1); }
            @Override public void onSkipToPrevious() { NativePlugin.dispatch("prev", -1); }
            @Override public void onStop() { NativePlugin.dispatch("pause", -1); }
            @Override public void onSeekTo(long pos) { NativePlugin.dispatch("seek", pos); }
        });
        session.setSessionActivity(openAppIntent());
        session.setActive(true);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent != null ? intent.getAction() : null;
        if (ACTION_PLAY.equals(action)) NativePlugin.dispatch("play", -1);
        else if (ACTION_PAUSE.equals(action)) NativePlugin.dispatch("pause", -1);
        else if (ACTION_NEXT.equals(action)) NativePlugin.dispatch("next", -1);
        else if (ACTION_PREV.equals(action)) NativePlugin.dispatch("prev", -1);
        refresh();
        return START_NOT_STICKY;
    }

    private void refresh() {
        State s = STATE;
        MediaMetadataCompat.Builder meta = new MediaMetadataCompat.Builder()
                .putString(MediaMetadataCompat.METADATA_KEY_TITLE, s.title)
                .putString(MediaMetadataCompat.METADATA_KEY_ARTIST, s.artist)
                .putString(MediaMetadataCompat.METADATA_KEY_ALBUM, s.album)
                .putLong(MediaMetadataCompat.METADATA_KEY_DURATION, s.durationMs > 0 ? s.durationMs : -1);
        if (artwork != null && s.artwork != null && s.artwork.equals(artworkUrl)) {
            meta.putBitmap(MediaMetadataCompat.METADATA_KEY_ALBUM_ART, artwork);
            meta.putBitmap(MediaMetadataCompat.METADATA_KEY_ART, artwork);
            meta.putBitmap(MediaMetadataCompat.METADATA_KEY_DISPLAY_ICON, artwork);
        }
        session.setMetadata(meta.build());
        session.setPlaybackState(new PlaybackStateCompat.Builder()
                .setActions(PlaybackStateCompat.ACTION_PLAY | PlaybackStateCompat.ACTION_PAUSE | PlaybackStateCompat.ACTION_PLAY_PAUSE |
                        PlaybackStateCompat.ACTION_SKIP_TO_NEXT | PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS | PlaybackStateCompat.ACTION_SEEK_TO)
                .setState(s.playing ? PlaybackStateCompat.STATE_PLAYING : PlaybackStateCompat.STATE_PAUSED, s.positionMs, s.playing ? s.speed : 0f)
                .build());

        Notification n = buildNotification();
        int type = Build.VERSION.SDK_INT >= 29 ? ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK : 0;
        ServiceCompat.startForeground(this, NOTIFICATION_ID, n, type);
        loadArtwork(s.artwork);
    }

    private Notification buildNotification() {
        State s = STATE;
        NotificationCompat.Builder b = new NotificationCompat.Builder(this, CHANNEL)
                .setSmallIcon(R.drawable.ic_stat_music)
                .setContentTitle(s.title)
                .setContentText(s.artist + (s.album.isEmpty() ? "" : " · " + s.album))
                .setContentIntent(openAppIntent())
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setOnlyAlertOnce(true)
                .setShowWhen(false)
                .setOngoing(s.playing)
                .addAction(android.R.drawable.ic_media_previous, "Previous", serviceIntent(ACTION_PREV, 1))
                .addAction(s.playing ? android.R.drawable.ic_media_pause : android.R.drawable.ic_media_play,
                        s.playing ? "Pause" : "Play", serviceIntent(s.playing ? ACTION_PAUSE : ACTION_PLAY, 2))
                .addAction(android.R.drawable.ic_media_next, "Next", serviceIntent(ACTION_NEXT, 3))
                .setStyle(new androidx.media.app.NotificationCompat.MediaStyle()
                        .setMediaSession(session.getSessionToken())
                        .setShowActionsInCompactView(0, 1, 2));
        if (artwork != null && s.artwork != null && s.artwork.equals(artworkUrl)) b.setLargeIcon(artwork);
        return b.build();
    }

    /**
     * Loads the cover once per URL, off the main thread, then refreshes the notification. It
     * comes from the app's cover cache when the player has already shown it, otherwise it is
     * downloaded. Either way it is scaled down: media notifications and the lock screen drop
     * bitmaps that are too large to pass to the system.
     */
    private void loadArtwork(String url) {
        if (url == null || url.equals(artworkUrl)) return;
        artworkUrl = url;
        artwork = null;
        new Thread(() -> {
            Bitmap bmp = null;
            try {
                File cached = ProxyWebViewClient.coverFile(this, url);
                byte[] data = cached.isFile() ? readAll(new FileInputStream(cached)) : download(url);
                if (data != null) bmp = decodeScaled(data, ARTWORK_SIZE);
            } catch (Exception ignored) {}
            final Bitmap result = bmp;
            main.post(() -> {
                if (result == null || !url.equals(artworkUrl)) return;
                artwork = result;
                refresh();
            });
        }).start();
    }

    private static final int ARTWORK_SIZE = 512;

    /** Follows redirects across http/https (HttpURLConnection alone doesn't). */
    private static byte[] download(String target) throws Exception {
        URL url = new URL(target);
        for (int i = 0; i < 6; i++) {
            HttpURLConnection c = (HttpURLConnection) url.openConnection();
            c.setInstanceFollowRedirects(false);
            c.setConnectTimeout(10000);
            c.setReadTimeout(15000);
            c.setRequestProperty("User-Agent", "Mozilla/5.0 (Linux; Android " + Build.VERSION.RELEASE + ") ArtistGrid");
            c.setRequestProperty("Accept", "image/*,*/*");
            int code = c.getResponseCode();
            if (code >= 300 && code < 400 && c.getHeaderField("Location") != null) {
                url = new URL(url, c.getHeaderField("Location"));
                c.disconnect();
                continue;
            }
            if (code != 200) return null;
            return readAll(c.getInputStream());
        }
        return null;
    }

    private static byte[] readAll(InputStream stream) throws Exception {
        try (InputStream in = stream) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[16384];
            int n;
            while ((n = in.read(buf)) > 0) {
                out.write(buf, 0, n);
                if (out.size() > 8 * 1024 * 1024) return null;
            }
            return out.toByteArray();
        }
    }

    private static Bitmap decodeScaled(byte[] data, int size) {
        BitmapFactory.Options o = new BitmapFactory.Options();
        o.inJustDecodeBounds = true;
        BitmapFactory.decodeByteArray(data, 0, data.length, o);
        if (o.outWidth <= 0 || o.outHeight <= 0) return null;
        o.inSampleSize = 1;
        while (Math.max(o.outWidth, o.outHeight) / (o.inSampleSize * 2) >= size) o.inSampleSize *= 2;
        o.inJustDecodeBounds = false;
        Bitmap bmp = BitmapFactory.decodeByteArray(data, 0, data.length, o);
        if (bmp == null) return null;
        int max = Math.max(bmp.getWidth(), bmp.getHeight());
        if (max <= size) return bmp;
        float k = (float) size / max;
        return Bitmap.createScaledBitmap(bmp, Math.round(bmp.getWidth() * k), Math.round(bmp.getHeight() * k), true);
    }

    private PendingIntent serviceIntent(String action, int code) {
        Intent i = new Intent(this, PlaybackService.class).setAction(action);
        return PendingIntent.getService(this, code, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private PendingIntent openAppIntent() {
        Intent i = new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        return PendingIntent.getActivity(this, 0, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    @Override
    public void onDestroy() {
        session.setActive(false);
        session.release();
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) { return null; }
}
