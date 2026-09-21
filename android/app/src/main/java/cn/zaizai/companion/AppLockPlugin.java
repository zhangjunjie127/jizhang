package cn.zaizai.companion;

import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.hardware.biometrics.BiometricManager;
import android.hardware.biometrics.BiometricPrompt;
import android.os.Build;
import android.os.CancellationSignal;
import android.view.WindowManager;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import org.json.JSONObject;

@CapacitorPlugin(name = "AppLock")
public class AppLockPlugin extends Plugin {
    private CancellationSignal cancellation;
    private PluginCall active;

    private SharedPreferences store() {
        return getContext().getSharedPreferences("zaizai_app_locks", Context.MODE_PRIVATE);
    }

    private String user(PluginCall call) {
        String id = call.getString("userId", "");
        if (!id.matches("[a-zA-Z0-9-]{1,80}")) {
            call.reject("Invalid account");
            return null;
        }
        return id;
    }

    public static boolean hasEnabledLock(Context context) {
        for (Object raw : context.getSharedPreferences("zaizai_app_locks", Context.MODE_PRIVATE).getAll().values()) {
            try {
                if (new JSONObject(String.valueOf(raw)).optBoolean("enabled", true)) return true;
            } catch (Exception error) { return true; }
        }
        return false;
    }

    private void secureWindow() {
        getActivity().runOnUiThread(() -> {
            if (hasEnabledLock(getContext())) getActivity().getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
            else getActivity().getWindow().clearFlags(WindowManager.LayoutParams.FLAG_SECURE);
        });
    }

    @PluginMethod
    public void read(PluginCall call) {
        String id = user(call);
        if (id == null) return;
        secureWindow();
        call.resolve(new JSObject().put("data", store().getString(id, null)));
    }

    @PluginMethod
    public void write(PluginCall call) {
        String id = user(call);
        if (id == null) return;
        String data = call.getString("data", "");
        try {
            if (data.length() > 4096) throw new Exception("Invalid size");
            JSONObject json = new JSONObject(data);
            if (json.getInt("version") != 1) throw new Exception("Invalid version");
            if (!store().edit().putString(id, data).commit()) throw new Exception("Storage failed");
            secureWindow();
            call.resolve();
        } catch (Exception error) { call.reject("Could not save app lock"); }
    }

    private boolean supported() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) return false;
        BiometricManager manager = getContext().getSystemService(BiometricManager.class);
        return manager != null && manager.canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_STRONG) == BiometricManager.BIOMETRIC_SUCCESS;
    }

    @PluginMethod
    public void availability(PluginCall call) {
        boolean faceHardware = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q &&
            getContext().getPackageManager().hasSystemFeature(PackageManager.FEATURE_FACE);
        call.resolve(new JSObject().put("available", faceHardware && supported())
            .put("reason", faceHardware && supported() ? "" : "手机需支持并录入系统认可的生物识别，当前请使用密码或手势"));
    }

    @PluginMethod
    public void authenticate(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            if (active != null) { call.reject("已有系统验证正在进行"); return; }
            if (!supported()) { call.reject("系统生物识别不可用，请使用密码或手势"); return; }
            active = call;
            cancellation = new CancellationSignal();
            new BiometricPrompt.Builder(getContext())
                .setTitle("在在应用锁")
                .setSubtitle("使用手机系统生物识别验证")
                .setAllowedAuthenticators(BiometricManager.Authenticators.BIOMETRIC_STRONG)
                .setNegativeButton("使用密码或手势", getContext().getMainExecutor(), (dialog, which) -> finish(call, false, "已取消系统验证"))
                .build()
                .authenticate(cancellation, getContext().getMainExecutor(), new BiometricPrompt.AuthenticationCallback() {
                    @Override public void onAuthenticationSucceeded(BiometricPrompt.AuthenticationResult result) {
                        finish(call, true, "");
                    }
                    @Override public void onAuthenticationError(int code, CharSequence message) {
                        finish(call, false, message.toString());
                    }
                });
        });
    }

    private void finish(PluginCall expected, boolean verified, String message) {
        if (active != expected) return;
        PluginCall call = active;
        active = null;
        cancellation = null;
        if (call == null) return;
        if (verified) call.resolve(new JSObject().put("verified", true));
        else call.reject(message);
    }

    @Override protected void handleOnStop() {
        PluginCall call = active;
        if (cancellation != null) cancellation.cancel();
        finish(call, false, "应用进入后台，请重新验证");
        notifyListeners("background", new JSObject(), true);
    }
}
