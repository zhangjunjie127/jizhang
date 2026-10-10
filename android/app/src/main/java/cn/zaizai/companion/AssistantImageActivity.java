package cn.zaizai.companion;

import android.app.Activity;
import android.content.ClipData;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.provider.MediaStore;
import android.widget.Toast;
import androidx.core.content.FileProvider;
import java.io.File;
import java.util.ArrayList;

// The service WebView has no Activity to receive camera/document-picker results.
public class AssistantImageActivity extends Activity {
    private String requestId;
    private Uri cameraUri;
    private boolean delivered;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        requestId = getIntent().getStringExtra("requestId");
        AssistantOverlayService service = AssistantOverlayService.instance;
        if (service == null || !service.ownsFileRequest(requestId)) { finish(); return; }
        if (state != null) {
            String uri = state.getString("cameraUri");
            cameraUri = uri == null ? null : Uri.parse(uri);
            return;
        }
        try {
            Intent intent;
            if (getIntent().getBooleanExtra("capture", false)) {
                File directory = new File(getCacheDir(), "assistant-camera");
                if (!directory.exists() && !directory.mkdirs()) throw new java.io.IOException();
                File[] old = directory.listFiles();
                if (old != null) for (File file : old) {
                    if (file.lastModified() < System.currentTimeMillis() - 86400000L) file.delete();
                }
                File photo = File.createTempFile("capture-", ".jpg", directory);
                cameraUri = FileProvider.getUriForFile(this, getPackageName() + ".fileprovider", photo);
                intent = new Intent(MediaStore.ACTION_IMAGE_CAPTURE).putExtra(MediaStore.EXTRA_OUTPUT, cameraUri)
                    .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
                intent.setClipData(ClipData.newRawUri("photo", cameraUri));
            } else {
                intent = new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("image/*")
                    .putExtra(Intent.EXTRA_ALLOW_MULTIPLE, getIntent().getBooleanExtra("multiple", false));
            }
            startActivityForResult(intent, 51);
        } catch (Exception error) {
            Toast.makeText(this, "无法打开相机或相册，请检查系统应用是否可用", Toast.LENGTH_LONG).show();
            deliver(null);
        }
    }
    @Override protected void onSaveInstanceState(Bundle state) {
        super.onSaveInstanceState(state);
        if (cameraUri != null) state.putString("cameraUri", cameraUri.toString());
    }
    @Override protected void onActivityResult(int code, int result, Intent data) {
        super.onActivityResult(code, result, data);
        if (code != 51) return;
        if (result != RESULT_OK) { deliver(null); return; }
        if (cameraUri != null) { deliver(new Uri[] { cameraUri }); return; }
        ArrayList<Uri> files = new ArrayList<>();
        try {
            if (data != null && data.getClipData() != null) {
                if (data.getClipData().getItemCount() > 6) throw new IllegalArgumentException();
                for (int i = 0; i < data.getClipData().getItemCount(); i++) files.add(data.getClipData().getItemAt(i).getUri());
            } else if (data != null && data.getData() != null) files.add(data.getData());
            for (Uri uri : files) {
                String type = getContentResolver().getType(uri);
                if (!"content".equals(uri.getScheme()) || (getPackageName() + ".fileprovider").equals(uri.getAuthority())
                    || type == null || !type.startsWith("image/")) throw new IllegalArgumentException();
            }
            deliver(files.isEmpty() ? null : files.toArray(new Uri[0]));
        } catch (Exception error) {
            Toast.makeText(this, "请选择最多6张可读取的图片", Toast.LENGTH_LONG).show();
            deliver(null);
        }
    }
    private void deliver(Uri[] files) {
        delivered = true;
        AssistantOverlayService service = AssistantOverlayService.instance;
        if (service != null) service.finishFileRequest(requestId, files);
        finish();
    }
    @Override protected void onDestroy() {
        if (isFinishing() && !delivered) {
            AssistantOverlayService service = AssistantOverlayService.instance;
            if (service != null) service.finishFileRequest(requestId, null);
        }
        super.onDestroy();
    }
}
