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
 * 商品快速消费小组件：桌面一键购买，独立于主程序。
 * 点击商品行 → 广播 ACTION_CONSUME → 原生直接改 SharedPreferences 里的 db
 * （余额检查 + 追加 goods 流水 + seq 自增）→ 刷新全部小组件。全程不打开 App。
 */
public class GoodsWidgetProvider extends AppWidgetProvider {
  public static final String ACTION_CONSUME = "com.personal.erp.widget.ACTION_CONSUME";
  public static final String EXTRA_GOOD_ID = "good_id";

  @Override
  public void onUpdate(Context context, AppWidgetManager mgr, int[] ids) {
    for (int id : ids) {
      try { updateOne(context, mgr, id); } catch (Exception ignored) {}
    }
  }

  /** 独立消费：余额充足则原生追加流水（与 JS 引擎 consumeGood 同构） */
  static String consume(Context ctx, String goodId) {
    try {
      JSONObject db = WidgetStore.readDB(ctx);
      if (db == null) return "数据未同步，请先打开应用";
      JSONArray goods = db.optJSONArray("goods");
      JSONArray resources = db.optJSONArray("resources");
      JSONArray txs = db.optJSONArray("txs");
      if (goods == null || resources == null || txs == null) return "数据异常";
      JSONObject good = null;
      for (int i = 0; i < goods.length(); i++) {
        JSONObject g = goods.optJSONObject(i);
        if (g != null && goodId.equals(g.optString("id"))) { good = g; break; }
      }
      if (good == null) return "商品不存在";
      if (!"Active".equals(good.optString("status", "Active"))) return "商品已停用";
      // 多资源成本：优先 costs 数组，兼容旧 {resource_id, price}
      org.json.JSONArray costs = good.optJSONArray("costs");
      java.util.List<org.json.JSONObject> costList = new java.util.ArrayList<>();
      if (costs != null && costs.length() > 0) {
        for (int i = 0; i < costs.length(); i++) {
          org.json.JSONObject c = costs.optJSONObject(i);
          if (c != null && c.optDouble("amount", 0) > 0) costList.add(c);
        }
      } else if (!good.optString("resource_id").isEmpty() && good.optDouble("price", 0) > 0) {
        org.json.JSONObject legacy = new org.json.JSONObject();
        try {
          legacy.put("resource_id", good.optString("resource_id"));
          legacy.put("amount", good.optDouble("price"));
          costList.add(legacy);
        } catch (Exception ignored) {}
      }
      if (costList.isEmpty()) return "商品未配置资源消耗";
      JSONObject seq = db.optJSONObject("seq");
      if (seq == null) { seq = new JSONObject(); db.put("seq", seq); }
      // 允许借贷：逐资源生成 credit 流水（余额可为负，与 JS 引擎一致）
      org.json.JSONArray nativeIds = db.optJSONArray("native_txs");
      int nextT = seq.optInt("t", 0);
      for (org.json.JSONObject c : costList) {
        nextT++;
        seq.put("t", nextT);
        JSONObject tx = new JSONObject();
        tx.put("id", "t" + nextT);
        tx.put("resource_id", c.optString("resource_id"));
        tx.put("debit", 0);
        tx.put("credit", c.optDouble("amount", 0));
        tx.put("source_type", "goods");
        tx.put("source_id", good.optString("id"));
        tx.put("note", "购买「" + good.optString("name", "") + "」×1");
        tx.put("reversal_of", JSONObject.NULL);
        tx.put("created", System.currentTimeMillis());
        txs.put(tx);
        WidgetStore.appendPending(ctx, new JSONObject(tx.toString()));
        // 登记为原生独立流水：JS 下次 pushData 时回合并，防止被旧数据覆盖
        if (nativeIds == null) { nativeIds = new org.json.JSONArray(); db.put("native_txs", nativeIds); }
        nativeIds.put("t" + nextT);
      }
      WidgetStore.writeDB(ctx, db);
      refreshAll(ctx);
      return null; // 成功
    } catch (Exception e) {
      return e.getMessage() == null ? "操作失败" : e.getMessage();
    }
  }

  static void refreshAll(Context ctx) {
    try {
      AppWidgetManager mgr = AppWidgetManager.getInstance(ctx);
      Class<?>[] providers = { TodayWidgetProvider.class, ResourcesWidgetProvider.class,
          GoalsWidgetProvider.class, GoodsWidgetProvider.class, LedgerWidgetProvider.class };
      for (Class<?> cls : providers) {
        int[] ids = mgr.getAppWidgetIds(new ComponentName(ctx, cls));
        for (int id : ids) {
          try {
            if (cls == TodayWidgetProvider.class) TodayWidgetProvider.updateOne(ctx, mgr, id);
            else if (cls == ResourcesWidgetProvider.class) ResourcesWidgetProvider.updateOne(ctx, mgr, id);
            else if (cls == GoalsWidgetProvider.class) GoalsWidgetProvider.updateOne(ctx, mgr, id);
            else if (cls == GoodsWidgetProvider.class) GoodsWidgetProvider.updateOne(ctx, mgr, id);
            else if (cls == LedgerWidgetProvider.class) LedgerWidgetProvider.updateOne(ctx, mgr, id);
          } catch (Exception ignored) {}
        }
      }
    } catch (Exception ignored) {}
  }

