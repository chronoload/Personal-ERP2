package com.personal.erp.widget;

import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.SharedPreferences;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "Widget")
public class WidgetPlugin extends Plugin {

  // 数据桥接：JS 侧把 db + prefs 主动推给原生写入 SharedPreferences("CapacitorStorage")，
  // 小组件 Provider 从这里读数据渲染（Capacitor 8 不再自动同步 localStorage）。
  // 防覆盖：桌面小组件独立产生的流水（native_txs 记录的 id）在推送时回合并进 JS db，
  // 否则 JS 下一次推送会用旧数据抹掉桌面端的消费记录。
  @PluginMethod
  public void pushData(PluginCall call) {
    try {
      String db = call.getString("db");
      String prefs = call.getString("prefs");
      boolean hasNativeTx = false;
      if (db != null) {
        db = mergeNativeTxs(db);
        try {
          org.json.JSONArray ids = new org.json.JSONObject(db).optJSONArray("native_txs");
          hasNativeTx = ids != null && ids.length() > 0;
        } catch (Exception ignored) {}
      }
      SharedPreferences sp = getContext().getSharedPreferences(WidgetKeys.PREFS_FILE, Context.MODE_PRIVATE);
      SharedPreferences.Editor ed = sp.edit();
      if (db != null) ed.putString(WidgetKeys.KEY_DB, db);
      if (prefs != null) ed.putString(WidgetKeys.KEY_PREFS, prefs);
      // 还有未回读的原生流水时递增修订号：JS 回前台会 pullFromNative 把它并进本地库
      if (hasNativeTx) ed.putLong(WidgetKeys.KEY_REV, sp.getLong(WidgetKeys.KEY_REV, 0) + 1);
      ed.apply();
      refreshAll();
      JSObject ret = new JSObject();
      ret.put("ok", true);
      call.resolve(ret);
    } catch (Exception e) {
      call.reject(e.getMessage());
    }
  }

  /** 把原生独立产生的流水（native_txs）合并进 JS 推来的 db，并重算 seq.t */
  private String mergeNativeTxs(String jsDbStr) throws Exception {
    org.json.JSONObject cur = WidgetStore.readDB(getContext());
    if (cur == null) return jsDbStr;
    org.json.JSONArray nativeIds = cur.optJSONArray("native_txs");
    if (nativeIds == null || nativeIds.length() == 0) return jsDbStr;
    org.json.JSONObject js = new org.json.JSONObject(jsDbStr);
    org.json.JSONArray curTxs = cur.optJSONArray("txs");
    org.json.JSONArray jsTxs = js.optJSONArray("txs");
    if (curTxs == null || jsTxs == null) return jsDbStr;
    java.util.HashSet<String> have = new java.util.HashSet<>();
    int maxSeq = 0;
    for (int i = 0; i < jsTxs.length(); i++) {
      org.json.JSONObject t = jsTxs.optJSONObject(i);
      if (t == null) continue;
      have.add(t.optString("id"));
      maxSeq = Math.max(maxSeq, seqNum(t.optString("id")));
    }
    int added = 0;
    for (int i = 0; i < nativeIds.length(); i++) {
      String id = nativeIds.optString(i);
      if (id.isEmpty() || have.contains(id)) continue;
      for (int j = 0; j < curTxs.length(); j++) {
        org.json.JSONObject t = curTxs.optJSONObject(j);
        if (t != null && id.equals(t.optString("id"))) {
          jsTxs.put(new org.json.JSONObject(t.toString()));
          maxSeq = Math.max(maxSeq, seqNum(id));
          have.add(id);
          added++;
          break;
        }
      }
    }
    if (added > 0) {
      org.json.JSONObject seq = js.optJSONObject("seq");
      if (seq == null) { seq = new org.json.JSONObject(); js.put("seq", seq); }
      seq.put("t", Math.max(seq.optInt("t", 0), maxSeq));
    }
    // 保留 native_txs 标记：直到 JS 回读并确认（pullFromNative 会删掉它），
    // 否则中间的任一次旧数据推送都会把这些流水覆盖掉（表现为「记了但没进流水」）。
    js.put("native_txs", nativeIds);
    return js.toString();
  }

