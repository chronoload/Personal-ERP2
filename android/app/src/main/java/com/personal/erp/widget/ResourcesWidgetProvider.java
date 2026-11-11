package com.personal.erp.widget;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.view.View;
import android.widget.RemoteViews;
import com.personal.erp.MainActivity;
import com.personal.erp.R;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * 资源状态小组件：每行「名称 余额 ＋10」——点＋10 桌面直接充值（广播，不开 App）。
 */
public class ResourcesWidgetProvider extends AppWidgetProvider {

  @Override
  public void onUpdate(Context context, AppWidgetManager mgr, int[] ids) {
    for (int id : ids) {
      try { updateOne(context, mgr, id); } catch (Exception ignored) {}
    }
  }

  static void updateOne(Context ctx, AppWidgetManager mgr, int widgetId) {
    RemoteViews rv = new RemoteViews(ctx.getPackageName(), R.layout.widget_resources);

    boolean dark = WidgetStore.isDarkTheme(ctx);
    rv.setInt(R.id.widget_res_root, "setBackgroundResource", dark ? R.drawable.widget_bg_dark : R.drawable.widget_bg);
    rv.setTextColor(R.id.widget_res_title, dark ? 0xFFF0F2F5 : 0xFF202631);
    rv.setTextColor(R.id.widget_res_updated, dark ? 0xFFA8B0BD : 0xFF9AA3B2);
    for (int i = 1; i <= 3; i++) {
      rv.setTextColor(nameId(ctx, i), dark ? 0xFFE8EBF0 : 0xFF1F2430);
      rv.setTextColor(addId(ctx, i), dark ? 0xFF7ED4A3 : 0xFF3DA06A);
    }

    JSONObject db = WidgetStore.readDB(ctx);
    JSONObject snap = WidgetStore.readSnapshot(ctx);
    // 余额以 db 的流水为准：桌面记账/消费后立刻生效；db 缺失时才回落到 App 推送的快照
    JSONArray balances = db != null ? fallbackBalances(db) : null;
    if (balances == null || balances.length() == 0) {
      balances = snap != null ? snap.optJSONArray("balances") : null;
    }
    int n = balances != null ? balances.length() : 0;

    if (db == null && snap == null) {
      setRow(ctx, rv, 1, "打开应用同步数据", "", null);
      for (int i = 2; i <= 3; i++) hideRow(ctx, rv, i);
      rv.setTextViewText(R.id.widget_res_updated, "");
    } else {
      for (int i = 0; i < 3; i++) {
        JSONObject b = i < n ? balances.optJSONObject(i) : null;
        if (b == null) { hideRow(ctx, rv, i + 1); continue; }
        String name = b.optString("name", "资源");
        String unit = b.optString("unit", "");
        double v = b.optDouble("value", 0);
        String bal = fmt(v) + (unit.isEmpty() ? "" : unit);
        setRow(ctx, rv, i + 1, name + " · " + bal, "＋10", b.optString("id", ""));
      }
      for (int i = n; i < 3; i++) hideRow(ctx, rv, i + 1);
      String updated = "";
      if (db != null) {
        long at = latestTxMs(db);
        if (at > 0) updated = "已记账 " + hhmm(at);
      } else if (snap != null) {
        String at = snap.optString("updatedAt", "");
        if (at.length() >= 16) updated = "更新 " + at.substring(11, 16);
      }
      rv.setTextViewText(R.id.widget_res_updated, updated);
    }

    Intent intent = new Intent(ctx, MainActivity.class);
    intent.putExtra("erp_tab", "stats");
    PendingIntent pi = PendingIntent.getActivity(ctx, 0, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    rv.setOnClickPendingIntent(R.id.widget_res_title, pi);
    mgr.updateAppWidget(widgetId, rv);
  }

  /** 行渲染：name 显示「名称·余额」，addBtn 非空时绑充值广播 */
  private static void setRow(Context ctx, RemoteViews rv, int i, String nameTxt, String addTxt, String resourceId) {
    int row = rowId(ctx, i);
    int name = nameId(ctx, i);
    int add = addId(ctx, i);
    rv.setViewVisibility(row, View.VISIBLE);
    rv.setTextViewText(name, nameTxt);
    if (resourceId != null && !resourceId.isEmpty()) {
      rv.setTextViewText(add, addTxt);
      Intent it = new Intent(ctx, WidgetActionReceiver.class);
      it.setAction(WidgetActionReceiver.ACTION_RECHARGE);
      it.putExtra(WidgetActionReceiver.EXTRA_RESOURCE_ID, resourceId);
      it.putExtra(WidgetActionReceiver.EXTRA_AMOUNT, 10.0);
      // requestCode 用行号区分，避免 extras 互相覆盖
      PendingIntent pi = PendingIntent.getBroadcast(ctx, 200 + i, it,
          PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
      rv.setOnClickPendingIntent(add, pi);
      rv.setViewVisibility(add, View.VISIBLE);
    } else {
      rv.setViewVisibility(add, View.GONE);
      if (!nameTxt.isEmpty()) {
        Intent it = new Intent(ctx, MainActivity.class);
        it.putExtra("erp_tab", "stats");
        PendingIntent pi = PendingIntent.getActivity(ctx, 0, it, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        rv.setOnClickPendingIntent(row, pi);
      }
    }
  }

  static void refreshAll(Context ctx) {
    try {
      AppWidgetManager mgr = AppWidgetManager.getInstance(ctx);
      int[] ids = mgr.getAppWidgetIds(new ComponentName(ctx, ResourcesWidgetProvider.class));
      for (int id : ids) updateOne(ctx, mgr, id);
    } catch (Exception ignored) {}
  }

  /** 最近一笔流水时间（用于底部「已记账 HH:mm」） */
  private static long latestTxMs(JSONObject db) {
    try {
      JSONArray txs = db.optJSONArray("txs");
      if (txs == null) return 0;
      long max = 0;
      for (int i = 0; i < txs.length(); i++) {
        JSONObject t = txs.optJSONObject(i);
        if (t != null) max = Math.max(max, t.optLong("created", 0));
      }
      return max;
    } catch (Exception e) { return 0; }
  }

  private static String hhmm(long ms) {
    java.util.Calendar c = java.util.Calendar.getInstance();
    c.setTimeInMillis(ms);
    return String.format(java.util.Locale.US, "%02d:%02d",
        c.get(java.util.Calendar.HOUR_OF_DAY), c.get(java.util.Calendar.MINUTE));
  }

  private static void hideRow(Context ctx, RemoteViews rv, int i) {
    rv.setViewVisibility(rowId(ctx, i), View.GONE);
  }

  private static int rowId(Context ctx, int i) {
    return ctx.getResources().getIdentifier("widget_res_row" + i, "id", ctx.getPackageName());
  }

  private static int nameId(Context ctx, int i) {
    return ctx.getResources().getIdentifier("widget_res_name" + i, "id", ctx.getPackageName());
  }

  private static int addId(Context ctx, int i) {
    return ctx.getResources().getIdentifier("widget_res_add" + i, "id", ctx.getPackageName());
  }

  private static JSONArray fallbackBalances(JSONObject db) {
    JSONArray out = new JSONArray();
    if (db == null) return out;
    try {
      JSONArray resources = db.optJSONArray("resources");
      JSONArray txs = db.optJSONArray("txs");
      if (resources == null) return out;
      for (int i = 0; i < resources.length(); i++) {
        JSONObject r = resources.optJSONObject(i);
        if (r == null || !"Active".equals(r.optString("status", "Active"))) continue;
        double bal = r.optDouble("initial", 0);
        if (txs != null) {
          for (int j = 0; j < txs.length(); j++) {
            JSONObject t = txs.optJSONObject(j);
            if (t == null || !r.optString("id", "").equals(t.optString("resource_id", ""))) continue;
            bal += t.optDouble("debit", 0) - t.optDouble("credit", 0);
          }
        }
        JSONObject b = new JSONObject();
        b.put("id", r.optString("id", ""));
        b.put("name", r.optString("name", ""));
        b.put("unit", r.optString("unit", ""));
        b.put("value", bal);
        out.put(b);
        if (out.length() >= 3) break;
      }
    } catch (Exception ignored) {}
    return out;
  }

  private static String fmt(double v) {
    if (v == Math.floor(v)) return String.valueOf((long) v);
    return String.format(java.util.Locale.US, "%.1f", v);
  }
}