  static void updateOne(Context ctx, AppWidgetManager mgr, int widgetId) {
    RemoteViews rv = new RemoteViews(ctx.getPackageName(), R.layout.widget_goods);

    boolean dark = WidgetStore.isDarkTheme(ctx);
    rv.setInt(R.id.widget_goods_root, "setBackgroundResource", dark ? R.drawable.widget_bg_dark : R.drawable.widget_bg);
    rv.setTextColor(R.id.widget_goods_title, dark ? 0xFFF0F2F5 : 0xFF202631);
    rv.setTextColor(R.id.widget_goods_hint, dark ? 0xFFA8B0BD : 0xFF9AA3B2);
    rv.setTextColor(R.id.widget_goods_empty, dark ? 0xFFA8B0BD : 0xFF9AA3B2);

    // 列表数据源（可滚动）
    Intent svc = new Intent(ctx, GoodsWidgetService.class);
    svc.putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId);
    svc.setData(android.net.Uri.parse(svc.toUri(Intent.URI_INTENT_SCHEME)));
    rv.setRemoteAdapter(R.id.widget_goods_list, svc);
    rv.setEmptyView(R.id.widget_goods_list, R.id.widget_goods_empty);

    // 行内「消费」按钮：模板 PendingIntent + 行 fill-in 的 good_id
    // ★ 必须是 MUTABLE：每行的 good_id 靠 setOnClickFillInIntent 填进模板里，
    //   IMMUTABLE 会把这些 extras 丢掉，收到广播时 goodId == null → 点了完全没反应
    Intent tpl = new Intent(ctx, GoodsWidgetProvider.class);
    tpl.setAction(ACTION_CONSUME);
    tpl.setData(android.net.Uri.parse("erp://widget/goods/consume"));
    PendingIntent template = PendingIntent.getBroadcast(ctx, 90, tpl,
        PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_MUTABLE);
    rv.setPendingIntentTemplate(R.id.widget_goods_list, template);

    Intent open = new Intent(ctx, MainActivity.class);
    open.putExtra("erp_tab", "finance");
    PendingIntent po = PendingIntent.getActivity(ctx, 2, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    rv.setOnClickPendingIntent(R.id.widget_goods_title, po);

    mgr.updateAppWidget(widgetId, rv);
    mgr.notifyAppWidgetViewDataChanged(new int[]{widgetId}, R.id.widget_goods_list);
  }

  @Override
  public void onReceive(Context context, Intent intent) {
    super.onReceive(context, intent);
    if (ACTION_CONSUME.equals(intent.getAction())) {
      String goodId = intent.getStringExtra(EXTRA_GOOD_ID);
      String err;
      if (goodId == null || goodId.isEmpty()) {
        // 之前这里静默 return，点击像「死键」；现在明确报出来
        err = "消费失败：没取到商品";
      } else {
        err = consume(context, goodId); // 内部已 refreshAll
      }
      try {
        android.widget.Toast.makeText(context, err == null ? "已消费并入账" : err,
            android.widget.Toast.LENGTH_SHORT).show();
      } catch (Exception ignored) {}
    }
  }

  /** 商品成本的紧凑展示：优先 costs[]（多资源），兼容旧 price */
  static String costSummary(JSONObject g, JSONObject db) {
    try {
      org.json.JSONArray costs = g.optJSONArray("costs");
      StringBuilder sb = new StringBuilder();
      if (costs != null && costs.length() > 0) {
        for (int i = 0; i < costs.length() && sb.length() < 28; i++) {
          JSONObject c = costs.optJSONObject(i);
          if (c == null) continue;
          double amt = c.optDouble("amount", 0);
          if (amt <= 0) continue;
          if (sb.length() > 0) sb.append('+');
          sb.append(fmt(amt)).append(resLabel(db, c.optString("resource_id", "")));
        }
        if (sb.length() > 0) return sb.toString();
      }
      if (!g.optString("resource_id").isEmpty() && g.optDouble("price", 0) > 0) {
        return fmt(g.optDouble("price")) + resLabel(db, g.optString("resource_id"));
      }
    } catch (Exception ignored) {}
    return "";
  }

  private static String resLabel(JSONObject db, String resourceId) {
    if (db == null || resourceId == null || resourceId.isEmpty()) return "";
    try {
      org.json.JSONArray rs = db.optJSONArray("resources");
      if (rs == null) return "";
      for (int i = 0; i < rs.length(); i++) {
        JSONObject r = rs.optJSONObject(i);
        if (r != null && resourceId.equals(r.optString("id"))) {
          String unit = r.optString("unit", "");
          return unit.isEmpty() ? r.optString("name", "") : unit;
        }
      }
    } catch (Exception ignored) {}
    return "";
  }

  private static int rowId(Context ctx, int i) {
    return ctx.getResources().getIdentifier("widget_goods_row" + i, "id", ctx.getPackageName());
  }

  private static String fmt(double v) {
    if (v == Math.floor(v)) return String.valueOf((long) v);
    return String.format(java.util.Locale.US, "%.1f", v);
  }
}