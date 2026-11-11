package com.personal.erp.widget;

import android.content.Context;
import android.content.Intent;
import android.widget.RemoteViews;
import android.widget.RemoteViewsService;

import com.personal.erp.R;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

/**
 * 快速消费列表数据源：让 4×3 小组件变成可滚动列表。
 * 每次数据集变化（消费 / App 推送 / 主题切换）由 Provider 触发 onDataSetChanged 重建。
 */
public class GoodsWidgetService extends RemoteViewsService {

  @Override
  public RemoteViewsFactory onGetViewFactory(Intent intent) {
    return new GoodsFactory(getApplicationContext());
  }

  static class GoodsFactory implements RemoteViewsFactory {
    private final Context ctx;
    private final List<JSONObject> items = new ArrayList<>();
    private boolean dark = false;
    private JSONObject db;

    GoodsFactory(Context ctx) { this.ctx = ctx; }

    @Override public void onCreate() {}

    @Override public void onDestroy() {
      items.clear();
      db = null;
    }

    @Override public void onDataSetChanged() {
      items.clear();
      dark = WidgetStore.isDarkTheme(ctx);
      db = WidgetStore.readDB(ctx);
      JSONArray goods = db != null ? db.optJSONArray("goods") : null;
      if (goods == null) return;
      for (int i = 0; i < goods.length(); i++) {
        JSONObject g = goods.optJSONObject(i);
        if (g == null) continue;
        if (!"Active".equals(g.optString("status", "Active"))) continue;
        items.add(g);
      }
    }

    @Override public int getCount() { return items.size(); }

    @Override public RemoteViews getViewAt(int position) {
      if (position < 0 || position >= items.size()) return null;
      JSONObject g = items.get(position);
      RemoteViews rv = new RemoteViews(ctx.getPackageName(), R.layout.widget_goods_item);

      String name = g.optString("emoji", "🛍️") + " " + g.optString("name", "—");
      String cost = GoodsWidgetProvider.costSummary(g, db);
      rv.setTextViewText(R.id.widget_goods_item_name, name);
      rv.setTextColor(R.id.widget_goods_item_name, dark ? 0xFFF0F2F5 : 0xFF1F2430);
      rv.setTextViewText(R.id.widget_goods_item_cost, cost.isEmpty() ? "未配置消耗" : "消耗 " + cost);
      rv.setTextColor(R.id.widget_goods_item_cost, dark ? 0xFFA8B0BD : 0xFF6B7482);
      rv.setInt(R.id.widget_goods_item_card, "setBackgroundResource",
          dark ? R.drawable.widget_goods_row_bg_dark : R.drawable.widget_goods_row_bg);
      rv.setTextColor(R.id.widget_goods_item_btn, dark ? 0xFF8FB8E8 : 0xFF4A7FBF);
      rv.setInt(R.id.widget_goods_item_btn, "setBackgroundResource",
          dark ? R.drawable.widget_act_bg_dark : R.drawable.widget_add_bg);

      // 列表项点击由 Provider 的 PendingIntent 模板接住，这里只填商品 id。
      // 卡片和按钮都挂同一份 fill-in：只挂按钮时，点名字/空白处会像「没反应」。
      Intent fill = new Intent();
      fill.putExtra(GoodsWidgetProvider.EXTRA_GOOD_ID, g.optString("id"));
      rv.setOnClickFillInIntent(R.id.widget_goods_item_card, fill);
      rv.setOnClickFillInIntent(R.id.widget_goods_item_btn, fill);
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
