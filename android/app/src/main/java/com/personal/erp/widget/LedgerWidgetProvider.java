package com.personal.erp.widget;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.view.View;
import android.widget.RemoteViews;

import com.personal.erp.MainActivity;
import com.personal.erp.R;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * 快速记账小组件（4×2）：点金额立即入账。
 *  - 每笔都是真实流水：追加 txs + seq 自增 + native_txs 登记，App 回前台自动合并；
 *  - 资源可切换：点标题在「启用的资源」之间轮换，选择按实例持久化；
 *  - 余额由 ResourcesWidget 从 db 实时计算，记完立刻可见。
 */
public class LedgerWidgetProvider extends AppWidgetProvider {

  @Override
  public void onUpdate(Context context, AppWidgetManager mgr, int[] ids) {
    for (int id : ids) {
      try { updateOne(context, mgr, id); } catch (Exception ignored) {}
    }
  }

  @Override
  public void onDeleted(Context context, int[] ids) {
    try {
      SharedPreferences sp = context.getSharedPreferences(WidgetKeys.PREFS_FILE, Context.MODE_PRIVATE);
      SharedPreferences.Editor ed = sp.edit();
      for (int id : ids) ed.remove(prefKey(id));
      ed.apply();
    } catch (Exception ignored) {}
  }

