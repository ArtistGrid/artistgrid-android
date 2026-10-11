package cx.artistgrid.app;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.media.AudioDeviceCallback;
import android.media.AudioDeviceInfo;
import android.media.AudioManager;
import android.media.MediaRouter2;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.view.Window;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import androidx.core.content.FileProvider;
import androidx.core.content.pm.PackageInfoCompat;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.mlkit.common.model.DownloadConditions;
import com.google.mlkit.nl.translate.TranslateLanguage;
import com.google.mlkit.nl.translate.Translation;
import com.google.mlkit.nl.translate.Translator;
import com.google.mlkit.nl.translate.TranslatorOptions;
import java.util.HashMap;
import java.util.Map;

/**
 * Bridge between the web player and Android: keeps playback alive in the background through
 * {@link PlaybackService} (media notification, lock screen and headset controls), opens the
 * system audio output switcher, reports the current output and styles the system bars.
 *
 * Called from JS with Capacitor.nativePromise("ArtistGridNative", method, options).
 */
@CapacitorPlugin(name = "ArtistGridNative")
public class NativePlugin extends Plugin {

    private static NativePlugin instance;
    private boolean askedNotifications = false;
    private AudioDeviceCallback deviceCallback;
    private final Map<String, Translator> translators = new HashMap<>();

