package cn.zaizai.companion;

import android.app.Activity;
import android.content.Intent;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

@CapacitorPlugin(name = "DocumentExport")
public class DocumentExportPlugin extends Plugin {
    @PluginMethod
    public void save(PluginCall call) {
        String text = call.getString("text");
        String filename = call.getString("filename", "zaizai-ledger.csv");
        String mimeType = call.getString("mimeType", "text/csv");
        boolean csv = filename.matches("[a-zA-Z0-9-]+\\.csv") && "text/csv".equals(mimeType);
        boolean json = filename.matches("[a-zA-Z0-9-]+\\.json") && "application/json".equals(mimeType);
        if (text == null || text.length() > 150_000_000 || (!csv && !json)) {
            call.reject("Invalid export data");
            return;
        }
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType(mimeType);
        intent.putExtra(Intent.EXTRA_TITLE, filename);
        startActivityForResult(call, intent, "documentSelected");
    }

    @ActivityCallback
    private void documentSelected(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null || result.getData().getData() == null) {
            call.resolve(new JSObject().put("cancelled", true));
            return;
        }
        getBridge().execute(() -> {
            try (OutputStream output = getContext().getContentResolver().openOutputStream(result.getData().getData(), "wt")) {
                if (output == null) throw new java.io.IOException("No output stream");
                String text = call.getString("text", "");
                if ("text/csv".equals(call.getString("mimeType", "text/csv")) && !text.startsWith("\uFEFF")) text = "\uFEFF" + text;
                output.write(text.getBytes(StandardCharsets.UTF_8));
                call.resolve(new JSObject().put("cancelled", false));
            } catch (Exception error) {
                call.reject("Could not save file", error);
            }
        });
    }
}