  private static int seqNum(String id) {
    try { return Integer.parseInt(String.valueOf(id).replaceAll("\\D", "")); } catch (Exception e) { return 0; }
  }

  /** JS 侧回读：桌面独立操作后（rev 变大），JS 拉取原生 db 覆盖本地，实现双向同步 */
  @PluginMethod
  public void getData(PluginCall call) {
    JSObject ret = new JSObject();
    org.json.JSONObject db = WidgetStore.readDB(getContext());
    ret.put("db", db != null ? db.toString() : "");
    ret.put("rev", WidgetStore.readRev(getContext()));
    call.resolve(ret);
  }

  /** 取走原生独立产生的待回读流水（取完即清空），JS 合并进本地库后回推即可 */
  @PluginMethod
  public void getPendingTxs(PluginCall call) {
    JSObject ret = new JSObject();
    ret.put("txs", WidgetStore.drainPending(getContext()).toString());
    call.resolve(ret);
  }

  @PluginMethod
  public void refresh(PluginCall call) {
    try {
      if (!WidgetStore.isEnabled(getContext())) {
        JSObject ret = new JSObject();
        ret.put("ok", true);
        ret.put("skipped", true);
        call.resolve(ret);
        return;
      }
      refreshAll();
      JSObject ret = new JSObject();
      ret.put("ok", true);
      call.resolve(ret);
    } catch (Exception e) {
      call.reject(e.getMessage());
    }
  }

  @PluginMethod
  public void setEnabled(PluginCall call) {
    try {
      Boolean v = call.getBoolean("enabled");
      android.content.SharedPreferences sp = getContext().getSharedPreferences(WidgetKeys.PREFS_FILE, android.content.Context.MODE_PRIVATE);
      String raw = sp.getString(WidgetKeys.KEY_PREFS, null);
      org.json.JSONObject o;
      try { o = raw != null ? new org.json.JSONObject(raw) : new org.json.JSONObject(); } catch (Exception e) { o = new org.json.JSONObject(); }
      o.put("widgetEnabled", v != null && v);
      sp.edit().putString(WidgetKeys.KEY_PREFS, o.toString()).apply();
      JSObject ret = new JSObject();
      ret.put("enabled", v != null && v);
      call.resolve(ret);
    } catch (Exception e) { call.reject(e.getMessage()); }
  }

  @PluginMethod
  public void getEnabled(PluginCall call) {
    JSObject ret = new JSObject();
    ret.put("enabled", WidgetStore.isEnabled(getContext()));
    call.resolve(ret);
  }

  /** 开屏首页 · 今日日程卡片开关：写进 prefs 供 Provider 读取，并立即刷新已添加的实例 */
  @PluginMethod
  public void setHomeTodayEnabled(PluginCall call) {
    try {
      Boolean v = call.getBoolean("enabled");
      boolean on = v == null || v;
      SharedPreferences sp = getContext().getSharedPreferences(WidgetKeys.PREFS_FILE, Context.MODE_PRIVATE);
      String raw = sp.getString(WidgetKeys.KEY_PREFS, null);
      org.json.JSONObject o;
      try { o = raw != null ? new org.json.JSONObject(raw) : new org.json.JSONObject(); } catch (Exception e) { o = new org.json.JSONObject(); }
      o.put("homeTodayWidget", on);
      sp.edit().putString(WidgetKeys.KEY_PREFS, o.toString()).apply();
      refreshAll();
      JSObject ret = new JSObject();
      ret.put("enabled", on);
      call.resolve(ret);
    } catch (Exception e) { call.reject(e.getMessage()); }
  }

  @PluginMethod
  public void getHomeTodayEnabled(PluginCall call) {
    JSObject ret = new JSObject();
    ret.put("enabled", WidgetStore.isHomeTodayEnabled(getContext()));
    call.resolve(ret);
  }

