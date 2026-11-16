package com.personal.erp.widget;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.widget.RemoteViews;

import com.personal.erp.MainActivity;
import com.personal.erp.R;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.Calendar;

/**
 * 流水小组件（4×3）：最近记的账平铺展示，顶部是今日收支小计。
 * 数据来自 JS 推送的 db（txs / resources），只读不改账；点任意行进入「财务」。
 */
public class FlowWidgetProvider extends AppWidgetProvider {

  @Override
  public void onUpdate(Context context, AppWidgetManager mgr, int[] ids) {
    for (int id : ids) {
      try { updateOne(context, mgr, id); } catch (Exception ignored) {}
    }
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
    rv.setTextViewText(R.id.widget_flow_sum, db == null ? "打开应用同步" : todaySummary(db));

    // 可滚动列表数据源
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

    Intent open = new Intent(ctx, MainActivity.class);
    open.putExtra("erp_tab", "finance");
    PendingIntent po = PendingIntent.getActivity(ctx, 7110 + widgetId, open,
        PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    rv.setOnClickPendingIntent(R.id.widget_flow_root, po);
    rv.setOnClickPendingIntent(R.id.widget_flow_title, po);

    mgr.updateAppWidget(widgetId, rv);
    mgr.notifyAppWidgetViewDataChanged(new int[]{widgetId}, R.id.widget_flow_list);
  }

  /** 今日小计：支出取 credit、收入取 debit，只统计本地时区当天 */
  static String todaySummary(JSONObject db) {
    JSONArray txs = db != null ? db.optJSONArray("txs") : null;
    if (txs == null || txs.length() == 0) return "今日 —";
    Calendar now = Calendar.getInstance();
    int y = now.get(Calendar.YEAR), m = now.get(Calendar.MONTH), d = now.get(Calendar.DAY_OF_MONTH);
    Calendar c = Calendar.getInstance();
    double out = 0, in = 0;
    for (int i = 0; i < txs.length(); i++) {
      JSONObject t = txs.optJSONObject(i);
      if (t == null) continue;
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
