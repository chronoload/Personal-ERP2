package com.personal.erp.widget;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.content.Intent;
import android.os.SystemClock;
import android.view.View;
import android.widget.RemoteViews;

import com.personal.erp.MainActivity;
import com.personal.erp.R;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.Calendar;
import java.util.Locale;
import java.util.concurrent.TimeUnit;

/**
 * 任务倒计时小组件（纯被动：盯一个未来时间点，不手动计时）。
 *
 * 三种来源：next（下一个任务，默认）/ task（绑定指定任务）/ custom（自定义时间）。
 * 手动计时请用「ERP · 专注停表」；旧实例若配了 manual 会自动改走停表渲染。
 *
 * 显示规则（按剩余时长分档，避免 Chronometer 显示 76:23:45 这种荒谬小时数）：
 *   剩余 ≥ 24h → 静态大字「3天 4时」，状态行给目标时间
 *   剩余 < 24h → Chronometer 秒级倒计时
 *   到点（不论剩余多远）→ 精确闹钟：响铃 + 震动 + 通知，并把组件重渲染为「已到时间」
 *   绑定任务已开始 → 切换为「进行中」正计时 + 已用/计划进度条
 *   已过期仍未开始 → 钉在 00:00，右侧「开始」一键进入进行中
 */
public class CountdownWidgetProvider extends AppWidgetProvider {

  @Override
  public void onUpdate(Context context, AppWidgetManager mgr, int[] ids) {
    for (int id : ids) {
      try { updateOne(context, mgr, id); } catch (Exception ignored) {}
    }
  }

  @Override
  public void onDeleted(Context context, int[] ids) {
    for (int id : ids) cancelFinish(context, id);
  }

  static void updateOne(Context ctx, AppWidgetManager mgr, int widgetId) {
    JSONObject cfg = WidgetStore.readCountdownConfig(ctx, widgetId);
    // 旧版把停表混在这里：自动移交专注停表渲染（状态数据同构，无缝延续）
    if ("manual".equals(cfg.optString("mode", "next"))) {
      FocusStopwatchProvider.renderManual(ctx, mgr, widgetId);
      return;
    }
    RemoteViews rv = new RemoteViews(ctx.getPackageName(), R.layout.widget_countdown);
    boolean dark = WidgetStore.isDarkTheme(ctx);
    applyTheme(rv, dark);
    renderAuto(ctx, rv, widgetId, cfg, dark);
    mgr.updateAppWidget(widgetId, rv);
  }