  // 计时器跨进程锚点：写入原生 SharedPreferences，抗 WebView 数据清理；
  // 独立键、不 bump rev、不刷新小组件（纯 App 侧恢复用）。
  @PluginMethod
  public void setTimerState(PluginCall call) {
    try {
      String json = call.getString("json");
      SharedPreferences sp = getContext().getSharedPreferences(WidgetKeys.PREFS_FILE, Context.MODE_PRIVATE);
      if (json == null || json.isEmpty()) {
        sp.edit().remove(WidgetKeys.KEY_TIMER).apply();
      } else {
        sp.edit().putString(WidgetKeys.KEY_TIMER, json).apply();
      }
      JSObject ret = new JSObject();
      ret.put("ok", true);
      call.resolve(ret);
    } catch (Exception e) { call.reject(e.getMessage()); }
  }

  @PluginMethod
  public void getTimerState(PluginCall call) {
    SharedPreferences sp = getContext().getSharedPreferences(WidgetKeys.PREFS_FILE, Context.MODE_PRIVATE);
    JSObject ret = new JSObject();
    ret.put("json", sp.getString(WidgetKeys.KEY_TIMER, ""));
    call.resolve(ret);
  }

  // 小组件主题：深色/浅色（App 设置里切换，立即刷新已添加的小组件）
  @PluginMethod
  public void setDarkTheme(PluginCall call) {
    try {
      Boolean v = call.getBoolean("dark");
      boolean dark = v != null && v;
      android.content.SharedPreferences sp = getContext().getSharedPreferences(WidgetKeys.PREFS_FILE, android.content.Context.MODE_PRIVATE);
      org.json.JSONObject o = WidgetStore.readConfig(getContext());
      o.put("dark", dark);
      sp.edit().putString(WidgetKeys.KEY_CONFIG, o.toString()).apply();
      refreshAll();
      JSObject ret = new JSObject();
      ret.put("dark", dark);
      call.resolve(ret);
    } catch (Exception e) { call.reject(e.getMessage()); }
  }

  private void refreshAll() {
    AppWidgetManager mgr = AppWidgetManager.getInstance(getContext());
    refreshOne(mgr, TodayWidgetProvider.class);
    refreshOne(mgr, HomeTodayWidgetProvider.class);
    refreshOne(mgr, ResourcesWidgetProvider.class);
    refreshOne(mgr, GoalsWidgetProvider.class);
    refreshOne(mgr, GoodsWidgetProvider.class);
    refreshOne(mgr, CountdownWidgetProvider.class); // 倒计时跟随任务改期
    refreshOne(mgr, FocusStopwatchProvider.class);  // 停表独立计时，推送时顺带校正
    refreshOne(mgr, LedgerWidgetProvider.class);    // 快速记账：资源/主题变化即时同步
    // 锁屏常驻通知跟随同一份数据刷新（未开启时内部直接跳过）
    try { com.personal.erp.lockscreen.LockScreenNotifier.post(getContext(), false); } catch (Exception ignored) {}
  }

  private void refreshOne(AppWidgetManager mgr, Class<?> cls) {
    try {
      ComponentName cn = new ComponentName(getContext(), cls);
      int[] ids = mgr.getAppWidgetIds(cn);
      if (ids.length == 0) return;
      if (cls == TodayWidgetProvider.class) {
        for (int id : ids) TodayWidgetProvider.updateOne(getContext(), mgr, id);
      } else if (cls == HomeTodayWidgetProvider.class) {
        for (int id : ids) HomeTodayWidgetProvider.updateOne(getContext(), mgr, id);
      } else if (cls == CountdownWidgetProvider.class) {
        for (int id : ids) CountdownWidgetProvider.updateOne(getContext(), mgr, id);
      } else if (cls == FocusStopwatchProvider.class) {
        for (int id : ids) FocusStopwatchProvider.refreshOne(getContext(), id);
      } else if (cls == LedgerWidgetProvider.class) {
        for (int id : ids) LedgerWidgetProvider.refreshOne(getContext(), id);
      } else if (cls == ResourcesWidgetProvider.class) {
        for (int id : ids) ResourcesWidgetProvider.updateOne(getContext(), mgr, id);
      } else if (cls == GoalsWidgetProvider.class) {
        for (int id : ids) GoalsWidgetProvider.updateOne(getContext(), mgr, id);
      } else if (cls == GoodsWidgetProvider.class) {
        for (int id : ids) GoodsWidgetProvider.updateOne(getContext(), mgr, id);
      }
    } catch (Exception ignored) {}
  }
}