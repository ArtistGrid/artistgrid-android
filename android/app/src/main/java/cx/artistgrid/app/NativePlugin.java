package cx.artistgrid.app;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
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
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

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
