package cn.zaizai.companion;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Intent;
import android.media.AudioAttributes;
import android.media.Ringtone;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import androidx.activity.result.ActivityResult;
import androidx.core.app.NotificationManagerCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "ReminderSound")
public class ReminderSoundPlugin extends Plugin {
    // Reuse Capacitor's existing channel, including already scheduled reminders.
    private static final String CHANNEL_ID = "default";

    private NotificationChannel channel() {
        NotificationManager manager = getContext().getSystemService(NotificationManager.class);
        NotificationChannel channel = manager.getNotificationChannel(CHANNEL_ID);
        if (channel == null) {
            channel = new NotificationChannel(CHANNEL_ID, "所有提醒", NotificationManager.IMPORTANCE_DEFAULT);
            channel.setSound(Settings.System.DEFAULT_NOTIFICATION_URI, new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_NOTIFICATION)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build());
        } else {
            // Only update metadata. Sound, importance and silence remain controlled by the user.
            channel.setName("所有提醒");
        }
        channel.setDescription("待办、打卡及其他到点提醒");
        manager.createNotificationChannel(channel);
        return manager.getNotificationChannel(CHANNEL_ID);
    }

    private JSObject state() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            return new JSObject().put("available", false).put("title", "系统默认")
                .put("reason", "当前系统使用默认通知铃声；应用内铃声设置需要 Android 8.0 或更高版本");
        }
        NotificationChannel channel = channel();
        boolean enabled = NotificationManagerCompat.from(getContext()).areNotificationsEnabled()
            && channel.getImportance() != NotificationManager.IMPORTANCE_NONE;
        Uri sound = channel.getSound();
        String title = "系统默认";
        if (!enabled) title = "通知已关闭";
        else if (sound == null || channel.getImportance() < NotificationManager.IMPORTANCE_DEFAULT) title = "静音";
        else if (!RingtoneManager.isDefault(sound)) {
            try {
                Ringtone ringtone = RingtoneManager.getRingtone(getContext(), sound);
                title = ringtone == null ? "系统铃声" : ringtone.getTitle(getContext());
            } catch (Exception error) { title = "系统铃声"; }
        }
        return new JSObject().put("available", true).put("title", title).put("enabled", enabled)
            .put("channelId", CHANNEL_ID);
    }

    @PluginMethod
    public void get(PluginCall call) {
        try { call.resolve(state()); }
        catch (Exception error) { call.reject("无法读取手机提醒铃声", error); }
    }

    @PluginMethod
    public void open(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            call.reject("当前系统使用默认通知铃声；应用内铃声设置需要 Android 8.0 或更高版本");
            return;
        }
        try {
            channel();
            // Android owns channel sound changes; never replace a channel to bypass its settings.
            Intent intent = new Intent(Settings.ACTION_CHANNEL_NOTIFICATION_SETTINGS)
                .putExtra(Settings.EXTRA_APP_PACKAGE, getContext().getPackageName())
                .putExtra(Settings.EXTRA_CHANNEL_ID, CHANNEL_ID);
            startActivityForResult(call, intent, "settingsReturned");
        } catch (Exception error) { call.reject("无法打开手机铃声设置，请在系统通知设置中调整", error); }
    }

    @ActivityCallback
    private void settingsReturned(PluginCall call, ActivityResult result) {
        if (call == null) return;
        try { call.resolve(state()); }
        catch (Exception error) { call.reject("无法读取更新后的提醒铃声", error); }
    }
}
