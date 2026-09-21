package cn.zaizai.companion;

import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "FloatingAssistant")
public class FloatingAssistantPlugin extends Plugin {
    @PluginMethod
    public void status(PluginCall call) {
        call.resolve(new JSObject().put("permitted", Build.VERSION.SDK_INT >= 26 && Settings.canDrawOverlays(getContext()))
            .put("running", AssistantOverlayService.instance != null));
    }

    @PluginMethod
    public void requestOverlayPermission(PluginCall call) {
        if (Build.VERSION.SDK_INT < 26) { call.reject("桌面助手需要 Android 8 或以上"); return; }
        getActivity().startActivity(new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
            Uri.parse("package:" + getContext().getPackageName())));
        call.resolve();
    }

    @PluginMethod
    public void show(PluginCall call) {
        boolean restore = Boolean.TRUE.equals(call.getBoolean("restore", false));
        if (Build.VERSION.SDK_INT < 26 || !Settings.canDrawOverlays(getContext())) {
            if (restore) { call.resolve(new JSObject().put("running", false)); return; }
            call.reject("请先允许显示在其他应用上层"); return;
        }
        String token = call.getString("token", ""), base = call.getString("base", ""), user = call.getString("userId", "");
        Uri uri = Uri.parse(base);
        if (token.isEmpty() || token.length() > 4096 || !user.matches("[a-zA-Z0-9-]{1,80}")
            || uri.getHost() == null || !("https".equals(uri.getScheme()) || "http".equals(uri.getScheme()))
            || uri.getUserInfo() != null || uri.getQuery() != null || uri.getFragment() != null) {
            call.reject("登录状态或服务地址无效"); return;
        }
        if (restore) {
            if (AssistantOverlayService.instance != null && AssistantOverlayService.instance.belongsTo(user)) {
                call.resolve(new JSObject().put("running", true)); return;
            }
            if (AssistantOverlayService.dismissedFor(getContext(), user)) {
                call.resolve(new JSObject().put("running", false)); return;
            }
        }
        try {
            getContext().startForegroundService(new Intent(getContext(), AssistantOverlayService.class)
                .setAction("show").putExtra("token", token).putExtra("base", base).putExtra("userId", user).putExtra("restore", restore));
            call.resolve(new JSObject().put("running", true));
        } catch (Exception error) { call.reject("无法启动桌面助手，请回到应用后重试"); }
    }

    @PluginMethod
    public void stop(PluginCall call) {
        getActivity().runOnUiThread(() -> { AssistantOverlayService.dismiss(getContext()); call.resolve(); });
    }
    @Override protected void handleOnResume() { notifyListeners("foreground", new JSObject()); }
}
