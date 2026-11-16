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
 * 需求小组件的数据源：按当前来源过滤 db.demands，按记录时间倒序。
 * 只读展示；新增走 DemandQuickAddActivity（原生直写 db + native_demands 标记）。
 */
public class DemandWidgetService extends RemoteViewsService {

  @Override
  public RemoteViewsFactory onGetViewFactory(Intent intent) {
    int widgetId = intent.getIntExtra(android.appwidget.AppWidgetManager.EXTRA_APPWIDGET_ID, -1);
    return new DemandFactory(getApplicationContext(), widgetId);
  }

  static class DemandFactory implements RemoteViewsFactory {
    private final Context ctx;
    private final int widgetId;
    private final List<JSONObject> items = new ArrayList<>();
    private final Map<String, String> reqNames = new HashMap<>();
    private final SimpleDateFormat df = new SimpleDateFormat("M-d HH:mm", Locale.CHINA);
    private boolean dark = false;

    DemandFactory(Context ctx, int widgetId) {
      this.ctx = ctx;
      this.widgetId = widgetId;
    }

    @Override public void onCreate() {}

    @Override public void onDestroy() {
      items.clear();
      reqNames.clear();
    }

    @Override public void onDataSetChanged() {
      items.clear();
      reqNames.clear();
      dark = WidgetStore.isDarkTheme(ctx);
      JSONObject db = WidgetStore.readDB(ctx);
      if (db == null) return;

      JSONArray requesters = db.optJSONArray("requesters");
      if (requesters != null) {
        for (int i = 0; i < requesters.length(); i++) {
          JSONObject r = requesters.optJSONObject(i);
          if (r != null) reqNames.put(r.optString("id", ""), r.optString("name", ""));
        }
      }

      JSONArray list = db.optJSONArray("demands");
      if (list == null) return;
      String rid = DemandWidgetProvider.requesterOf(ctx, widgetId);
      List<JSONObject> picked = new ArrayList<>();
      for (int i = 0; i < list.length(); i++) {
        JSONObject d = list.optJSONObject(i);
        if (d == null) continue;
        if (!rid.isEmpty() && !rid.equals(d.optString("requesterId", ""))) continue;
        picked.add(d);
      }
      Collections.sort(picked, new java.util.Comparator<JSONObject>() {
        @Override public int compare(JSONObject a, JSONObject b) {
          return Long.compare(b.optLong("createdAt", 0L), a.optLong("createdAt", 0L));
        }
      });
      items.addAll(picked);
    }

    @Override public int getCount() { return items.size(); }

    @Override public RemoteViews getViewAt(int position) {
      if (position < 0 || position >= items.size()) return null;
      JSONObject d = items.get(position);
      RemoteViews rv = new RemoteViews(ctx.getPackageName(), R.layout.widget_demand_item);

      String status = d.optString("status", "open");
      String mark = "admitted".equals(status) ? "✓" : ("dropped".equals(status) ? "—" : "○");
      int markColor = "admitted".equals(status) ? (dark ? 0xFF7ED4A3 : 0xFF3DA06A)
          : ("dropped".equals(status) ? (dark ? 0xFF8B93A1 : 0xFF9AA3B2) : (dark ? 0xFFF0B45E : 0xFFD97706));

      rv.setTextViewText(R.id.widget_dm_item_mark, mark);
      rv.setTextColor(R.id.widget_dm_item_mark, markColor);
      rv.setTextViewText(R.id.widget_dm_item_text, d.optString("text", ""));
      boolean done = !"open".equals(status);
      rv.setTextColor(R.id.widget_dm_item_text, done
          ? (dark ? 0xFF8B93A1 : 0xFF8A93A3)
          : (dark ? 0xFFF0F2F5 : 0xFF1F2430));

      String name = reqNames.get(d.optString("requesterId", ""));
      String when = d.optLong("createdAt", 0L) > 0
          ? df.format(new Date(d.optLong("createdAt", 0L))) : "";
      String note = d.optString("note", "");
      String meta = (name == null || name.isEmpty() ? "" : name + " · ") + when
          + (note.isEmpty() ? "" : " · " + note);
      rv.setTextViewText(R.id.widget_dm_item_meta, meta);
      rv.setTextColor(R.id.widget_dm_item_meta, dark ? 0xFFA8B0BD : 0xFF6B7482);
      rv.setInt(R.id.widget_dm_item_card, "setBackgroundResource",
          dark ? R.drawable.widget_goods_row_bg_dark : R.drawable.widget_goods_row_bg);

      rv.setOnClickFillInIntent(R.id.widget_dm_item_card, new Intent());
      return rv;
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
