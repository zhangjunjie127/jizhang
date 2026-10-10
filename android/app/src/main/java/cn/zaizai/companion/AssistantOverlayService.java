package cn.zaizai.companion;

import android.Manifest;
import android.animation.Animator;
import android.animation.AnimatorListenerAdapter;
import android.animation.ValueAnimator;
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
    private WindowManager.LayoutParams catParams;
    private FrameLayout root, content;
    private FrameLayout catRoot;
    private WebView catWeb;
    private ValueAnimator panelMotion;
    private final android.graphics.Path panelClip = new android.graphics.Path();
    private final android.graphics.Matrix cornerMatrix = new android.graphics.Matrix();
    private boolean pageReady, pendingOpen;
    private LinearLayout toolbar;
    private View edge;
    private WebView web;
    private String token, base, userId;
    private boolean expanded, voicePrepared, callActive, requiresUnlock, preparing;
    private boolean dockLeft;
    private int edgeY;
    private int unread;
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
    private int dp(float value) { return Math.round(value * getResources().getDisplayMetrics().density); }
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
            boolean open = !intent.getBooleanExtra("restore", false);
            if (!pageReady) {
                layout(false);
                pendingOpen = open;
            } else if (open) animatePresentation(true);
            else layout(false);
            getSharedPreferences("assistant_overlay", MODE_PRIVATE).edit().remove("dismissed_user").apply();
        } catch (Exception error) {
            Toast.makeText(this, "桌面助手无法启动，请检查悬浮窗权限", Toast.LENGTH_LONG).show();
            stopSelf();
        }
        return START_NOT_STICKY;
    }
    private void createWindow() throws Exception {
        root = new FrameLayout(this) {
            @Override protected void dispatchDraw(android.graphics.Canvas canvas) {
                int saved = canvas.save();
                if (panelMotion != null) {
                    canvas.translate(content.getLeft(), content.getTop());
                    canvas.concat(cornerMatrix);
                    canvas.clipPath(panelClip);
                    canvas.translate(-content.getLeft(), -content.getTop());
                }
                super.dispatchDraw(canvas);
                canvas.restoreToCount(saved);
            }
        };
        root.setClipChildren(false);
        content = new FrameLayout(this);
        root.addView(content, new FrameLayout.LayoutParams(-1, -1));
        web = new WebView(this);
        web.setBackgroundColor(Color.TRANSPARENT);
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        web.addJavascriptInterface(new Commands(), "ZaizaiAssistant");
        JSONObject session = new JSONObject().put("token", token).put("base", base).put("userId", userId).put("separateCat", true);
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
                        : path.endsWith(".png") ? "image/png" : path.endsWith(".gif") ? "image/gif"
                        : path.endsWith(".svg") ? "image/svg+xml" : "application/octet-stream";
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
        content.addView(web);
        toolbar = new LinearLayout(this);
        toolbar.setGravity(Gravity.CENTER_VERTICAL);
        toolbar.setBackgroundColor(Color.rgb(237, 245, 255));
        TextView grip = new TextView(this);
        grip.setText("\u00b7\u00b7\u00b7"); grip.setTextSize(22); grip.setGravity(Gravity.CENTER);
        grip.setContentDescription("拖动助手窗口");
        toolbar.addView(grip, new LinearLayout.LayoutParams(0, dp(36), 1));
        content.addView(toolbar);
        params = new WindowManager.LayoutParams(dp(28), dp(68), WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE | WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL
                | WindowManager.LayoutParams.FLAG_SECURE, PixelFormat.TRANSLUCENT);
        params.gravity = Gravity.TOP | Gravity.LEFT;
        params.softInputMode = WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE;
        edgeY = Math.max(dp(24), screenHeight() - dp(230));
        manager.addView(root, params);
        createCatWindow();
        drag(edge, true); drag(grip, false);
        web.loadUrl(ORIGIN + "/index.html");
    }
    private void createCatWindow() {
        // A separate non-focusable window stays above the panel and never joins its animation.
        catRoot = new FrameLayout(this);
        catWeb = new WebView(this);
        catWeb.setBackgroundColor(Color.TRANSPARENT);
        catWeb.getSettings().setJavaScriptEnabled(true);
        catWeb.getSettings().setAllowFileAccess(false);
        catWeb.getSettings().setAllowContentAccess(false);
        catWeb.addJavascriptInterface(new CatCommands(), "ZaizaiCat");
        catWeb.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) { return true; }
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (!ORIGIN.equals(uri.getScheme() + "://" + uri.getAuthority())) return response("text/plain", "");
                String path = uri.getPath();
                if (path == null || path.contains("..") || path.contains("\\")
                    || !(path.equals("/assistant-cat.html") || path.startsWith("/assets/") || path.startsWith("/assistant-gifs/"))) {
                    return response("text/plain", "");
                }
                try {
                    String mime = path.endsWith(".html") ? "text/html" : path.endsWith(".js") ? "application/javascript"
                        : path.endsWith(".css") ? "text/css" : path.endsWith(".gif") ? "image/gif" : "image/png";
                    return new WebResourceResponse(mime, "UTF-8", getAssets().open("public" + path));
                } catch (IOException error) { return response("text/plain", ""); }
            }
            @Override public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                stopSelf(); return true;
            }
        });
        catRoot.addView(catWeb, new FrameLayout.LayoutParams(-1, -1));
        edge = new View(this);
        edge.setContentDescription("展开助手");
        edge.setOnClickListener(v -> { if (panelMotion == null) { if (expanded) animatePresentation(false); else openFromEdge(); } });
        catRoot.addView(edge, new FrameLayout.LayoutParams(-1, -1));
        catParams = new WindowManager.LayoutParams(dp(62.4f), dp(62.4f), WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE | WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL
                | WindowManager.LayoutParams.FLAG_SECURE, PixelFormat.TRANSLUCENT);
        catParams.gravity = Gravity.TOP | Gravity.LEFT;
        catParams.softInputMode = WindowManager.LayoutParams.SOFT_INPUT_ADJUST_NOTHING;
        catParams.x = dockLeft ? 0 : screenWidth() - catParams.width;
        catParams.y = Math.max(dp(24), Math.min(edgeY, screenHeight() - catParams.height - dp(40)));
        manager.addView(catRoot, catParams);
        catWeb.loadUrl(ORIGIN + "/assistant-cat.html");
    }
    private void syncCat() {
        if (catWeb == null) return;
        edge.setContentDescription(expanded ? "收起助手" : "展开助手");
        catWeb.evaluateJavascript("window.dispatchEvent(new CustomEvent('assistant-cat-state',{detail:{dock:'"
            + (dockLeft ? "left" : "right") + "',active:" + callActive + ",expanded:" + expanded + ",unread:" + unread + "}}))", null);
    }
    private class CatCommands {
        @JavascriptInterface public void ready() { main.post(() -> syncCat()); }
        @JavascriptInterface public void toggle() {
            main.post(() -> { if (edge != null && panelMotion == null) edge.performClick(); });
        }
    }
    private WebResourceResponse response(String mime, String text) {
        return new WebResourceResponse(mime, "UTF-8", new ByteArrayInputStream(text.getBytes(StandardCharsets.UTF_8)));
    }
    private void drag(View view, boolean handle) {
        view.setOnTouchListener(new View.OnTouchListener() {
            float x, y; int startX, startY; boolean moved, tracking;
            @Override public boolean onTouch(View v, android.view.MotionEvent event) {
                if (panelMotion != null) { tracking = false; return true; }
                if (event.getActionMasked() != MotionEvent.ACTION_DOWN && !tracking) return true;
                WindowManager.LayoutParams target = handle ? catParams : params;
                switch (event.getActionMasked()) {
                    case MotionEvent.ACTION_DOWN:
                        tracking = true;
                        if (handle) event("assistant-touch", "");
                        x = event.getRawX(); y = event.getRawY(); startX = target.x; startY = target.y; moved = false; return true;
                    case MotionEvent.ACTION_MOVE:
                        float dx = event.getRawX() - x, dy = event.getRawY() - y;
                        if (Math.hypot(dx, dy) > dp(5)) moved = true;
                        if (moved && !(handle && expanded)) {
                            target.x = Math.max(0, Math.min(screenWidth() - target.width, startX + (int) dx));
                            target.y = Math.max(dp(24), Math.min(screenHeight() - target.height - dp(32), startY + (int) dy));
                            manager.updateViewLayout(handle ? catRoot : root, target);
                        }
                        return true;
                    case MotionEvent.ACTION_UP:
                        tracking = false;
                        if (handle && moved && !expanded) { dockLeft = catParams.x < screenWidth() / 2; edgeY = catParams.y; layout(false); }
                        else if (!moved) v.performClick();
                        return true;
                    case MotionEvent.ACTION_CANCEL:
                        tracking = false;
                        if (handle && !expanded) layout(false);
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
        if (!pageReady) { pendingOpen = true; return; }
        animatePresentation(true);
    }
    private void cancelPanelMotion() {
        if (panelMotion != null) {
            panelMotion.removeAllListeners();
            panelMotion.cancel();
            panelMotion = null;
        }
        if (content != null) {
            content.setTranslationX(0); content.setTranslationY(0);
            content.setScaleX(1); content.setScaleY(1); content.setAlpha(1);
        }
        if (params != null) params.flags &= ~WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE;
    }
    private void animatePresentation(boolean open) {
        if (root == null || panelMotion != null || expanded == open) return;
        if (!ValueAnimator.areAnimatorsEnabled()) { layout(open); return; }
        int catSize = dp(62.4f);
        int catX = catParams.x;
        int catY = catParams.y;
        if (open) layout(true);
        else ((android.view.inputmethod.InputMethodManager) getSystemService(INPUT_METHOD_SERVICE))
            .hideSoftInputFromWindow(web.getWindowToken(), 0);
        final int panelX = params.x, panelY = params.y, width = params.width, height = params.height;
        int padding = dp(8);
        int unionX = Math.max(0, Math.min(panelX, catX) - padding);
        int unionY = Math.max(0, Math.min(panelY, catY) - padding);
        // The union window prevents clipping while the same live WebView travels to the cat.
        params.x = unionX; params.y = unionY;
        params.width = Math.min(screenWidth(), Math.max(panelX + width, catX + catSize) + padding) - unionX;
        params.height = Math.min(screenHeight(), Math.max(panelY + height, catY + catSize) + padding) - unionY;
        params.flags |= WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE;
        FrameLayout.LayoutParams bounds = new FrameLayout.LayoutParams(width, height);
        bounds.leftMargin = panelX - unionX; bounds.topMargin = panelY - unionY;
        content.setLayoutParams(bounds);
        content.setPivotX(0); content.setPivotY(0);
        final int anchorX = catX + catSize / 2f >= panelX + width / 2f ? 1 : 0;
        final int anchorY = catY + catSize / 2f >= panelY + height / 2f ? 1 : 0;
        float[] source = {0, 0, width, 0, width, height, 0, height};
        float[] target = new float[8];
        int[] unit = {0, 0, 1, 0, 1, 1, 0, 1};
        content.setClipToOutline(false);
        content.setBackgroundColor(Color.WHITE);
        panelMotion = ValueAnimator.ofFloat(0, 1);
        panelMotion.setDuration(open ? 500 : 460);
        panelMotion.setInterpolator(new android.view.animation.LinearInterpolator());
        panelMotion.addUpdateListener(value -> {
            float time = (float) value.getAnimatedValue();
            if (open) time = 1 - time;
            float progress = time * time * time * (time * (6 * time - 15) + 10);
            float pinch = .62f * (float) Math.sin(Math.PI * progress);
            float w = width + (catSize - width) * progress;
            float h = height + (catSize - height) * progress;
            // Match cornerPanelQuad: leave a narrow tip pointing at the cat.
            for (int i = 0; i < 8; i += 2) {
                int u = unit[i], v = unit[i + 1];
                target[i] = (catX - panelX) * progress
                    + (u + (u == anchorX && v != anchorY ? (1 - 2 * anchorX) * pinch : 0)) * w;
                target[i + 1] = (catY - panelY) * progress
                    + (v + (v == anchorY && u != anchorX ? (1 - 2 * anchorY) * pinch : 0)) * h;
            }
            cornerMatrix.setPolyToPoly(source, 0, target, 0, 4);
            float bend = progress > 0 && progress < 1 ? (float) Math.sin(Math.PI * progress) : 0;
            float bow = Math.min(width, height) * .065f * bend;
            float r = dp(8) + Math.min(width, height) * .02f * bend;
            // Match softPanelPath: soften the outline without inflating the panel.
            panelClip.reset();
            panelClip.moveTo(r, 0);
            panelClip.cubicTo(width * .25f, 0, width * .3f, bow, width / 2f, bow);
            panelClip.cubicTo(width * .7f, bow, width * .75f, 0, width - r, 0);
            panelClip.quadTo(width, 0, width, r);
            panelClip.cubicTo(width, height * .25f, width - bow, height * .3f, width - bow, height / 2f);
            panelClip.cubicTo(width - bow, height * .7f, width, height * .75f, width, height - r);
            panelClip.quadTo(width, height, width - r, height);
            panelClip.cubicTo(width * .75f, height, width * .7f, height - bow, width / 2f, height - bow);
            panelClip.cubicTo(width * .3f, height - bow, width * .25f, height, r, height);
            panelClip.quadTo(0, height, 0, height - r);
            panelClip.cubicTo(0, height * .75f, bow, height * .7f, bow, height / 2f);
            panelClip.cubicTo(bow, height * .3f, 0, height * .25f, 0, r);
            panelClip.quadTo(0, 0, r, 0);
            panelClip.close();
            content.setAlpha(1 - .95f * Math.max(0, (progress - .8f) / .2f));
            root.invalidate();
        });
        panelMotion.addListener(new AnimatorListenerAdapter() {
            @Override public void onAnimationEnd(Animator animation) {
                panelMotion = null;
                layout(open);
            }
        });
        panelMotion.start();
        manager.updateViewLayout(root, params);
    }
    private void layout(boolean open) {
        if (root == null) return;
        pendingOpen = false;
        cancelPanelMotion();
        content.setLayoutParams(new FrameLayout.LayoutParams(-1, -1));
        expanded = open;
        root.setVisibility(open ? View.VISIBLE : View.INVISIBLE);
        int width = Math.min(dp(390), screenWidth() - dp(16));
        int height = Math.min(dp(570), screenHeight() - dp(100));
        params.width = open ? width : dp(62.4f);
        params.height = open ? height : dp(62.4f);
        params.x = open ? (dockLeft ? dp(8) : screenWidth() - width - dp(8)) : dockLeft ? 0 : screenWidth() - params.width;
        params.y = Math.max(dp(24), Math.min(edgeY, screenHeight() - params.height - dp(40)));
        if (open) params.flags &= ~WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE;
        else {
            params.flags |= WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE;
            ((android.view.inputmethod.InputMethodManager) getSystemService(INPUT_METHOD_SERVICE)).hideSoftInputFromWindow(web.getWindowToken(), 0);
        }
        content.setBackground(open ? background(Color.WHITE, 8) : null);
        content.setClipToOutline(open);
        FrameLayout.LayoutParams webParams = new FrameLayout.LayoutParams(-1, -1);
        webParams.topMargin = open ? dp(36) : 0;
        web.setLayoutParams(webParams);
        // Keep the same WebView alive; collapse must not tear down its audio graph or socket.
        toolbar.setLayoutParams(new FrameLayout.LayoutParams(-1, dp(36)));
        toolbar.setVisibility(open ? View.VISIBLE : View.GONE);
        catParams.x = dockLeft ? 0 : screenWidth() - catParams.width;
        catParams.y = Math.max(dp(24), Math.min(edgeY, screenHeight() - catParams.height - dp(40)));
        manager.updateViewLayout(catRoot, catParams);
        manager.updateViewLayout(root, params);
        syncPresentation();
    }
    private void syncPresentation() {
        event("assistant-dock", dockLeft ? "left" : "right");
        event("assistant-visibility", expanded ? "open" : "collapsed");
        syncCat();
    }
    private void event(String name, String detail) {
        if (web != null) web.evaluateJavascript("window.dispatchEvent(new CustomEvent(" + JSONObject.quote(name)
            + ",{detail:" + JSONObject.quote(detail) + "}))", null);
        if (catWeb != null && name.equals("assistant-touch")) catWeb.evaluateJavascript("window.dispatchEvent(new Event('assistant-touch'))", null);
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
        @JavascriptInterface public void setUnread(int count) {
            main.post(() -> { unread = Math.max(0, count); syncCat(); });
        }
        @JavascriptInterface public void syncPresentation() {
            main.post(() -> {
                pageReady = true;
                if (pendingOpen) { pendingOpen = false; animatePresentation(true); }
                else AssistantOverlayService.this.syncPresentation();
            });
        }
        @JavascriptInterface public void expand() { main.post(() -> openFromEdge()); }
        @JavascriptInterface public void collapse() { main.post(() -> animatePresentation(false)); }
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
                syncCat();
                if (!expanded) layout(false);
            });
        }
    }
    @Override public void onConfigurationChanged(Configuration config) {
        super.onConfigurationChanged(config);
        layout(expanded);
    }
    private void destroyWindow() {
        cancelPanelMotion();
        pageReady = false; pendingOpen = false;
        if (voiceTimeout != null) main.removeCallbacks(voiceTimeout);
        if (root != null) { if (root.isAttachedToWindow()) manager.removeView(root); root = null; }
        if (catRoot != null) { if (catRoot.isAttachedToWindow()) manager.removeView(catRoot); catRoot = null; }
        if (catWeb != null) {
            catWeb.stopLoading();
            catWeb.removeJavascriptInterface("ZaizaiCat");
            catWeb.destroy(); catWeb = null;
        }
        edge = null; catParams = null;
        if (web != null) {
            web.stopLoading();
            web.removeJavascriptInterface("ZaizaiAssistant");
            web.destroy(); web = null;
        }
        callActive = false; voicePrepared = false; preparing = false; unread = 0;
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
