package cn.zaizai.companion;

import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.os.Build;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "DesktopWidgets")
public class DesktopWidgetsPlugin extends Plugin {
    @PluginMethod public void sync(PluginCall call) {
        JSObject snapshot = call.getObject("snapshot");
        if (snapshot == null || snapshot.toString().length() > 100000) { call.reject("Invalid widget data"); return; }
        getContext().getSharedPreferences("desktop-widgets", 0).edit().putString("snapshot", snapshot.toString()).apply();
        PlannerWidgetProvider.refresh(getContext());
        call.resolve();
    }
    @PluginMethod public void clear(PluginCall call) {
        getContext().getSharedPreferences("desktop-widgets", 0).edit().clear().apply();
        PlannerWidgetProvider.refresh(getContext());
        call.resolve();
    }
    @PluginMethod public void pin(PluginCall call) {
        String kind = call.getString("kind");
        if (!"tasks".equals(kind) && !"courses".equals(kind)) { call.reject("Invalid widget kind"); return; }
        AppWidgetManager manager = AppWidgetManager.getInstance(getContext());
        boolean requested = false;
        if (Build.VERSION.SDK_INT >= 26 && manager.isRequestPinAppWidgetSupported()) {
            requested = manager.requestPinAppWidget(new ComponentName(getContext(),
                "courses".equals(kind) ? CourseWidgetProvider.class : TaskWidgetProvider.class), null, null);
        }
        call.resolve(new JSObject().put("requested", requested));
    }
    @PluginMethod public void getLaunchTarget(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            String target = getActivity().getIntent().getStringExtra("widgetTarget");
            getActivity().getIntent().removeExtra("widgetTarget");
            call.resolve(new JSObject().put("target", target == null ? "" : target));
        });
    }
}
