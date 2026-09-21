package cn.zaizai.companion;

import com.getcapacitor.BridgeActivity;
import android.os.Bundle;
import android.view.WindowManager;

public class MainActivity extends BridgeActivity {
    @Override public void onStop() {
        super.onStop();
        if (AssistantOverlayService.instance != null) AssistantOverlayService.instance.hostHidden();
    }
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(DocumentExportPlugin.class);
        registerPlugin(AppLockPlugin.class);
        registerPlugin(FloatingAssistantPlugin.class);
        registerPlugin(ReminderSoundPlugin.class);
        super.onCreate(savedInstanceState);
        if (AppLockPlugin.hasEnabledLock(this)) getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
    }
}
