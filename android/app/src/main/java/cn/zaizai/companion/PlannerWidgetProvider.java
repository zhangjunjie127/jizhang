package cn.zaizai.companion;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.widget.RemoteViews;
import org.json.JSONArray;
import org.json.JSONObject;

public class PlannerWidgetProvider extends AppWidgetProvider {
    @Override public void onUpdate(Context context, AppWidgetManager manager, int[] ids) {
        String kind = this instanceof CourseWidgetProvider ? "courses" : "tasks";
        for (int id : ids) render(context, manager, id, kind);
    }
    static void refresh(Context context) {
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        for (Class<?> type : new Class<?>[] {TaskWidgetProvider.class, CourseWidgetProvider.class}) {
            for (int id : manager.getAppWidgetIds(new ComponentName(context, type))) {
                render(context, manager, id, type == CourseWidgetProvider.class ? "courses" : "tasks");
            }
        }
    }
    private static void render(Context context, AppWidgetManager manager, int id, String kind) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.planner_widget);
        views.setTextViewText(R.id.widget_title, "courses".equals(kind) ? "在在 · 课程提醒" : "在在 · 待办");
        String body = "打开应用，启用桌面小组件";
        String footer = "点击打开在在";
        try {
            JSONObject snapshot = new JSONObject(context.getSharedPreferences("desktop-widgets", 0).getString("snapshot", "{}"));
            JSONObject data = snapshot.optJSONObject(kind);
            if (data != null && data.optBoolean("enabled")) {
                if (snapshot.optLong("expires") <= System.currentTimeMillis()) body = "数据已过期，请打开应用刷新";
                else if (snapshot.optBoolean("private", true)) body = "内容已隐藏，打开应用查看";
                else {
                    JSONArray rows = data.optJSONArray("rows");
                    String layout = snapshot.optString("layout", "list");
                    StringBuilder text = new StringBuilder();
                    int shown = 0;
                    for (int i = 0; rows != null && i < rows.length() && shown < 3; i++) {
                        JSONObject row = rows.getJSONObject(i);
                        if (row.optLong("end") > 0 && row.optLong("end") <= System.currentTimeMillis()) continue;
                        if (shown++ > 0) text.append("\n\n");
                        if ("week".equals(layout)) text.append(row.optString("date", row.optString("detail"))).append("  ");
                        text.append(row.optString("title")).append("\n").append(row.optString("detail"));
                    }
                    body = shown == 0 ? data.optString("message", "暂无内容") : text.toString();
                    if ("month".equals(layout) && shown > 0) body = "本月日程\n" + body;
                }
                java.text.SimpleDateFormat format = new java.text.SimpleDateFormat("MM-dd HH:mm", java.util.Locale.CHINA);
                footer = "同步于 " + format.format(new java.util.Date(snapshot.optLong("updated"))) + " · 点击刷新";
            }
        } catch (Exception ignored) { body = "请打开应用重新同步"; }
        views.setTextViewText(R.id.widget_body, body);
        views.setTextViewText(R.id.widget_footer, footer);
        Intent intent = new Intent(context, MainActivity.class).putExtra("widgetTarget", kind)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent tap = PendingIntent.getActivity(context, "courses".equals(kind) ? 7102 : 7101,
            intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        views.setOnClickPendingIntent(R.id.widget_root, tap);
        manager.updateAppWidget(id, views);
    }
}
