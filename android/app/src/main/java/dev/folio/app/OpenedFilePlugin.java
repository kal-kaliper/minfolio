package dev.folio.app;

import android.content.ContentResolver;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.provider.OpenableColumns;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;

/**
 * Reads a file handed to the app via a VIEW/EDIT intent (the .md "open with"
 * association). Uses ContentResolver, which is granted temporary read access to
 * the intent's URI — this works for both content:// and file:// URIs and side-
 * steps Android's scoped-storage restrictions that block the Filesystem plugin
 * from reading arbitrary external files on Android 11+.
 */
@CapacitorPlugin(name = "OpenedFile")
public class OpenedFilePlugin extends Plugin {

    private Uri pendingUri;

    @Override
    public void load() {
        Intent intent = getActivity() != null ? getActivity().getIntent() : null;
        pendingUri = extractUri(intent);
    }

    /** Called by MainActivity when a new VIEW/EDIT intent arrives while running. */
    public void handleNewIntent(Intent intent) {
        Uri uri = extractUri(intent);
        if (uri == null) return;
        JSObject payload = describe(uri);
        payload.put("hasFile", true);
        notifyListeners("fileOpened", payload);
    }

    /** JS calls this on startup to pick up a file the app was launched with. */
    @PluginMethod
    public void getPending(PluginCall call) {
        if (pendingUri == null) {
            call.resolve(new JSObject().put("hasFile", false));
            return;
        }
        JSObject payload = describe(pendingUri);
        pendingUri = null;
        payload.put("hasFile", true);
        call.resolve(payload);
    }

    private Uri extractUri(Intent intent) {
        if (intent == null) return null;
        String action = intent.getAction();
        if (Intent.ACTION_VIEW.equals(action) || Intent.ACTION_EDIT.equals(action)) {
            return intent.getData();
        }
        return null;
    }

    /** Always returns the uri + name; includes content only if it could be read
     *  natively. (A file:// path under Documents may fail the direct read on
     *  Android 14 scoped storage, but JS can still read it via the Filesystem
     *  plugin using the uri — so we never withhold the uri.) */
    private JSObject describe(Uri uri) {
        ContentResolver cr = getContext().getContentResolver();
        JSObject o = new JSObject();
        o.put("uri", uri.toString());
        o.put("name", queryName(cr, uri));
        String content = readContent(cr, uri);
        if (content != null) o.put("content", content);
        return o;
    }

    private String readContent(ContentResolver cr, Uri uri) {
        StringBuilder sb = new StringBuilder();
        try (InputStream is = cr.openInputStream(uri);
             BufferedReader br = new BufferedReader(new InputStreamReader(is, StandardCharsets.UTF_8))) {
            char[] buf = new char[8192];
            int n;
            while ((n = br.read(buf)) != -1) sb.append(buf, 0, n);
        } catch (Exception e) {
            return null;
        }
        return sb.toString();
    }

    private String queryName(ContentResolver cr, Uri uri) {
        String name = null;
        if ("content".equals(uri.getScheme())) {
            try (Cursor c = cr.query(uri, null, null, null, null)) {
                if (c != null && c.moveToFirst()) {
                    int idx = c.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                    if (idx >= 0) name = c.getString(idx);
                }
            } catch (Exception ignored) {
            }
        }
        if (name == null || name.isEmpty()) {
            String last = uri.getLastPathSegment();
            name = (last != null && !last.isEmpty()) ? last : "untitled.md";
        }
        return name;
    }
}