  static void updateOne(Context ctx, AppWidgetManager mgr, int widgetId) {
    RemoteViews rv = new RemoteViews(ctx.getPackageName(), R.layout.widget_ledger);
    boolean dark = WidgetStore.isDarkTheme(ctx);
    applyTheme(ctx, rv, dark);

    JSONObject db = WidgetStore.readDB(ctx);
    JSONArray resources = activeResources(db);
    JSONObject cur = currentResource(ctx, widgetId, resources);

    if (db == null) {
      rv.setTextViewText(R.id.widget_ledger_title, "快速记账");
      rv.setTextViewText(R.id.widget_ledger_hint, "打开应用同步数据");
    } else if (cur == null) {
      rv.setTextViewText(R.id.widget_ledger_title, "快速记账");
      rv.setTextViewText(R.id.widget_ledger_hint, "先去应用创建资源");
    } else {
      rv.setTextViewText(R.id.widget_ledger_title, "记账 · " + cur.optString("name", "资源"));
      rv.setTextViewText(R.id.widget_ledger_hint, "点金额入账");
      // 标题点击 → 切换到下一个启用资源
      Intent sw = new Intent(ctx, WidgetActionReceiver.class);
      sw.setAction(WidgetActionReceiver.ACTION_LEDGER_SWITCH);
      sw.putExtra(WidgetActionReceiver.EXTRA_WIDGET_ID, widgetId);
      rv.setOnClickPendingIntent(R.id.widget_ledger_title, PendingIntent.getBroadcast(
          ctx, 6100 + widgetId, sw, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE));
    }

    bindAmount(ctx, rv, R.id.widget_ledger_exp5, widgetId, 5, "expense", 0);
    bindAmount(ctx, rv, R.id.widget_ledger_exp10, widgetId, 10, "expense", 1);
    bindAmount(ctx, rv, R.id.widget_ledger_exp20, widgetId, 20, "expense", 2);
    bindAmount(ctx, rv, R.id.widget_ledger_exp50, widgetId, 50, "expense", 3);
    bindAmount(ctx, rv, R.id.widget_ledger_inc10, widgetId, 10, "income", 4);
    bindAmount(ctx, rv, R.id.widget_ledger_inc50, widgetId, 50, "income", 5);
    bindAmount(ctx, rv, R.id.widget_ledger_inc100, widgetId, 100, "income", 6);

    Intent open = new Intent(ctx, MainActivity.class);
    open.putExtra("erp_tab", "finance");
    PendingIntent po = PendingIntent.getActivity(ctx, 6200 + widgetId, open,
        PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    rv.setOnClickPendingIntent(R.id.widget_ledger_more, po);
    rv.setOnClickPendingIntent(R.id.widget_ledger_root, po);

    mgr.updateAppWidget(widgetId, rv);
  }

  private static void bindAmount(Context ctx, RemoteViews rv, int viewId, int widgetId,
                                 double amount, String direction, int slot) {
    Intent it = new Intent(ctx, WidgetActionReceiver.class);
    it.setAction(WidgetActionReceiver.ACTION_LEDGER_ADD);
    it.putExtra(WidgetActionReceiver.EXTRA_WIDGET_ID, widgetId);
    it.putExtra(WidgetActionReceiver.EXTRA_AMOUNT, amount);
    it.putExtra(WidgetActionReceiver.EXTRA_DIRECTION, direction);
    PendingIntent pi = PendingIntent.getBroadcast(ctx, 6000 + widgetId * 8 + slot, it,
        PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    rv.setOnClickPendingIntent(viewId, pi);
  }

  static void refreshOne(Context ctx, int widgetId) {
    try {
      updateOne(ctx, AppWidgetManager.getInstance(ctx), widgetId);
    } catch (Exception ignored) {}
  }

  static void refreshAll(Context ctx) {
    try {
      AppWidgetManager mgr = AppWidgetManager.getInstance(ctx);
      int[] ids = mgr.getAppWidgetIds(new ComponentName(ctx, LedgerWidgetProvider.class));
      for (int id : ids) updateOne(ctx, mgr, id);
    } catch (Exception ignored) {}
  }

  /** 当前实例选中的资源 id（不存在/已停用则回落第一个启用资源） */
  static String currentResourceId(Context ctx, int widgetId) {
    JSONObject r = currentResource(ctx, widgetId, activeResources(WidgetStore.readDB(ctx)));
    return r == null ? null : r.optString("id", "");
  }

  /** 切到下一个启用资源并持久化该实例的选择 */
  static void switchResource(Context ctx, int widgetId) {
    try {
      JSONArray list = activeResources(WidgetStore.readDB(ctx));
      if (list.length() == 0) return;
      String cur = readResPref(ctx, widgetId);
      int idx = -1;
      for (int i = 0; i < list.length(); i++) {
        JSONObject r = list.optJSONObject(i);
        if (r != null && r.optString("id", "").equals(cur)) { idx = i; break; }
      }
      int next = (idx + 1) % list.length();
      JSONObject r = list.optJSONObject(next);
      if (r != null) writeResPref(ctx, widgetId, r.optString("id", ""));
    } catch (Exception ignored) {}
    refreshOne(ctx, widgetId);
  }

  private static JSONObject currentResource(Context ctx, int widgetId, JSONArray list) {
    if (list == null || list.length() == 0) return null;
    String want = readResPref(ctx, widgetId);
    if (want != null && !want.isEmpty()) {
      for (int i = 0; i < list.length(); i++) {
        JSONObject r = list.optJSONObject(i);
        if (r != null && want.equals(r.optString("id", ""))) return r;
      }
    }
    JSONObject first = list.optJSONObject(0);
    if (first != null) writeResPref(ctx, widgetId, first.optString("id", ""));
    return first;
  }

  private static JSONArray activeResources(JSONObject db) {
    JSONArray out = new JSONArray();
    if (db == null) return out;
    try {
      JSONArray all = db.optJSONArray("resources");
      if (all == null) return out;
      for (int i = 0; i < all.length(); i++) {
        JSONObject r = all.optJSONObject(i);
        if (r == null) continue;
        if (!"Active".equals(r.optString("status", "Active"))) continue;
        out.put(r);
      }
    } catch (Exception ignored) {}
    return out;
  }

  private static String prefKey(int widgetId) { return "widget_ledger_res_" + widgetId; }

  private static String readResPref(Context ctx, int widgetId) {
    try {
      SharedPreferences sp = ctx.getSharedPreferences(WidgetKeys.PREFS_FILE, Context.MODE_PRIVATE);
      return sp.getString(prefKey(widgetId), null);
    } catch (Exception e) { return null; }
  }

  private static void writeResPref(Context ctx, int widgetId, String resourceId) {
    try {
      SharedPreferences sp = ctx.getSharedPreferences(WidgetKeys.PREFS_FILE, Context.MODE_PRIVATE);
      sp.edit().putString(prefKey(widgetId), resourceId).apply();
    } catch (Exception ignored) {}
  }

  private static void applyTheme(Context ctx, RemoteViews rv, boolean dark) {
    rv.setInt(R.id.widget_ledger_root, "setBackgroundResource", dark ? R.drawable.widget_bg_dark : R.drawable.widget_bg);
    rv.setTextColor(R.id.widget_ledger_title, dark ? 0xFFF0F2F5 : 0xFF202631);
    rv.setTextColor(R.id.widget_ledger_hint, dark ? 0xFFA8B0BD : 0xFF9AA3B2);
    int exp = dark ? 0xFFE08A8A : 0xFFC0454F;
    int inc = dark ? 0xFF7ED4A3 : 0xFF3DA06A;
    int[] expIds = {R.id.widget_ledger_exp5, R.id.widget_ledger_exp10, R.id.widget_ledger_exp20, R.id.widget_ledger_exp50};
    int[] incIds = {R.id.widget_ledger_inc10, R.id.widget_ledger_inc50, R.id.widget_ledger_inc100};
    for (int id : expIds) rv.setTextColor(id, exp);
    for (int id : incIds) rv.setTextColor(id, inc);
    rv.setTextColor(R.id.widget_ledger_more, dark ? 0xFF8FB8E8 : 0xFF4A7FBF);
    int bg = dark ? R.drawable.widget_act_bg_dark : R.drawable.widget_add_bg;
    for (int id : expIds) rv.setInt(id, "setBackgroundResource", bg);
    for (int id : incIds) rv.setInt(id, "setBackgroundResource", bg);
    rv.setInt(R.id.widget_ledger_more, "setBackgroundResource", bg);
  }
}
