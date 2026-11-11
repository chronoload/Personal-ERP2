package com.personal.erp.lockscreen;

import android.content.Context;
import android.content.SharedPreferences;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.personal.erp.widget.WidgetKeys;
import com.personal.erp.widget.WidgetStore;

import org.json.JSONObject;

/**
 * 锁屏 / 开屏 桥：
 *   setEnabled({enabled, full})  写入偏好并立即生效（开→发通知+排每日 07:00；关→撤通知+撤闹钟）
 *   getState()                   {enabled, full, canFullScreen}
 *   preview()                    立即发一条带全屏意图的通知（设置页「预览」用）
 *   refresh()                    仅更新通知内容（不触发全屏）
 */
@CapacitorPlugin(name = "LockScreen")
public class LockScreenPlugin extends Plugin {

  @PluginMethod
  public void setEnabled(PluginCall call) {
    try {
      Boolean enabled = call.getBoolean("enabled");
      Boolean full = call.getBoolean("full");
      boolean on = enabled != null && enabled;
      SharedPreferences sp = getContext().getSharedPreferences(WidgetKeys.PREFS_FILE, Context.MODE_PRIVATE);
      String raw = sp.getString(WidgetKeys.KEY_PREFS, null);
      JSONObject o;
      try { o = raw != null ? new JSONObject(raw) : new JSONObject(); } catch (Exception e) { o = new JSONObject(); }
      o.put("lockScreenToday", on);
      if (full != null) o.put("lockScreenFull", full);
      sp.edit().putString(WidgetKeys.KEY_PREFS, o.toString()).apply();

      if (on) {
        LockScreenNotifier.ensureChannel(getContext());
        LockScreenNotifier.scheduleDaily(getContext());
        LockScreenNotifier.post(getContext(), false);
      } else {
        LockScreenNotifier.cancelDaily(getContext());
        LockScreenNotifier.cancel(getContext());
      }
      JSObject ret = new JSObject();
      ret.put("enabled", on);
      ret.put("full", WidgetStore.isLockFull(getContext()));
      call.resolve(ret);
    } catch (Exception e) { call.reject(e.getMessage()); }
  }

  @PluginMethod
  public void getState(PluginCall call) {
    JSObject ret = new JSObject();
    ret.put("enabled", WidgetStore.isLockEnabled(getContext()));
    ret.put("full", WidgetStore.isLockFull(getContext()));
    ret.put("canFullScreen", LockScreenNotifier.canUseFullScreen(getContext()));
    call.resolve(ret);
  }

  @PluginMethod
  public void preview(PluginCall call) {
    try {
      LockScreenNotifier.ensureChannel(getContext());
      LockScreenNotifier.preview(getContext());
      JSObject ret = new JSObject();
      ret.put("ok", WidgetStore.isLockEnabled(getContext()));
      ret.put("canFullScreen", LockScreenNotifier.canUseFullScreen(getContext()));
      call.resolve(ret);
    } catch (Exception e) { call.reject(e.getMessage()); }
  }

  @PluginMethod
  public void refresh(PluginCall call) {
    try {
      LockScreenNotifier.post(getContext(), false);
      JSObject ret = new JSObject();
      ret.put("ok", true);
      call.resolve(ret);
    } catch (Exception e) { call.reject(e.getMessage()); }
  }
}
