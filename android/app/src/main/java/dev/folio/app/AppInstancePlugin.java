package dev.folio.app;

import android.content.Intent;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.Collections;
import java.util.HashSet;
import java.util.Set;

/**
 * Assigns each live app window ("instance") a small stable slot id so multiple
 * open copies can persist their session under separate keys instead of
 * clobbering a single shared one. Slots are reused once a window closes.
 *
 * Instances of a standard-launchMode activity share one process, so a static
 * registry coordinates slots across all open windows.
 */
@CapacitorPlugin(name = "AppInstance")
public class AppInstancePlugin extends Plugin {

    private static final Set<Integer> USED_SLOTS = Collections.synchronizedSet(new HashSet<>());

    private int slot = -1;

    @Override
    public void load() {
        synchronized (USED_SLOTS) {
            int s = 1;
            while (USED_SLOTS.contains(s)) s++;
            USED_SLOTS.add(s);
            slot = s;
        }
    }

    @Override
    protected void handleOnDestroy() {
        if (slot != -1) {
            USED_SLOTS.remove(slot);
            slot = -1;
        }
        super.handleOnDestroy();
    }

    /** Returns this window's slot (1 for the first/primary window). */
    @PluginMethod
    public void getSlot(PluginCall call) {
        call.resolve(new JSObject().put("slot", slot));
    }

    /** Launch another window (a fresh MainActivity instance) as a separate task,
     *  so two copies of the app can run side by side. */
    @PluginMethod
    public void openNewWindow(PluginCall call) {
        Intent intent = new Intent(getContext(), MainActivity.class);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_MULTIPLE_TASK);
        getContext().startActivity(intent);
        call.resolve();
    }
}
