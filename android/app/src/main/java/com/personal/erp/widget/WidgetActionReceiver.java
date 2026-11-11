package com.personal.erp.widget;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
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
  public static final String ACTION_CD_TOGGLE = "com.personal.erp.widget.ACTION_CD_TOGGLE";
  public static final String ACTION_CD_RESET = "com.personal.erp.widget.ACTION_CD_RESET";
  public static final String ACTION_CD_TICK = "com.personal.erp.widget.ACTION_CD_TICK";
  public static final String ACTION_CD_FINISH = "com.personal.erp.widget.ACTION_CD_FINISH";
  public static final String ACTION_CD_PRESET = "com.personal.erp.widget.ACTION_CD_PRESET";
  public static final String ACTION_LEDGER_ADD = "com.personal.erp.widget.ACTION_LEDGER_ADD";
  public static final String ACTION_LEDGER_SWITCH = "com.personal.erp.widget.ACTION_LEDGER_SWITCH";
  public static final String EXTRA_RESOURCE_ID = "resource_id";
  public static final String EXTRA_AMOUNT = "amount";
  public static final String EXTRA_DIRECTION = "direction"; // income | expense
  public static final String EXTRA_ACTIVITY_ID = "activity_id";
  public static final String EXTRA_WIDGET_ID = "widget_id";
  public static final String EXTRA_KIND = "widget_kind";   // countdown | stopwatch：到点提醒的文案与归属
  public static final String EXTRA_TITLE = "widget_title";  // 到点时通知标题（调度那一刻写死，避免读不到数据）

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
      // 倒计时组件上的「提前开始」：任务已进入进行中，撤掉原到点闹钟，避免到点误报
      int cwid = intent.getIntExtra(EXTRA_WIDGET_ID, -1);
      if (cwid >= 0) {
        CountdownWidgetProvider.cancelFinish(context, cwid);
        CountdownWidgetProvider.refreshOne(context, cwid);
      }
      GoodsWidgetProvider.refreshAll(context);
    } else if (ACTION_CD_TOGGLE.equals(action)) {
      int wid = intent.getIntExtra(EXTRA_WIDGET_ID, -1);
      if (wid >= 0) FocusStopwatchProvider.toggleTimer(context, wid);
    } else if (ACTION_LEDGER_ADD.equals(action)) {
      int wid = intent.getIntExtra(EXTRA_WIDGET_ID, -1);
      double amount = intent.getDoubleExtra(EXTRA_AMOUNT, 0);
      boolean income = "income".equals(intent.getStringExtra(EXTRA_DIRECTION));
      String rid = wid >= 0 ? LedgerWidgetProvider.currentResourceId(context, wid) : null;
      String err = postTx(context, rid, amount, income, "桌面记账");
      if (err != null) {
        toast(context, err);
      } else {
        if (wid >= 0) LedgerWidgetProvider.refreshOne(context, wid);
        ResourcesWidgetProvider.refreshAll(context);
        toast(context, (income ? "+" : "−") + fmt(amount) + " 已入账");
      }
    } else if (ACTION_LEDGER_SWITCH.equals(action)) {
      int wid = intent.getIntExtra(EXTRA_WIDGET_ID, -1);
      if (wid >= 0) LedgerWidgetProvider.switchResource(context, wid);
    } else if (ACTION_CD_RESET.equals(action)) {
      int wid = intent.getIntExtra(EXTRA_WIDGET_ID, -1);
      if (wid >= 0) FocusStopwatchProvider.resetTimer(context, wid);
    } else if (ACTION_CD_PRESET.equals(action)) {
      int wid = intent.getIntExtra(EXTRA_WIDGET_ID, -1);
      int mins = intent.getIntExtra(EXTRA_AMOUNT, 25);
      if (wid >= 0) FocusStopwatchProvider.startPreset(context, wid, mins);
    } else if (ACTION_CD_TICK.equals(action)) {
      // 停表每分钟推进进度条；到点/停止后由渲染逻辑自行停止续排
      int wid = intent.getIntExtra(EXTRA_WIDGET_ID, -1);
      if (wid >= 0) FocusStopwatchProvider.refreshOne(context, wid);
    } else if (ACTION_CD_FINISH.equals(action)) {
      // 到点：先重渲染成「已到时间 / 完成」，再真正发出提醒（响铃 + 震动 + 通知）
      int wid = intent.getIntExtra(EXTRA_WIDGET_ID, -1);
      if (wid < 0) return;
      String kind = intent.getStringExtra(EXTRA_KIND);
      String title = intent.getStringExtra(EXTRA_TITLE);
      if ("stopwatch".equals(kind)) {
        FocusStopwatchProvider.refreshOne(context, wid);
        fireAlert(context, 9300 + wid,
            "⏱ " + (title == null || title.isEmpty() ? "专注结束" : title + " · 完成"),
            "时间到！回来记录这次专注吧");
      } else {
        CountdownWidgetProvider.refreshOne(context, wid);
        fireAlert(context, 9200 + wid,
            "⏰ " + (title == null || title.isEmpty() ? "倒计时结束" : title),
            "倒计时结束，开始行动吧");
      }
    }
  }

  private static void fireAlert(Context ctx, int id, String title, String body) {
    try {
      com.personal.erp.alarm.AlarmReceiver.fire(ctx, id, title, body);
    } catch (Exception ignored) {}
  }

  /** 精确闹钟：无精确权限时降级为「尽量准时」（Doze 下可能延迟） */
  static void setExact(AlarmManager am, long at, PendingIntent pi) {
    try {
      if (Build.VERSION.SDK_INT >= 31 && !am.canScheduleExactAlarms()) {
        am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi);
      } else if (Build.VERSION.SDK_INT >= 23) {
        am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi);
      } else {
        am.setExact(AlarmManager.RTC_WAKEUP, at, pi);
      }
    } catch (Exception ignored) {}
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

  /** 即时充值：走统一入账（manual debit 流水） */
  private void recharge(Context ctx, String resourceId, double amount) {
    postTx(ctx, resourceId, amount, true, "小组件快捷充值");
  }

  /**
   * 统一入账：追加一笔真实流水（收入=debit，支出=credit），seq.t 自增并登记 native_txs，
   * App 回前台时按 id 合并，余额与账本立刻变化。成功返回 null，失败返回可读原因。
   */
  static String postTx(Context ctx, String resourceId, double amount, boolean income, String notePrefix) {
    try {
      if (resourceId == null || resourceId.isEmpty()) return "未选择资源";
      if (!(amount > 0)) return "金额无效";
      JSONObject db = WidgetStore.readDB(ctx);
      if (db == null) return "数据未同步，请先打开应用";
      JSONArray resources = db.optJSONArray("resources");
      JSONArray txs = db.optJSONArray("txs");
      if (resources == null || txs == null) return "数据异常";
      JSONObject res = null;
      for (int i = 0; i < resources.length(); i++) {
        JSONObject r = resources.optJSONObject(i);
        if (r != null && resourceId.equals(r.optString("id"))) { res = r; break; }
      }
      if (res == null) return "资源不存在";

      JSONObject seq = db.optJSONObject("seq");
      if (seq == null) { seq = new JSONObject(); db.put("seq", seq); }
      int nextT = seq.optInt("t", 0) + 1;
      seq.put("t", nextT);

      JSONObject tx = new JSONObject();
      tx.put("id", "t" + nextT);
      tx.put("resource_id", resourceId);
      tx.put("debit", income ? amount : 0);
      tx.put("credit", income ? 0 : amount);
      tx.put("source_type", "manual");
      tx.put("source_id", "widget");
      tx.put("note", notePrefix + (income ? " +" : " −") + fmt(amount) + " " + res.optString("name", ""));
      tx.put("reversal_of", JSONObject.NULL);
      tx.put("created", System.currentTimeMillis());
      txs.put(tx);

      JSONArray nativeIds = db.optJSONArray("native_txs");
      if (nativeIds == null) { nativeIds = new JSONArray(); db.put("native_txs", nativeIds); }
      nativeIds.put("t" + nextT);

      WidgetStore.writeDB(ctx, db);
      return null;
    } catch (Exception e) {
      return e.getMessage() == null ? "操作失败" : e.getMessage();
    }
  }

  private static void toast(Context ctx, String msg) {
    try {
      android.widget.Toast.makeText(ctx, msg, android.widget.Toast.LENGTH_SHORT).show();
    } catch (Exception ignored) {}
  }

  private static String fmt(double v) {
    if (v == Math.floor(v)) return String.valueOf((long) v);
    return String.format(java.util.Locale.US, "%.1f", v);
  }
}