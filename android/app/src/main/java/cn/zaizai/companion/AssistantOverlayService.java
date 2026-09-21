package cn.zaizai.companion;

import android.Manifest;
import android.app.*;
import android.content.*;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.content.res.Configuration;
import android.graphics.Color;
import android.graphics.PixelFormat;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.*;
import android.provider.Settings;
import android.view.*;
import android.webkit.*;
import android.widget.*;
import androidx.core.app.NotificationCompat;
import java.io.*;
import java.nio.charset.StandardCharsets;
import org.json.JSONObject;

public class AssistantOverlayService extends Service {
    static volatile AssistantOverlayService instance;
    private static final String ORIGIN = "https://localhost";
    private static final String CHANNEL = "assistant_overlay";
    private static final int NOTICE = 7301;
    private final Handler main = new Handler(Looper.getMainLooper());
    private WindowManager manager;
    private WindowManager.LayoutParams params;
    private FrameLayout root;
    private LinearLayout toolbar;
    private TextView edge;
    private WebView web;
    private String token, base, userId;
    private boolean expanded, voicePrepared, callActive, requiresUnlock, preparing;
    private boolean dockLeft;
    private int edgeY;
    private BroadcastReceiver screenReceiver;
    private Runnable voiceTimeout;

    static boolean dismissedFor(Context context, String user) {
        return user.equals(context.getSharedPreferences("assistant_overlay", MODE_PRIVATE).getString("dismissed_user", ""));
    }
    boolean belongsTo(String user) { return user.equals(userId); }
    private void closeByUser() {
        if (userId != null) getSharedPreferences("assistant_overlay", MODE_PRIVATE).edit().putString("dismissed_user", userId).apply();
        stopSelf();
    }
    void hostHidden() {
        if (root != null && !preparing) layout(false);
    }
    @Override public void onTaskRemoved(Intent rootIntent) {
        // Removing the activity task must leave this started service and its call intact.
        hostHidden();
        super.onTaskRemoved(rootIntent);
    }
    static void dismiss(Context context) {
        if (instance != null) instance.closeByUser();
        else context.stopService(new Intent(context, AssistantOverlayService.class));
    }
    @Override public IBinder onBind(Intent intent) { return null; }
    @Override public void onCreate() {
        super.onCreate();
        instance = this;
        manager = (WindowManager) getSystemService(WINDOW_SERVICE);
        NotificationManager notifications = getSystemService(NotificationManager.class);
        notifications.createNotificationChannel(new NotificationChannel(CHANNEL, "桌面助手", NotificationManager.IMPORTANCE_LOW));
        screenReceiver = new BroadcastReceiver() {
            @Override public void onReceive(Context context, Intent intent) {
                requiresUnlock = AppLockPlugin.hasEnabledLock(context);
                if (root != null) layout(false);
            }
        };
        IntentFilter filter = new IntentFilter(Intent.ACTION_SCREEN_OFF);
        if (Build.VERSION.SDK_INT >= 33) registerReceiver(screenReceiver, filter, RECEIVER_NOT_EXPORTED);
        else registerReceiver(screenReceiver, filter);
    }
    private int dp(int value) { return Math.round(value * getResources().getDisplayMetrics().density); }
    private int screenWidth() { return getResources().getDisplayMetrics().widthPixels; }
    private int screenHeight() { return getResources().getDisplayMetrics().heightPixels; }
    private GradientDrawable background(int color, int radius) {
        GradientDrawable result = new GradientDrawable();
        result.setColor(color); result.setCornerRadius(dp(radius)); return result;
    }
    private Notification notification() {
        PendingIntent open = PendingIntent.getActivity(this, 1, new Intent(this, MainActivity.class), PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        PendingIntent stop = PendingIntent.getService(this, 2, new Intent(this, AssistantOverlayService.class).setAction("stop"), PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_notify).setContentTitle(callActive ? "助手通话中" : "桌面助手已开启")
            .setContentText(callActive ? "收起窗口不会挂断" : "点击屏幕边缘可唤醒").setOngoing(true).setSilent(true)
            .setContentIntent(open).setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .addAction(0, callActive ? "挂断并关闭助手" : "关闭助手", stop);
        if (callActive) builder.addAction(0, "挂断", PendingIntent.getService(this, 3,
            new Intent(this, AssistantOverlayService.class).setAction("hangup"), PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT));
        return builder.build();
    }
    private void foreground(boolean microphone) {
        int type = 0;
        if (Build.VERSION.SDK_INT >= 34) type = ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE;
        if (microphone && Build.VERSION.SDK_INT >= 30) type |= ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE;
        if (Build.VERSION.SDK_INT >= 29) startForeground(NOTICE, notification(), type);
        else startForeground(NOTICE, notification());
    }
    @Override public int onStartCommand(Intent intent, int flags, int id) {
        if (intent == null) { stopSelf(); return START_NOT_STICKY; }
        String action = intent.getAction();
        if ("stop".equals(action)) { closeByUser(); return START_NOT_STICKY; }
        if ("hangup".equals(action)) { event("assistant-hangup", ""); return START_NOT_STICKY; }
        try {
            if (!Settings.canDrawOverlays(this)) throw new IllegalStateException();
            foreground(voicePrepared);
            String nextToken = intent.getStringExtra("token");
            if (web != null && (!java.util.Objects.equals(token, nextToken)
                || !java.util.Objects.equals(base, intent.getStringExtra("base"))
                || !java.util.Objects.equals(userId, intent.getStringExtra("userId")))) {
                destroyWindow();
            }
            token = nextToken; base = intent.getStringExtra("base"); userId = intent.getStringExtra("userId");
            if (token == null || base == null || userId == null) throw new IllegalArgumentException();
            requiresUnlock = false;
            if (web == null) createWindow();
            layout(!intent.getBooleanExtra("restore", false));
            getSharedPreferences("assistant_overlay", MODE_PRIVATE).edit().remove("dismissed_user").apply();
        } catch (Exception error) {
            Toast.makeText(this, "桌面助手无法启动，请检查悬浮窗权限", Toast.LENGTH_LONG).show();
            stopSelf();
        }
        return START_NOT_STICKY;
    }
    private void createWindow() throws Exception {
        root = new FrameLayout(this);
        root.setBackground(background(Color.WHITE, 8));
        root.setClipToOutline(true);
        web = new WebView(this);
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        web.addJavascriptInterface(new Commands(), "ZaizaiAssistant");
        JSONObject session = new JSONObject().put("token", token).put("base", base).put("userId", userId);
        final String bootstrap = "<script>window.__ZAIZAI_OVERLAY__=" + session.toString().replace("<", "\\u003c") + ";</script>"
            + "<meta http-equiv=\"Content-Security-Policy\" content=\"frame-src 'none'; object-src 'none'; base-uri 'none'\">";
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) { return true; }
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (!ORIGIN.equals(uri.getScheme() + "://" + uri.getAuthority())) {
                    Uri backend = Uri.parse(base);
                    if (backend.getScheme().equals(uri.getScheme()) && backend.getAuthority().equals(uri.getAuthority())) return null;
                    return response("text/plain", "");
                }
                try {
                    String path = uri.getPath();
                    if (path == null || path.contains("..") || path.contains("\\")) return response("text/plain", "");
                    if (path.equals("/")) path = "/index.html";
                    InputStream stream = getAssets().open("public" + path);
                    if (path.equals("/index.html")) {
                        String html;
                        try (InputStream input = stream; ByteArrayOutputStream output = new ByteArrayOutputStream()) {
                            byte[] buffer = new byte[8192]; int count;
                            while ((count = input.read(buffer)) != -1) output.write(buffer, 0, count);
                            html = output.toString("UTF-8");
                        }
                        return response("text/html", html.replace("<head>", "<head>" + bootstrap));
                    }
                    String mime = path.endsWith(".js") ? "application/javascript" : path.endsWith(".css") ? "text/css"
                        : path.endsWith(".png") ? "image/png" : path.endsWith(".svg") ? "image/svg+xml" : "application/octet-stream";
                    return new WebResourceResponse(mime, "UTF-8", stream);
                } catch (IOException error) { return response("text/plain", ""); }
            }
            @Override public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                Toast.makeText(AssistantOverlayService.this, "助手已中断，请返回应用重新开启", Toast.LENGTH_LONG).show();
                stopSelf(); return true;
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override public void onPermissionRequest(PermissionRequest request) {
                main.post(() -> {
                    if (voicePrepared && ORIGIN.equals(request.getOrigin().toString().replaceAll("/$", ""))
                        && checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED
                        && java.util.Arrays.asList(request.getResources()).contains(PermissionRequest.RESOURCE_AUDIO_CAPTURE)) {
                        request.grant(new String[] { PermissionRequest.RESOURCE_AUDIO_CAPTURE });
                    } else request.deny();
                });
            }
            @Override public boolean onJsConfirm(WebView view, String url, String message, JsResult result) {
                AlertDialog dialog = new AlertDialog.Builder(AssistantOverlayService.this)
                    .setMessage(message).setPositiveButton("确认", (d, which) -> result.confirm())
                    .setNegativeButton("取消", (d, which) -> result.cancel()).setOnCancelListener(d -> result.cancel()).create();
                dialog.getWindow().setType(WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY);
                dialog.show(); return true;
            }
        });
        root.addView(web);
        toolbar = new LinearLayout(this);
        toolbar.setGravity(Gravity.CENTER_VERTICAL);
        toolbar.setBackgroundColor(Color.rgb(237, 245, 255));
        TextView grip = new TextView(this);
        grip.setText("\u00b7\u00b7\u00b7"); grip.setTextSize(22); grip.setGravity(Gravity.CENTER);
        grip.setContentDescription("拖动助手窗口");
        toolbar.addView(grip, new LinearLayout.LayoutParams(0, dp(36), 1));
        TextView close = new TextView(this);
        close.setText("\u00d7"); close.setTextSize(26); close.setGravity(Gravity.CENTER);
        close.setContentDescription("关闭助手");
        close.setOnClickListener(v -> {
            if (!callActive && !preparing && !voicePrepared) { closeByUser(); return; }
            AlertDialog dialog = new AlertDialog.Builder(this).setMessage("挂断通话并关闭助手？")
                .setPositiveButton("挂断并关闭", (d, which) -> closeByUser()).setNegativeButton("取消", null).create();
            dialog.getWindow().setType(WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY);
            dialog.show();
        });
        toolbar.addView(close, new LinearLayout.LayoutParams(dp(44), dp(36)));
        root.addView(toolbar);
        edge = new TextView(this);
        edge.setText("\u00b7\u00b7\u00b7"); edge.setTextColor(Color.WHITE); edge.setTextSize(18); edge.setGravity(Gravity.CENTER);
        edge.setContentDescription("展开助手");
        root.addView(edge);
        params = new WindowManager.LayoutParams(dp(28), dp(68), WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE | WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL
                | WindowManager.LayoutParams.FLAG_SECURE, PixelFormat.TRANSLUCENT);
        params.gravity = Gravity.TOP | Gravity.LEFT;
        params.softInputMode = WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE;
        edgeY = Math.max(dp(24), screenHeight() - dp(230));
        manager.addView(root, params);
        drag(edge, true); drag(grip, false);
        web.loadUrl(ORIGIN + "/index.html");
    }
    private WebResourceResponse response(String mime, String text) {
        return new WebResourceResponse(mime, "UTF-8", new ByteArrayInputStream(text.getBytes(StandardCharsets.UTF_8)));
    }
    private void drag(View view, boolean handle) {
        view.setOnTouchListener(new View.OnTouchListener() {
            float x, y; int startX, startY; boolean moved;
            @Override public boolean onTouch(View v, android.view.MotionEvent event) {
                switch (event.getActionMasked()) {
                    case MotionEvent.ACTION_DOWN:
                        x = event.getRawX(); y = event.getRawY(); startX = params.x; startY = params.y; moved = false; return true;
                    case MotionEvent.ACTION_MOVE:
                        float dx = event.getRawX() - x, dy = event.getRawY() - y;
                        if (Math.hypot(dx, dy) > dp(5)) moved = true;
                        if (moved) {
                            params.x = Math.max(0, Math.min(screenWidth() - params.width, startX + (int) dx));
                            params.y = Math.max(dp(24), Math.min(screenHeight() - params.height - dp(32), startY + (int) dy));
                            manager.updateViewLayout(root, params);
                        }
                        return true;
                    case MotionEvent.ACTION_UP:
                        if (handle && moved) { dockLeft = params.x < screenWidth() / 2; edgeY = params.y; layout(false); }
                        else if (handle) openFromEdge();
                        v.performClick(); return true;
                    case MotionEvent.ACTION_CANCEL:
                        if (handle) layout(false);
                        return true;
                    default: return false;
                }
            }
        });
    }
    private void openFromEdge() {
        KeyguardManager keyguard = getSystemService(KeyguardManager.class);
        if (requiresUnlock || keyguard.isKeyguardLocked()) {
            startActivity(new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
            Toast.makeText(this, "解锁后从应用内打开助手", Toast.LENGTH_SHORT).show();
            return;
        }
        layout(true);
    }
    private void layout(boolean open) {
        if (root == null) return;
        expanded = open;
        int width = Math.min(dp(390), screenWidth() - dp(16));
        int height = Math.min(dp(570), screenHeight() - dp(100));
        params.width = open ? width : dp(28);
        params.height = open ? height : dp(68);
        params.x = open ? (dockLeft ? dp(8) : screenWidth() - width - dp(8)) : dockLeft ? 0 : screenWidth() - dp(28);
        params.y = Math.max(dp(24), Math.min(edgeY, screenHeight() - params.height - dp(40)));
        if (open) params.flags &= ~WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE;
        else {
            params.flags |= WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE;
            ((android.view.inputmethod.InputMethodManager) getSystemService(INPUT_METHOD_SERVICE)).hideSoftInputFromWindow(web.getWindowToken(), 0);
        }
        FrameLayout.LayoutParams webParams = new FrameLayout.LayoutParams(open ? -1 : 1, open ? -1 : 1);
        webParams.topMargin = open ? dp(36) : 0;
        web.setLayoutParams(webParams);
        // Keep the same WebView alive; collapse must not tear down its audio graph or socket.
        web.setAlpha(open ? 1 : 0);
        toolbar.setLayoutParams(new FrameLayout.LayoutParams(-1, dp(36)));
        toolbar.setVisibility(open ? View.VISIBLE : View.GONE);
        edge.setLayoutParams(new FrameLayout.LayoutParams(-1, -1));
        edge.setVisibility(open ? View.GONE : View.VISIBLE);
        edge.setBackground(background(callActive ? Color.rgb(17, 135, 91) : Color.rgb(0, 112, 240), 8));
        edge.setContentDescription(callActive ? "通话中，展开助手" : "展开助手");
        manager.updateViewLayout(root, params);
        event("assistant-visibility", open ? "open" : "collapsed");
    }
    private void event(String name, String detail) {
        if (web != null) web.evaluateJavascript("window.dispatchEvent(new CustomEvent(" + JSONObject.quote(name)
            + ",{detail:" + JSONObject.quote(detail) + "}))", null);
    }
    void prepareVoice(boolean granted) {
        preparing = false;
        if (!granted || web == null) { event("assistant-voice-error", "需要允许麦克风权限才能通话"); return; }
        try {
            voicePrepared = true;
            foreground(true);
            event("assistant-voice-ready", "");
            voiceTimeout = () -> { if (!callActive) { voicePrepared = false; foreground(false); } };
            main.postDelayed(voiceTimeout, 30000);
        } catch (Exception error) {
            voicePrepared = false; foreground(false);
            event("assistant-voice-error", "系统未允许后台语音，请返回应用后重试");
        }
    }
    private class Commands {
        @JavascriptInterface public void collapse() { main.post(() -> layout(false)); }
        @JavascriptInterface public void stop() { main.post(() -> closeByUser()); }
        @JavascriptInterface public void prepareCall() {
            main.post(() -> {
                if (preparing || callActive || !expanded || requiresUnlock) return;
                preparing = true;
                try { startActivity(new Intent(AssistantOverlayService.this, AssistantVoiceActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); }
                catch (Exception error) { preparing = false; event("assistant-voice-error", "请返回应用后重新发起通话"); }
            });
        }
        @JavascriptInterface public void setCallActive(boolean active) {
            main.post(() -> {
                if (active && !voicePrepared) return;
                callActive = active;
                if (!active) voicePrepared = false;
                if (voiceTimeout != null) main.removeCallbacks(voiceTimeout);
                foreground(voicePrepared);
                if (!expanded) layout(false);
            });
        }
    }
    @Override public void onConfigurationChanged(Configuration config) {
        super.onConfigurationChanged(config);
        layout(expanded);
    }
    private void destroyWindow() {
        if (voiceTimeout != null) main.removeCallbacks(voiceTimeout);
        if (root != null) { manager.removeView(root); root = null; }
        if (web != null) {
            web.stopLoading();
            web.removeJavascriptInterface("ZaizaiAssistant");
            web.destroy(); web = null;
        }
        callActive = false; voicePrepared = false; preparing = false;
    }
    @Override public void onDestroy() {
        instance = null;
        if (screenReceiver != null) unregisterReceiver(screenReceiver);
        main.removeCallbacksAndMessages(null);
        destroyWindow();
        token = null; base = null; userId = null;
        stopForeground(STOP_FOREGROUND_REMOVE);
        super.onDestroy();
    }
}