    @Override
    public void load() {
        instance = this;
        AudioManager am = (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
        deviceCallback = new AudioDeviceCallback() {
            @Override
            public void onAudioDevicesAdded(AudioDeviceInfo[] added) { notifyListeners("output", currentOutput(), true); }

            @Override
            public void onAudioDevicesRemoved(AudioDeviceInfo[] removed) { notifyListeners("output", currentOutput(), true); }
        };
        am.registerAudioDeviceCallback(deviceCallback, null);
    }

    @Override
    protected void handleOnDestroy() {
        AudioManager am = (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
        if (deviceCallback != null) am.unregisterAudioDeviceCallback(deviceCallback);
        getContext().stopService(new Intent(getContext(), PlaybackService.class));
        if (instance == this) instance = null;
        synchronized (translators) {
            for (Translator t : translators.values()) t.close();
            translators.clear();
        }
    }

    /** Forwards a control pressed in the notification / lock screen / headset to the web player. */
    static void dispatch(String action, long positionMs) {
        NativePlugin p = instance;
        if (p == null) return;
        JSObject data = new JSObject();
        data.put("action", action);
        if (positionMs >= 0) data.put("position", positionMs / 1000.0);
        p.notifyListeners("action", data, true);
    }

    @PluginMethod
    public void update(PluginCall call) {
        if (!askedNotifications && Build.VERSION.SDK_INT >= 33 &&
                ContextCompat.checkSelfPermission(getContext(), Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED &&
                getActivity() != null) {
            askedNotifications = true;
            ActivityCompat.requestPermissions(getActivity(), new String[] { Manifest.permission.POST_NOTIFICATIONS }, 7301);
        }
        PlaybackService.State s = PlaybackService.STATE;
        s.title = call.getString("title", "");
        s.artist = call.getString("artist", "");
        s.album = call.getString("album", "");
        s.artwork = call.getString("artwork", null);
        s.playing = Boolean.TRUE.equals(call.getBoolean("playing", false));
        s.positionMs = (long) (call.getDouble("position", 0.0) * 1000);
        s.durationMs = (long) (call.getDouble("duration", 0.0) * 1000);
        s.speed = call.getFloat("speed", 1f);
        try {
            Intent intent = new Intent(getContext(), PlaybackService.class).setAction(PlaybackService.ACTION_UPDATE);
            ContextCompat.startForegroundService(getContext(), intent);
            call.resolve();
        } catch (Exception e) {
            // e.g. Android refusing to start a foreground service while the app is in the background
            call.reject(e.getMessage());
        }
    }

    @PluginMethod
    public void stop(PluginCall call) {
        getContext().stopService(new Intent(getContext(), PlaybackService.class));
        call.resolve();
    }

    @PluginMethod
    public void showOutputSwitcher(PluginCall call) {
        Context ctx = getContext();
        JSObject ret = new JSObject();
        // Android 14+: the official system output switcher
        if (Build.VERSION.SDK_INT >= 34) {
            try {
                if (MediaRouter2.getInstance(ctx).showSystemOutputSwitcher()) {
                    ret.put("shown", "system");
                    call.resolve(ret);
                    return;
                }
            } catch (Exception ignored) {}
        }
        // Android 12–13: SystemUI's media output dialog
        if (Build.VERSION.SDK_INT >= 31) {
            try {
                Intent i = new Intent("com.android.systemui.action.LAUNCH_MEDIA_OUTPUT_DIALOG");
                i.setPackage("com.android.systemui");
                i.putExtra("package_name", ctx.getPackageName());
                ctx.sendBroadcast(i);
                ret.put("shown", "systemui");
                call.resolve(ret);
                return;
            } catch (Exception ignored) {}
        }
        // Android 10–11: the Settings media output panel
        if (Build.VERSION.SDK_INT >= 29) {
            try {
                Intent i = new Intent("com.android.settings.panel.action.MEDIA_OUTPUT");
                i.putExtra("com.android.settings.panel.extra.PACKAGE_NAME", ctx.getPackageName());
                i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                ctx.startActivity(i);
                ret.put("shown", "panel");
                call.resolve(ret);
                return;
            } catch (Exception ignored) {}
        }
        // Fallback: Bluetooth settings
        try {
            Intent i = new Intent(Settings.ACTION_BLUETOOTH_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            ctx.startActivity(i);
            ret.put("shown", "bluetooth");
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("No output switcher available");
        }
    }

    @PluginMethod
    public void getOutput(PluginCall call) {
        call.resolve(currentOutput());
    }

    private JSObject currentOutput() {
        AudioManager am = (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
        JSObject out = new JSObject();
        String type = "speaker";
        String name = "";
        for (AudioDeviceInfo d : am.getDevices(AudioManager.GET_DEVICES_OUTPUTS)) {
            int t = d.getType();
            boolean bt = t == AudioDeviceInfo.TYPE_BLUETOOTH_A2DP ||
                    (Build.VERSION.SDK_INT >= 31 && (t == AudioDeviceInfo.TYPE_BLE_HEADSET || t == AudioDeviceInfo.TYPE_BLE_SPEAKER));
            boolean wired = t == AudioDeviceInfo.TYPE_WIRED_HEADPHONES || t == AudioDeviceInfo.TYPE_WIRED_HEADSET ||
                    t == AudioDeviceInfo.TYPE_USB_HEADSET;
            if (bt) {
                type = "bluetooth";
                name = String.valueOf(d.getProductName());
                break;
            }
            if (wired && !"bluetooth".equals(type)) {
                type = "wired";
                name = String.valueOf(d.getProductName());
            }
        }
        out.put("type", type);
        out.put("name", name);
        return out;
    }

    /** Installed version, read from the APK itself. */
    @PluginMethod
    public void getAppInfo(PluginCall call) {
        try {
            PackageInfo pi = getContext().getPackageManager().getPackageInfo(getContext().getPackageName(), 0);
            JSObject ret = new JSObject();
            ret.put("version", pi.versionName);
            ret.put("build", PackageInfoCompat.getLongVersionCode(pi));
            call.resolve(ret);
        } catch (Exception e) {
            call.reject(e.getMessage());
        }
    }

    /**
     * Downloads the new APK (reporting "updateProgress" events) and opens Android's installer.
     * Resolves { needsPermission: true } after sending the user to allow installs from this app.
     */
    @PluginMethod
    public void installUpdate(PluginCall call) {
        String url = call.getString("url");
        Context ctx = getContext();
        if (url == null || !url.startsWith("https://")) { call.reject("Bad URL"); return; }
        if (Build.VERSION.SDK_INT >= 26 && !ctx.getPackageManager().canRequestPackageInstalls()) {
            Intent i = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + ctx.getPackageName()));
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            ctx.startActivity(i);
            JSObject ret = new JSObject();
            ret.put("needsPermission", true);
            call.resolve(ret);
            return;
        }
        new Thread(() -> {
            try {
                File dir = new File(ctx.getCacheDir(), "updates");
                dir.mkdirs();
                File apk = new File(dir, "ArtistGrid.apk");
                HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
                c.setConnectTimeout(20000);
                c.setReadTimeout(60000);
                if (c.getResponseCode() != 200) throw new Exception("HTTP " + c.getResponseCode());
                long size = c.getContentLengthLong(), done = 0;
                int lastPct = -1;
                try (InputStream in = c.getInputStream(); FileOutputStream out = new FileOutputStream(apk)) {
                    byte[] buf = new byte[65536];
                    int n;
                    while ((n = in.read(buf)) > 0) {
                        out.write(buf, 0, n);
                        done += n;
                        int pct = size > 0 ? (int) (done * 100 / size) : -1;
                        if (pct != lastPct) {
                            lastPct = pct;
                            JSObject p = new JSObject();
                            p.put("progress", pct);
                            notifyListeners("updateProgress", p);
                        }
                    }
                }
                Uri uri = FileProvider.getUriForFile(ctx, ctx.getPackageName() + ".fileprovider", apk);
                Intent i = new Intent(Intent.ACTION_VIEW)
                        .setDataAndType(uri, "application/vnd.android.package-archive")
                        .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
                ctx.startActivity(i);
                JSObject ret = new JSObject();
                ret.put("started", true);
                call.resolve(ret);
            } catch (Exception e) {
                call.reject(e.getMessage());
            }
        }).start();
    }

    /**
     * Material You colours from the wallpaper (Android 12+): primary and tertiary accents for the
     * dark and light themes, as "#rrggbb". Resolves an empty object on older versions.
     */
    @PluginMethod
    public void getSystemColors(PluginCall call) {
        JSObject ret = new JSObject();
        if (Build.VERSION.SDK_INT >= 31) {
            Context ctx = getContext();
            ret.put("dark", colors(ctx, android.R.color.system_accent1_200, android.R.color.system_accent3_200));
            ret.put("light", colors(ctx, android.R.color.system_accent1_600, android.R.color.system_accent3_600));
        }
        call.resolve(ret);
    }

    private static JSArray colors(Context ctx, int... ids) {
        JSArray out = new JSArray();
        for (int id : ids) out.put(String.format("#%06x", ContextCompat.getColor(ctx, id) & 0xffffff));
        return out;
    }

    /**
     * Translates English text on the device with ML Kit. The language model (~30 MB) downloads
     * on first use; afterwards translation works offline. Resolves { text }.
     */
    @PluginMethod
    public void translate(PluginCall call) {
        String text = call.getString("text");
        String target = TranslateLanguage.fromLanguageTag(call.getString("to", ""));
        if (text == null || target == null || target.equals(TranslateLanguage.ENGLISH)) {
            call.reject("Unsupported language");
            return;
        }
        Translator translator;
        synchronized (translators) {
            translator = translators.get(target);
            if (translator == null) {
                translator = Translation.getClient(new TranslatorOptions.Builder()
                        .setSourceLanguage(TranslateLanguage.ENGLISH)
                        .setTargetLanguage(target)
                        .build());
                translators.put(target, translator);
            }
        }
        final Translator t = translator;
        t.downloadModelIfNeeded(new DownloadConditions.Builder().build())
                .onSuccessTask(v -> t.translate(text))
                .addOnSuccessListener(result -> {
                    JSObject ret = new JSObject();
                    ret.put("text", result);
                    call.resolve(ret);
                })
                .addOnFailureListener(e -> call.reject(String.valueOf(e.getMessage())));
    }

    /** Opens Android's share sheet with a text (title, artist, link). */
    @PluginMethod
    public void share(PluginCall call) {
        String text = call.getString("text");
        if (text == null || text.isEmpty()) { call.reject("Nothing to share"); return; }
        Intent send = new Intent(Intent.ACTION_SEND)
                .setType("text/plain")
                .putExtra(Intent.EXTRA_TEXT, text)
                .putExtra(Intent.EXTRA_TITLE, call.getString("title", ""));
        Intent chooser = Intent.createChooser(send, call.getString("title", null));
        try {
            if (getActivity() != null) getActivity().startActivity(chooser);
            else getContext().startActivity(chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
            JSObject ret = new JSObject();
            ret.put("shared", true);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject(String.valueOf(e.getMessage()));
        }
    }

    /** Light or dark system bar icons (and bar colour on Android versions that still colour them). */
    @PluginMethod
    public void setBars(PluginCall call) {
        boolean dark = Boolean.TRUE.equals(call.getBoolean("dark", true));
        String color = call.getString("color", dark ? "#000000" : "#f2f2f7");
        if (getActivity() == null) { call.resolve(); return; }
        getActivity().runOnUiThread(() -> {
            Window w = getActivity().getWindow();
            WindowInsetsControllerCompat c = WindowCompat.getInsetsController(w, w.getDecorView());
            c.setAppearanceLightStatusBars(!dark);
            c.setAppearanceLightNavigationBars(!dark);
            if (Build.VERSION.SDK_INT < 35) {
                try {
                    int col = Color.parseColor(color);
                    w.setStatusBarColor(col);
                    w.setNavigationBarColor(col);
                } catch (IllegalArgumentException ignored) {}
            }
            call.resolve();
        });
    }
}
