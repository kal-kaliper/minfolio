package dev.folio.app;

import android.content.Intent;
import android.os.Bundle;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.PluginHandle;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Must register before super.onCreate so the bridge knows the plugins.
        registerPlugin(OpenedFilePlugin.class);
        registerPlugin(AppInstancePlugin.class);
        super.onCreate(savedInstanceState);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        if (getBridge() == null) return;
        PluginHandle handle = getBridge().getPlugin("OpenedFile");
        if (handle != null && handle.getInstance() instanceof OpenedFilePlugin) {
            ((OpenedFilePlugin) handle.getInstance()).handleNewIntent(intent);
        }
    }
}
