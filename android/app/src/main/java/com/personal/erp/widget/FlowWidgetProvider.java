package com.personal.erp.widget;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.widget.RemoteViews;

import com.personal.erp.MainActivity;
import com.personal.erp.R;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Calendar;
import java.util.List;

/**
 * 流水小组件（4×3）：按维度（全部 / 各资源）展示最近账目，顶部是当天该维度的小计。
 * 点标题切换维度（选择按实例持久化）；点其它区域进入「财务」。
 */
public class FlowWidgetProvider extends AppWidgetProvider {

  public static final String ACTION_FLOW_DIM = "com.personal.erp.widget.ACTION_FLOW_DIM";
  private static final String PREF_PREFIX = "widget_flow_dim_";

  @Override
  public void onUpdate(Context context, AppWidgetManager mgr, int[] ids) {
    for (int id : ids) {
      try { updateOne(context, mgr, id); } catch (Exception ignored) {}
    }
  }

  @Override
  public void onReceive(Context context, Intent intent) {
    super.onReceive(context, intent);
    if (ACTION_FLOW_DIM.equals(intent.getAction())) {
      int id = intent.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, -1);
      if (id >= 0) cycleDimension(context, id);
    }
  }

  @Override
  public void onDeleted(Context context, int[] ids) {
    try {
      SharedPreferences sp = context.getSharedPreferences(WidgetKeys.PREFS_FILE, Context.MODE_PRIVATE);
      SharedPreferences.Editor ed = sp.edit();
      for (int id : ids) ed.remove(PREF_PREFIX + id);
      ed.apply();
    } catch (Exception ignored) {}
  }

  static void updateOne(Context ctx, AppWidgetManager mgr, int widgetId) {
    RemoteViews rv = new RemoteViews(ctx.getPackageName(), R.layout.widget_flow);
    boolean dark = WidgetStore.isDarkTheme(ctx);
    rv.setInt(R.id.widget_flow_root, "setBackgroundResource",
        dark ? R.drawable.widget_bg_dark : R.drawable.widget_bg);
    rv.setTextColor(R.id.widget_flow_title, dark ? 0xFFF0F2F5 : 0xFF202631);
    rv.setTextColor(R.id.widget_flow_sum, dark ? 0xFFA8B0BD : 0xFF6B7482);
    rv.setTextColor(R.id.widget_flow_empty, dark ? 0xFFA8B0BD : 0xFF9AA3B2);

    JSONObject db = WidgetStore.readDB(ctx);
    String dim = dimensionOf(ctx, widgetId);
    String dimName = dimensionLabel(db, dim);
    rv.setTextViewText(R.id.widget_flow_title,
        dim.isEmpty() ? "流水 · 全部" : "流水 · " + dimName);
    rv.setTextViewText(R.id.widget_flow_sum, db == null ? "打开应用同步" : todaySummary(db, dim));

    // 可滚动列表数据源（维度随 extra 传下去）
    Intent svc = new Intent(ctx, FlowWidgetService.class);
    svc.putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId);
    svc.setData(Uri.parse(svc.toUri(Intent.URI_INTENT_SCHEME)));
    rv.setRemoteAdapter(R.id.widget_flow_list, svc);
    rv.setEmptyView(R.id.widget_flow_list, R.id.widget_flow_empty);

    // 行点击：列表模板 + 行内 fill-in；MUTABLE 才能把 extras 传进去
    Intent tpl = new Intent(ctx, MainActivity.class);
    tpl.putExtra("erp_tab", "finance");
    tpl.setData(Uri.parse("erp://widget/flow/open"));
    PendingIntent template = PendingIntent.getActivity(ctx, 7100, tpl,
        PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_MUTABLE);
    rv.setPendingIntentTemplate(R.id.widget_flow_list, template);

    // 标题：切换维度（全部 → 各启用资源 → 回到全部）
    Intent sw = new Intent(ctx, FlowWidgetProvider.class);
    sw.setAction(ACTION_FLOW_DIM);
    sw.putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId);
    rv.setOnClickPendingIntent(R.id.widget_flow_title, PendingIntent.getBroadcast(
        ctx, 7120 + widgetId, sw, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE));

    Intent open = new Intent(ctx, MainActivity.class);
    open.putExtra("erp_tab", "finance");
    PendingIntent po = PendingIntent.getActivity(ctx, 7110 + widgetId, open,
        PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    rv.setOnClickPendingIntent(R.id.widget_flow_root, po);

    mgr.updateAppWidget(widgetId, rv);
    mgr.notifyAppWidgetViewDataChanged(new int[]{widgetId}, R.id.widget_flow_list);
  }

  /** 今日小计：dim 为空统计全部；否则只看该资源 */
  static String todaySummary(JSONObject db, String dim) {
    JSONArray txs = db != null ? db.optJSONArray("txs") : null;
    if (txs == null || txs.length() == 0) return "今日 —";
    Calendar now = Calendar.getInstance();
    int y = now.get(Calendar.YEAR), m = now.get(Calendar.MONTH), d = now.get(Calendar.DAY_OF_MONTH);
    Calendar c = Calendar.getInstance();
    double out = 0, in = 0;
    for (int i = 0; i < txs.length(); i++) {
      JSONObject t = txs.optJSONObject(i);
      if (t == null) continue;
      if (dim != null && !dim.isEmpty() && !dim.equals(t.optString("resource_id", ""))) continue;
      long ms = t.optLong("created", 0L);
      if (ms <= 0) continue;
      c.setTimeInMillis(ms);
      if (c.get(Calendar.YEAR) != y || c.get(Calendar.MONTH) != m || c.get(Calendar.DAY_OF_MONTH) != d) continue;
      out += t.optDouble("credit", 0);
      in += t.optDouble("debit", 0);
    }
    if (out == 0 && in == 0) return "今日 无收支";
    return "今日 −" + fmt(out) + " / +" + fmt(in);
  }

  static String dimensionOf(Context ctx, int widgetId) {
    try {
      SharedPreferences sp = ctx.getSharedPreferences(WidgetKeys.PREFS_FILE, Context.MODE_PRIVATE);
      return sp.getString(PREF_PREFIX + widgetId, "");
    } catch (Exception e) { return ""; }
  }

  private static void writeDimension(Context ctx, int widgetId, String dim) {
    try {
      SharedPreferences sp = ctx.getSharedPreferences(WidgetKeys.PREFS_FILE, Context.MODE_PRIVATE);
      sp.edit().putString(PREF_PREFIX + widgetId, dim == null ? "" : dim).apply();
    } catch (Exception ignored) {}
  }

  /** 维度下拉项：第一个是「全部」，其后是所有启用资源 */
  private static List<String[]> dimensions(JSONObject db) {
    List<String[]> out = new ArrayList<>();
    out.add(new String[]{"", "全部"});
    JSONArray arr = db != null ? db.optJSONArray("resources") : null;
    if (arr != null) {
      for (int i = 0; i < arr.length(); i++) {
        JSONObject r = arr.optJSONObject(i);
        if (r == null) continue;
        if (!"Active".equals(r.optString("status", "Active"))) continue;
        out.add(new String[]{r.optString("id", ""), r.optString("name", "资源")});
      }
    }
    return out;
  }

  static String dimensionLabel(JSONObject db, String dim) {
    if (dim == null || dim.isEmpty()) return "全部";
    for (String[] d : dimensions(db)) {
      if (dim.equals(d[0])) return d[1];
    }
    return "资源";
  }

  static void cycleDimension(Context ctx, int widgetId) {
    try {
      List<String[]> list = dimensions(WidgetStore.readDB(ctx));
      String cur = dimensionOf(ctx, widgetId);
      int idx = 0;
      for (int i = 0; i < list.size(); i++) {
        if (list.get(i)[0].equals(cur)) { idx = i; break; }
      }
      int next = (idx + 1) % list.size();
      writeDimension(ctx, widgetId, list.get(next)[0]);
    } catch (Exception ignored) {}
    refreshOne(ctx, widgetId);
  }

  static String fmt(double v) {
    if (v == Math.floor(v)) return String.valueOf((long) v);
    return String.format(java.util.Locale.US, "%.2f", v).replaceAll("0+$", "").replaceAll("\\.$", "");
  }

  static void refreshOne(Context ctx, int widgetId) {
    try { updateOne(ctx, AppWidgetManager.getInstance(ctx), widgetId); } catch (Exception ignored) {}
  }

  static void refreshAll(Context ctx) {
    try {
      AppWidgetManager mgr = AppWidgetManager.getInstance(ctx);
      int[] ids = mgr.getAppWidgetIds(new ComponentName(ctx, FlowWidgetProvider.class));
      for (int id : ids) updateOne(ctx, mgr, id);
    } catch (Exception ignored) {}
  }
}
