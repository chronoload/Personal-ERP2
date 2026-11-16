package com.personal.erp.widget;

import android.content.Context;
import android.content.Intent;
import android.widget.RemoteViews;
import android.widget.RemoteViewsService;

import com.personal.erp.R;

import org.json.JSONArray;
import org.json.JSONObject;

import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Date;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * 流水小组件的数据源：把 db.txs 按时间倒序摊平成可滚动列表。
 * 只读：账目由 App / 其它小组件写入，这里不产生任何数据。
 */
public class FlowWidgetService extends RemoteViewsService {

  @Override
  public RemoteViewsFactory onGetViewFactory(Intent intent) {
    int widgetId = intent.getIntExtra(android.appwidget.AppWidgetManager.EXTRA_APPWIDGET_ID, -1);
    return new FlowFactory(getApplicationContext(), widgetId);
  }

  static class FlowFactory implements RemoteViewsFactory {
    private static final int LIMIT = 60;
    private final Context ctx;
    private final int widgetId;
    private final List<JSONObject> items = new ArrayList<>();
    private final Map<String, String> resNames = new HashMap<>();
    private final SimpleDateFormat df = new SimpleDateFormat("M-d HH:mm", Locale.CHINA);
    private boolean dark = false;

    FlowFactory(Context ctx, int widgetId) {
      this.ctx = ctx;
      this.widgetId = widgetId;
    }

    @Override public void onCreate() {}

    @Override public void onDestroy() {
      items.clear();
      resNames.clear();
    }

    @Override public void onDataSetChanged() {
      items.clear();
      resNames.clear();
      dark = WidgetStore.isDarkTheme(ctx);
      JSONObject db = WidgetStore.readDB(ctx);
      if (db == null) return;

      JSONArray resources = db.optJSONArray("resources");
      if (resources != null) {
        for (int i = 0; i < resources.length(); i++) {
          JSONObject r = resources.optJSONObject(i);
          if (r != null) resNames.put(r.optString("id", ""), r.optString("name", ""));
        }
      }

      JSONArray txs = db.optJSONArray("txs");
      if (txs == null) return;
      String dim = FlowWidgetProvider.dimensionOf(ctx, widgetId);
      List<JSONObject> list = new ArrayList<>();
      for (int i = 0; i < txs.length(); i++) {
        JSONObject t = txs.optJSONObject(i);
        if (t == null) continue;
        if (t.optDouble("credit", 0) == 0 && t.optDouble("debit", 0) == 0) continue;
        if (!dim.isEmpty() && !dim.equals(t.optString("resource_id", ""))) continue;
        list.add(t);
      }
      Collections.sort(list, new java.util.Comparator<JSONObject>() {
        @Override public int compare(JSONObject a, JSONObject b) {
          return Long.compare(createdOf(b), createdOf(a));
        }
      });
      for (int i = 0; i < list.size() && i < LIMIT; i++) items.add(list.get(i));
    }

    private static long createdOf(JSONObject t) {
      long ms = t.optLong("created", 0L);
      if (ms > 0) return ms;
      // 兼容旧数据的字符串日期
      return WidgetStore.parseDateTimeMs(t.optString("created", ""));
    }

    @Override public int getCount() { return items.size(); }

    @Override public RemoteViews getViewAt(int position) {
      if (position < 0 || position >= items.size()) return null;
      JSONObject t = items.get(position);
      RemoteViews rv = new RemoteViews(ctx.getPackageName(), R.layout.widget_flow_item);

      double credit = t.optDouble("credit", 0);
      double debit = t.optDouble("debit", 0);
      boolean income = debit > 0;
      double amount = income ? debit : credit;

      String note = t.optString("note", "").trim();
      if (note.isEmpty()) note = labelOf(t.optString("source_type", ""));
      String res = resNames.get(t.optString("resource_id", ""));
      long ms = createdOf(t);
      String time = ms > 0 ? df.format(new Date(ms)) : "";
      String meta = (res == null || res.isEmpty()) ? time : (time.isEmpty() ? res : res + " · " + time);

      rv.setTextViewText(R.id.widget_flow_item_note, note);
      rv.setTextColor(R.id.widget_flow_item_note, dark ? 0xFFF0F2F5 : 0xFF1F2430);
      rv.setTextViewText(R.id.widget_flow_item_meta, meta);
      rv.setTextColor(R.id.widget_flow_item_meta, dark ? 0xFFA8B0BD : 0xFF6B7482);
      rv.setTextViewText(R.id.widget_flow_item_amt,
          (income ? "+" : "−") + FlowWidgetProvider.fmt(amount));
      rv.setTextColor(R.id.widget_flow_item_amt,
          income ? (dark ? 0xFF7ED4A3 : 0xFF3DA06A) : (dark ? 0xFFE08A8A : 0xFFC0454F));
      rv.setInt(R.id.widget_flow_item_card, "setBackgroundResource",
          dark ? R.drawable.widget_goods_row_bg_dark : R.drawable.widget_goods_row_bg);

      // 行点击：fill-in 交给 Provider 的模板（打开「财务」页）
      Intent fill = new Intent();
      fill.putExtra("erp_tx_id", t.optString("id", ""));
      rv.setOnClickFillInIntent(R.id.widget_flow_item_card, fill);
      return rv;
    }

    private static String labelOf(String sourceType) {
      if ("goods".equals(sourceType)) return "购买商品";
      if ("manual".equals(sourceType)) return "手动记账";
      if ("activity".equals(sourceType)) return "活动支出";
      if ("agent".equals(sourceType)) return "Agent 记账";
      return "流水";
    }

    @Override public RemoteViews getLoadingView() { return null; }
    @Override public int getViewTypeCount() { return 1; }
    @Override public long getItemId(int position) {
      if (position < 0 || position >= items.size()) return position;
      return items.get(position).optString("id", String.valueOf(position)).hashCode();
    }
    @Override public boolean hasStableIds() { return true; }
  }
}
