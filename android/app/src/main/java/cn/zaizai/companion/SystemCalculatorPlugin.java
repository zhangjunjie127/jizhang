package cn.zaizai.companion;

import android.content.ActivityNotFoundException;
import android.content.Intent;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "SystemCalculator")
public class SystemCalculatorPlugin extends Plugin {
    @PluginMethod
    public void open(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            try {
                Intent intent = Intent.makeMainSelectorActivity(
                    Intent.ACTION_MAIN, Intent.CATEGORY_APP_CALCULATOR);
                getActivity().startActivity(intent);
                call.resolve();
            } catch (ActivityNotFoundException error) {
                call.reject("手机未找到可用的系统计算器", "UNAVAILABLE");
            } catch (SecurityException error) {
                call.reject("系统禁止打开计算器，请检查手机设置", "DENIED");
            }
        });
    }
}