  private static void renderAuto(Context ctx, RemoteViews rv, int widgetId, JSONObject cfg, boolean dark) {
    String mode = cfg.optString("mode", "next");
    JSONObject db = WidgetStore.readDB(ctx);

    String title = "";
    String activityId = null;
    long plannedMinutes = 0;
    long target = 0;
    boolean activityRunning = false; // 绑定任务已开始（正计时而非倒计时）

    if ("custom".equals(mode)) {
      title = cfg.optString("title", "自定义倒计时");
      target = cfg.optLong("target", 0);
    } else if ("task".equals(mode)) {
      JSONObject a = findActivity(db, cfg.optString("activityId", ""));
      if (a != null) {
        title = a.optString("title", "任务");
        activityId = a.optString("id");
        plannedMinutes = a.optLong("planned_minutes", 0);
        target = WidgetStore.parseDateTimeMs(a.optString("planned_start", ""));
        activityRunning = isRunning(a);
      } else {
        title = "任务已不存在";
      }
    } else {
      JSONObject a = pickNext(db);
      if (a != null) {
        title = a.optString("title", "下一个任务");
        activityId = a.optString("id");
        plannedMinutes = a.optLong("planned_minutes", 0);
        target = WidgetStore.parseDateTimeMs(a.optString("planned_start", ""));
        activityRunning = isRunning(a);
      } else {
        title = "没有已排期的任务";
      }
    }

    rv.setTextViewText(R.id.cd_title, title);
    rv.setViewVisibility(R.id.cd_reset, View.GONE);
    long now = System.currentTimeMillis();

    if (activityRunning) {
      // 进行中：正计时 + 已用/计划进度条（有计划时长才显示）
      JSONObject a = findActivity(db, activityId);
      long actual = a != null ? a.optLong("actual_start", 0) : 0;
      long elapsed = actual > 0 ? Math.max(0, now - actual) : 0;
      rv.setChronometer(R.id.cd_clock, SystemClock.elapsedRealtime() - elapsed, null, true);
      rv.setTextViewText(R.id.cd_target, "进行中");
      if (plannedMinutes > 0) {
        rv.setViewVisibility(R.id.cd_bar, View.VISIBLE);
        rv.setProgressBar(R.id.cd_bar, 100,
            (int) Math.min(100, elapsed * 100 / (plannedMinutes * 60000L)), false);
      } else {
        rv.setViewVisibility(R.id.cd_bar, View.GONE);
      }
      rv.setTextViewText(R.id.cd_status, "已 " + (elapsed / 60000) + " 分"
          + (plannedMinutes > 0 ? " / 计划 " + plannedMinutes + " 分" : ""));
      rv.setTextViewText(R.id.cd_action, "查看");
      rv.setOnClickPendingIntent(R.id.cd_action, openApp(ctx, 4200 + widgetId));
      cancelFinish(ctx, widgetId);
    } else if (target <= 0) {
      rv.setChronometer(R.id.cd_clock, SystemClock.elapsedRealtime(), null, false);
      rv.setTextViewText(R.id.cd_clock, "--:--");
      rv.setTextViewText(R.id.cd_target, "");
      rv.setViewVisibility(R.id.cd_bar, View.GONE);
      rv.setTextViewText(R.id.cd_status, "打开 App 排一个任务，这里会自动开始倒计时");
      rv.setTextViewText(R.id.cd_action, "打开");
      rv.setOnClickPendingIntent(R.id.cd_action, openApp(ctx, 4200 + widgetId));
      cancelFinish(ctx, widgetId);
    } else if (target <= now) {
      // 已到点仍未开始：钉在 00:00，一键开始 → 下次刷新变「进行中」
      rv.setChronometer(R.id.cd_clock, SystemClock.elapsedRealtime(), null, false);
      rv.setTextViewText(R.id.cd_clock, "00:00");
      rv.setTextViewText(R.id.cd_target, fmtTarget(target));
      rv.setViewVisibility(R.id.cd_bar, View.GONE);
      rv.setTextViewText(R.id.cd_status, "已到时间" + (activityId != null ? "，要开始吗？" : ""));
      if (activityId != null) {
        rv.setTextViewText(R.id.cd_action, "开始");
        Intent it = new Intent(ctx, WidgetActionReceiver.class);
        it.setAction(WidgetActionReceiver.ACTION_START);
        it.putExtra(WidgetActionReceiver.EXTRA_ACTIVITY_ID, activityId);
        it.putExtra(WidgetActionReceiver.EXTRA_WIDGET_ID, widgetId);
        rv.setOnClickPendingIntent(R.id.cd_action, PendingIntent.getBroadcast(ctx, 4100 + widgetId, it,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE));
      } else {
        rv.setTextViewText(R.id.cd_action, "打开");
        rv.setOnClickPendingIntent(R.id.cd_action, openApp(ctx, 4200 + widgetId));
      }
      cancelFinish(ctx, widgetId);
    } else {
      long remain = target - now;
      rv.setViewVisibility(R.id.cd_bar, View.GONE);
      rv.setTextViewText(R.id.cd_target, fmtTarget(target));
      if (remain >= TimeUnit.HOURS.toMillis(24)) {
        // 跨天：静态大字，秒针跳动没有意义
        rv.setChronometer(R.id.cd_clock, SystemClock.elapsedRealtime(), null, false);
        rv.setTextViewText(R.id.cd_clock, fmtDays(remain));
        rv.setTextViewText(R.id.cd_status, "还有 " + humanRemain(remain));
      } else {
        // 当天：秒级倒计时；到点由闹钟重渲染为「已到时间」
        rv.setChronometer(R.id.cd_clock, SystemClock.elapsedRealtime() + remain, null, true);
        rv.setChronometerCountDown(R.id.cd_clock, true);
        rv.setTextViewText(R.id.cd_status, "还有 " + humanRemain(remain));
      }
      // 不论还剩几天都排到点闹钟：跨天目标同样必须在那一刻提醒（此前只在 24h 内排，远处的永远不响）
      scheduleFinish(ctx, widgetId, remain, title);
      if (activityId != null) {
        rv.setTextViewText(R.id.cd_action, "提前开始");
        Intent it = new Intent(ctx, WidgetActionReceiver.class);
        it.setAction(WidgetActionReceiver.ACTION_START);
        it.putExtra(WidgetActionReceiver.EXTRA_ACTIVITY_ID, activityId);
        it.putExtra(WidgetActionReceiver.EXTRA_WIDGET_ID, widgetId);
        rv.setOnClickPendingIntent(R.id.cd_action, PendingIntent.getBroadcast(ctx, 4100 + widgetId, it,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE));
      } else {
        rv.setTextViewText(R.id.cd_action, "打开");
        rv.setOnClickPendingIntent(R.id.cd_action, openApp(ctx, 4200 + widgetId));
      }
    }

    PendingIntent open = openApp(ctx, 4300 + widgetId);
    rv.setOnClickPendingIntent(R.id.cd_root, open);
    rv.setOnClickPendingIntent(R.id.cd_clock, open);
  }

  // ---------------- 到点闹钟 ----------------

  static void refreshOne(Context ctx, int widgetId) {
    try {
      AppWidgetManager mgr = AppWidgetManager.getInstance(ctx);
      updateOne(ctx, mgr, widgetId);
    } catch (Exception ignored) {}
  }

