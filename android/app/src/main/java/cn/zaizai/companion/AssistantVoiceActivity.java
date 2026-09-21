package cn.zaizai.companion;

import android.Manifest;
import android.app.Activity;
import android.content.pm.PackageManager;
import android.os.Bundle;
import android.widget.TextView;

// A visible, user-initiated permission surface is required before microphone foreground work.
public class AssistantVoiceActivity extends Activity {
    private boolean requested;
    private boolean delivered;
    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        TextView title = new TextView(this);
        title.setText("正在准备语音通话");
        title.setPadding(32, 32, 32, 32);
        setContentView(title);
    }
    @Override public void onResume() {
        super.onResume();
        if (requested) return;
        requested = true;
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) ready(true);
        else requestPermissions(new String[] { Manifest.permission.RECORD_AUDIO }, 41);
    }
    @Override public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(requestCode, permissions, results);
        if (requestCode == 41) ready(results.length > 0 && results[0] == PackageManager.PERMISSION_GRANTED);
    }
    private void ready(boolean granted) {
        delivered = true;
        AssistantOverlayService service = AssistantOverlayService.instance;
        if (service != null) service.prepareVoice(granted);
        finish();
    }
    @Override public void onDestroy() {
        if (!delivered && AssistantOverlayService.instance != null) AssistantOverlayService.instance.prepareVoice(false);
        super.onDestroy();
    }
}
