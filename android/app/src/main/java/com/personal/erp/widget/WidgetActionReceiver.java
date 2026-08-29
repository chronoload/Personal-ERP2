package com.personal.erp.widget;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * 小组件独立操作中枢：桌面点击 → 广播 → 原生直改 SharedPreferences 数据 → 刷新。
 * 仅承接「可表达为追加流水」的操作（消费/充值），此类改动通过 native_txs
 * 在 App 下次 pushData 时自动回合并，不会与主程序数据打架。
 */
public class WidgetActionReceiver extends BroadcastReceiver {
  public static final String ACTION_RECHARGE = "com.personal.erp.widget.ACTION_RECHARGE";
  public static final String ACTION_START = "com.personal.erp.widget.ACTION_START";
  public static final String EXTRA_RESOURCE_ID = "resource_id";
  public static final String EXTRA_AMOUNT = "amount";
  public static final String EXTRA_ACTIVITY_ID = "activity_id";

  @Override
  public void onReceive(Context context, Intent intent) {
    String action = intent.getAction();
    if (ACTION_RECHARGE.equals(action)) {
      String rid = intent.getStringExtra(EXTRA_RESOURCE_ID);
      double amt = intent.getDoubleExtra(EXTRA_AMOUNT, 0);
      if (rid != null && amt > 0) recharge(context, rid, amt);
      GoodsWidgetProvider.refreshAll(context);
    } else if (ACTION_START.equals(action)) {
      String aid = intent.getStringExtra(EXTRA_ACTIVITY_ID);
      if (aid != null) startActivity(context, aid);
      GoodsWidgetProvider.refreshAll(context);
    }
  }

  /** 桌面一键开始：Planned → Started（Loop 式直接打勾；状态字段修改靠 rev 回读同步，不走 txs 合并） */
  private void startActivity(Context ctx, String activityId) {
    try {
      JSONObject db = WidgetStore.readDB(ctx);
      if (db == null) return;
      JSONArray acts = db.optJSONArray("activities");
      if (acts == null) return;
      for (int i = 0; i < acts.length(); i++) {
        JSONObject a = acts.optJSONObject(i);
        if (a == null || !activityId.equals(a.optString("id"))) continue;
        if (!"Planned".equals(a.optString("status"))) return;
        a.put("status", "Started");
        a.put("actual_start", System.currentTimeMillis());
        WidgetStore.writeDB(ctx, db); // writeDB 自动 rev++ → JS 回前台时回读覆盖
        return;
      }
    } catch (Exception ignored) {}
  }

  /** 即时充值：追加 manual debit 流水（与 JS adjustResource 同构） */
  private void recharge(Context ctx, String resourceId, double amount) {
    try {
      JSONObject db = WidgetStore.readDB(ctx);
      if (db == null) return;
      JSONArray resources = db.optJSONArray("resources");
      JSONArray txs = db.optJSONArray("txs");
      if (resources == null || txs == null) return;
      boolean found = false;
      for (int i = 0; i < resources.length(); i++) {
        JSONObject r = resources.optJSONObject(i);
        if (r != null && resourceId.equals(r.optString("id"))) { found = true; break; }
      }
      if (!found) return;
      JSONObject seq = db.optJSONObject("seq");
      int nextT = (seq != null ? seq.optInt("t", 0) : 0) + 1;
      if (seq == null) { seq = new JSONObject(); db.put("seq", seq); }
      seq.put("t", nextT);
      JSONObject tx = new JSONObject();
      tx.put("id", "t" + nextT);
      tx.put("resource_id", resourceId);
      tx.put("debit", amount);
      tx.put("credit", 0);
      tx.put("source_type", "manual");
      tx.put("source_id", "widget");
      tx.put("note", "小组件快捷充值 +" + fmt(amount));
      tx.put("reversal_of", JSONObject.NULL);
      tx.put("created", System.currentTimeMillis());
      txs.put(tx);
      org.json.JSONArray nativeIds = db.optJSONArray("native_txs");
      if (nativeIds == null) { nativeIds = new org.json.JSONArray(); db.put("native_txs", nativeIds); }
      nativeIds.put("t" + nextT);
      WidgetStore.writeDB(ctx, db);
    } catch (Exception ignored) {}
  }

  private static String fmt(double v) {
    if (v == Math.floor(v)) return String.valueOf((long) v);
    return String.format(java.util.Locale.US, "%.1f", v);
  }
}