  /** 到点闹钟：到点重渲染成「已到时间」，并带上标题供提醒文案使用（精确闹钟优先） */
  private static void scheduleFinish(Context ctx, int widgetId, long remainMs, String title) {
    try {
      AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
      if (am == null) return;
      Intent i = new Intent(ctx, WidgetActionReceiver.class);
      i.setAction(WidgetActionReceiver.ACTION_CD_FINISH);
      i.putExtra(WidgetActionReceiver.EXTRA_WIDGET_ID, widgetId);
      i.putExtra(WidgetActionReceiver.EXTRA_KIND, "countdown");
      i.putExtra(WidgetActionReceiver.EXTRA_TITLE, title == null ? "" : title);
      PendingIntent pi = PendingIntent.getBroadcast(ctx, 5500 + widgetId, i,
          PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
      WidgetActionReceiver.setExact(am, System.currentTimeMillis() + Math.max(0, remainMs), pi);
    } catch (Exception ignored) {}
  }

  static void cancelFinish(Context ctx, int widgetId) {
    try {
      AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
      if (am == null) return;
      Intent i = new Intent(ctx, WidgetActionReceiver.class);
      i.setAction(WidgetActionReceiver.ACTION_CD_FINISH);
      PendingIntent pi = PendingIntent.getBroadcast(ctx, 5500 + widgetId, i,
          PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
      am.cancel(pi);
    } catch (Exception ignored) {}
  }

  // ---------------- 数据 ----------------

  /** 下一个：未开始 + 有排期 + 目标时间最近（已开始的跳过——那是「进行中」不是「即将到来」） */
  private static JSONObject pickNext(JSONObject db) {
    if (db == null) return null;
    JSONArray acts = db.optJSONArray("activities");
    if (acts == null) return null;
    long now = System.currentTimeMillis();
    JSONObject best = null;
    long bestMs = Long.MAX_VALUE;
    for (int i = 0; i < acts.length(); i++) {
      JSONObject a = acts.optJSONObject(i);
      if (!WidgetStore.isOpenActivity(a) || isRunning(a)) continue;
      long t = WidgetStore.parseDateTimeMs(a.optString("planned_start", ""));
      if (t <= 0 || t < now) continue; // 只看未来；过期未开始的不是"下一个"
      if (t < bestMs) { bestMs = t; best = a; }
    }
    return best;
  }

  private static boolean isRunning(JSONObject a) {
    return a != null && "Started".equals(a.optString("status")) && a.optLong("actual_start", 0) > 0;
  }

  private static JSONObject findActivity(JSONObject db, String id) {
    if (db == null || id == null || id.isEmpty()) return null;
    JSONArray acts = db.optJSONArray("activities");
    if (acts == null) return null;
    for (int i = 0; i < acts.length(); i++) {
      JSONObject a = acts.optJSONObject(i);
      if (a != null && id.equals(a.optString("id"))) return a;
    }
    return null;
  }

  private static String humanRemain(long ms) {
    long mins = ms / 60000;
    long days = mins / (60 * 24);
    long hours = (mins % (60 * 24)) / 60;
    long m = mins % 60;
    if (days > 0) return days + " 天 " + hours + " 小时";
    if (hours > 0) return hours + " 小时 " + m + " 分";
    return Math.max(1, m) + " 分钟";
  }

  /** 跨天静态大字：3天4时 / 26时（不满 2 天时给小时更直观） */
  private static String fmtDays(long ms) {
    long hours = ms / 3600000;
    if (hours < 48) return hours + "时";
    long days = hours / 24;
    return days + "天" + (hours % 24) + "时";
  }

  private static String fmtTarget(long ms) {
    Calendar c = Calendar.getInstance();
    c.setTimeInMillis(ms);
    Calendar n = Calendar.getInstance();
    boolean sameDay = c.get(Calendar.YEAR) == n.get(Calendar.YEAR)
        && c.get(Calendar.DAY_OF_YEAR) == n.get(Calendar.DAY_OF_YEAR);
    String hm = String.format(Locale.US, "%02d:%02d", c.get(Calendar.HOUR_OF_DAY), c.get(Calendar.MINUTE));
    if (sameDay) return "今天 " + hm;
    return (c.get(Calendar.MONTH) + 1) + "/" + c.get(Calendar.DAY_OF_MONTH) + " " + hm;
  }

  private static PendingIntent openApp(Context ctx, int req) {
    Intent i = new Intent(ctx, MainActivity.class);
    i.putExtra("erp_tab", "overview");
    i.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
    return PendingIntent.getActivity(ctx, req, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
  }

  private static void applyTheme(RemoteViews rv, boolean dark) {
    rv.setInt(R.id.cd_root, "setBackgroundResource", dark ? R.drawable.widget_bg_dark : R.drawable.widget_bg);
    rv.setTextColor(R.id.cd_title, dark ? 0xFFF0F2F5 : 0xFF202631);
    rv.setTextColor(R.id.cd_target, dark ? 0xFFA8B0BD : 0xFF6B7482);
    rv.setTextColor(R.id.cd_clock, dark ? 0xFFF0F2F5 : 0xFF202631);
    rv.setTextColor(R.id.cd_status, dark ? 0xFFA8B0BD : 0xFF6B7482);
    rv.setTextColor(R.id.cd_action, dark ? 0xFF8FB8E8 : 0xFF4A7FBF);
    rv.setInt(R.id.cd_action, "setBackgroundResource", dark ? R.drawable.widget_act_bg_dark : R.drawable.widget_add_bg);
  }
}
