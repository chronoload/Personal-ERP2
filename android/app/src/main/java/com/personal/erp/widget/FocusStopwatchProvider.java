package com.personal.erp.widget;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.os.SystemClock;
import android.view.View;
import android.widget.RemoteViews;

import com.personal.erp.MainActivity;
import com.personal.erp.R;

import org.json.JSONObject;

import java.util.Locale;

/**
 * 专注停表（手动计时器，独立于任何任务数据）。
 *
 * 设计原则：时长预设直接摆在组件上——按「25 分 / 45 分」立即开始，不进配置页。
 * 「开始/暂停」切换，「重置」归零；进行中由 Chronometer 每秒走字 + 每分钟
 * Alarm 推进进度条 + 到点 Alarm 渲染「完成」。
 *
 * 状态存 per-widget（widget_cd_timer_<id>，与旧停表数据兼容）：
 *   { running:boolean, base:elapsedRealtime 基准, elapsed:暂停时固化的毫秒 }
 */
public class FocusStopwatchProvider extends AppWidgetProvider {

  @Override
  public void onUpdate(Context context, AppWidgetManager mgr, int[] ids) {
    for (int id : ids) {
      try { renderManual(context, mgr, id); } catch (Exception ignored) {}
    }
  }

  @Override
  public void onDeleted(Context context, int[] ids) {
    for (int id : ids) { cancelTick(context, id); cancelFinish(context, id); }
  }

  /** 完整渲染一个停表实例（CountdownWidgetProvider 的 legacy manual 实例也走这里） */
  static void renderManual(Context ctx, AppWidgetManager mgr, int widgetId) {
    RemoteViews rv = new RemoteViews(ctx.getPackageName(), R.layout.widget_stopwatch);
    boolean dark = WidgetStore.isDarkTheme(ctx);
    applyTheme(rv, dark);

    JSONObject cfg = WidgetStore.readCountdownConfig(ctx, widgetId);
    int minutes = cfg.optInt("minutes", 25);
    if (minutes < 1) minutes = 25;
    long duration = minutes * 60000L;
    String title = cfg.optString("title", "");
    if (title.isEmpty()) title = "专注计时";

    JSONObject st = WidgetStore.readTimerState(ctx, widgetId);
    boolean running = st.optBoolean("running", false);
    long base = st.optLong("base", 0);
    long elapsed = running && base > 0 ? (SystemClock.elapsedRealtime() - base) : st.optLong("elapsed", 0);
    if (elapsed < 0) elapsed = 0;
    boolean done = elapsed >= duration;
    if (done) elapsed = duration;
    long remain = duration - elapsed;

    rv.setTextViewText(R.id.sw_title, title);
    rv.setTextViewText(R.id.sw_total, "共 " + minutes + " 分");

    if (running && !done) {
      // 倒计时到点：base = elapsedRealtime + 剩余，系统自己按秒递减
      rv.setChronometer(R.id.sw_clock, SystemClock.elapsedRealtime() + remain, null, true);
      rv.setChronometerCountDown(R.id.sw_clock, true);
    } else {
      rv.setChronometer(R.id.sw_clock, SystemClock.elapsedRealtime(), null, false);
      rv.setTextViewText(R.id.sw_clock, done ? "00:00" : fmtClock(remain));
    }

    rv.setViewVisibility(R.id.sw_bar, View.VISIBLE);
    rv.setProgressBar(R.id.sw_bar, 100, (int) (elapsed * 100 / duration), false);

    String action;
    if (done) action = "再来";
    else if (running) action = "暂停";
    else if (elapsed > 0) action = "继续";
    else action = "开始";
    rv.setTextViewText(R.id.sw_action, action);

    boolean showReset = elapsed > 0 || running || done;
    rv.setViewVisibility(R.id.sw_reset, showReset ? View.VISIBLE : View.GONE);

    // 预设：按下立即以该时长开跑（并记住为默认时长）
    rv.setOnClickPendingIntent(R.id.sw_p25, presetPi(ctx, widgetId, 25, 4800));
    rv.setOnClickPendingIntent(R.id.sw_p45, presetPi(ctx, widgetId, 45, 4850));
    rv.setOnClickPendingIntent(R.id.sw_action, actionPi(ctx, widgetId, 4600));
    if (showReset) rv.setOnClickPendingIntent(R.id.sw_reset, resetPi(ctx, widgetId, 4700));

    PendingIntent open = openApp(ctx, 4900 + widgetId);
    rv.setOnClickPendingIntent(R.id.sw_root, open);
    rv.setOnClickPendingIntent(R.id.sw_clock, open);

    if (running && !done) { scheduleTick(ctx, widgetId); scheduleFinish(ctx, widgetId, remain, title); }
    else { cancelTick(ctx, widgetId); cancelFinish(ctx, widgetId); }

    mgr.updateAppWidget(widgetId, rv);
  }

  // ---------------- 状态切换（由 WidgetActionReceiver 调用） ----------------

  /** 开始 / 暂停；完成后按 = 从头再跑 */
  public static void toggleTimer(Context ctx, int widgetId) {
    JSONObject cfg = WidgetStore.readCountdownConfig(ctx, widgetId);
    int minutes = Math.max(1, cfg.optInt("minutes", 25));
    long duration = minutes * 60000L;

    JSONObject st = WidgetStore.readTimerState(ctx, widgetId);
    boolean running = st.optBoolean("running", false);
    long base = st.optLong("base", 0);
    long elapsed = running && base > 0 ? (SystemClock.elapsedRealtime() - base) : st.optLong("elapsed", 0);
    if (elapsed < 0) elapsed = 0;

    try {
      JSONObject next = new JSONObject();
      if (running) {
        next.put("running", false);
        next.put("elapsed", Math.min(elapsed, duration));
        next.put("base", 0);
      } else {
        long startFrom = elapsed >= duration ? 0 : elapsed; // 完成后 = 新一轮
        next.put("running", true);
        next.put("elapsed", startFrom);
        next.put("base", SystemClock.elapsedRealtime() - startFrom);
      }
      WidgetStore.writeTimerState(ctx, widgetId, next);
    } catch (Exception ignored) {}
    refreshOne(ctx, widgetId);
  }

  /** 重置归零 */
  public static void resetTimer(Context ctx, int widgetId) {
    try {
      JSONObject next = new JSONObject();
      next.put("running", false);
      next.put("elapsed", 0);
      next.put("base", 0);
      WidgetStore.writeTimerState(ctx, widgetId, next);
    } catch (Exception ignored) {}
    refreshOne(ctx, widgetId);
  }

  /** 预设时长：记住为默认并立即开跑 */
  public static void startPreset(Context ctx, int widgetId, int minutes) {
    try {
      JSONObject cfg = WidgetStore.readCountdownConfig(ctx, widgetId);
      cfg.put("mode", "manual");
      cfg.put("minutes", Math.max(1, Math.min(600, minutes)));
      if (cfg.optString("title", "").isEmpty()) cfg.put("title", "专注计时");
      WidgetStore.writeCountdownConfig(ctx, widgetId, cfg);

      JSONObject next = new JSONObject();
      next.put("running", true);
      next.put("elapsed", 0);
      next.put("base", SystemClock.elapsedRealtime());
      WidgetStore.writeTimerState(ctx, widgetId, next);
    } catch (Exception ignored) {}
    refreshOne(ctx, widgetId);
  }

  /** 每分钟 tick / 到点：重渲染（渲染内部自行决定是否续排闹钟） */
  public static void refreshOne(Context ctx, int widgetId) {
    try {
      AppWidgetManager mgr = AppWidgetManager.getInstance(ctx);
      renderManual(ctx, mgr, widgetId);
    } catch (Exception ignored) {}
  }

  // ---------------- 闹钟（进度条每分钟 + 到点渲染完成） ----------------

  static void scheduleTick(Context ctx, int widgetId) {
    try {
      AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
      if (am == null) return;
      am.setAndAllowWhileIdle(AlarmManager.RTC, System.currentTimeMillis() + 60000, tickPi(ctx, widgetId));
    } catch (Exception ignored) {}
  }

  static void cancelTick(Context ctx, int widgetId) {
    try {
      AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
      if (am != null) am.cancel(tickPi(ctx, widgetId));
    } catch (Exception ignored) {}
  }

  static void scheduleFinish(Context ctx, int widgetId, long remainMs, String title) {
    try {
      AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
      if (am == null) return;
      Intent i = new Intent(ctx, WidgetActionReceiver.class);
      i.setAction(WidgetActionReceiver.ACTION_CD_FINISH);
      i.putExtra(WidgetActionReceiver.EXTRA_WIDGET_ID, widgetId);
      i.putExtra(WidgetActionReceiver.EXTRA_KIND, "stopwatch");
      i.putExtra(WidgetActionReceiver.EXTRA_TITLE, title == null ? "" : title);
      PendingIntent pi = PendingIntent.getBroadcast(ctx, 5500 + widgetId, i,
          PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
      // 多给 0.5s：闹钟与 elapsedRealtime 的时基不同，避免提前 1ms 触发时判定为「还没完成」而重复提醒
      WidgetActionReceiver.setExact(am, System.currentTimeMillis() + Math.max(0, remainMs) + 500, pi);
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

  private static PendingIntent tickPi(Context ctx, int widgetId) {
    Intent i = new Intent(ctx, WidgetActionReceiver.class);
    i.setAction(WidgetActionReceiver.ACTION_CD_TICK);
    i.putExtra(WidgetActionReceiver.EXTRA_WIDGET_ID, widgetId);
    return PendingIntent.getBroadcast(ctx, 5200 + widgetId, i,
        PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
  }

  private static PendingIntent presetPi(Context ctx, int widgetId, int minutes, int codeBase) {
    Intent i = new Intent(ctx, WidgetActionReceiver.class);
    i.setAction(WidgetActionReceiver.ACTION_CD_PRESET);
    i.putExtra(WidgetActionReceiver.EXTRA_WIDGET_ID, widgetId);
    i.putExtra(WidgetActionReceiver.EXTRA_AMOUNT, minutes);
    return PendingIntent.getBroadcast(ctx, codeBase + widgetId, i,
        PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
  }

  private static PendingIntent actionPi(Context ctx, int widgetId, int codeBase) {
    Intent i = new Intent(ctx, WidgetActionReceiver.class);
    i.setAction(WidgetActionReceiver.ACTION_CD_TOGGLE);
    i.putExtra(WidgetActionReceiver.EXTRA_WIDGET_ID, widgetId);
    return PendingIntent.getBroadcast(ctx, codeBase + widgetId, i,
        PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
  }

  private static PendingIntent resetPi(Context ctx, int widgetId, int codeBase) {
    Intent i = new Intent(ctx, WidgetActionReceiver.class);
    i.setAction(WidgetActionReceiver.ACTION_CD_RESET);
    i.putExtra(WidgetActionReceiver.EXTRA_WIDGET_ID, widgetId);
    return PendingIntent.getBroadcast(ctx, codeBase + widgetId, i,
        PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
  }

  // ---------------- 杂项 ----------------

  private static String fmtClock(long ms) {
    long s = Math.max(0, ms / 1000);
    if (s >= 3600) return String.format(Locale.US, "%d:%02d:%02d", s / 3600, (s % 3600) / 60, s % 60);
    return String.format(Locale.US, "%02d:%02d", s / 60, s % 60);
  }

  private static PendingIntent openApp(Context ctx, int req) {
    Intent i = new Intent(ctx, MainActivity.class);
    i.putExtra("erp_tab", "overview");
    i.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
    return PendingIntent.getActivity(ctx, req, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
  }

  private static void applyTheme(RemoteViews rv, boolean dark) {
    rv.setInt(R.id.sw_root, "setBackgroundResource", dark ? R.drawable.widget_bg_dark : R.drawable.widget_bg);
    rv.setTextColor(R.id.sw_title, dark ? 0xFFF0F2F5 : 0xFF202631);
    rv.setTextColor(R.id.sw_total, dark ? 0xFFA8B0BD : 0xFF6B7482);
    rv.setTextColor(R.id.sw_clock, dark ? 0xFFF0F2F5 : 0xFF202631);
    rv.setTextColor(R.id.sw_p25, dark ? 0xFF8FB8E8 : 0xFF4A7FBF);
    rv.setTextColor(R.id.sw_p45, dark ? 0xFF8FB8E8 : 0xFF4A7FBF);
    rv.setTextColor(R.id.sw_action, dark ? 0xFF8FB8E8 : 0xFF4A7FBF);
    rv.setTextColor(R.id.sw_reset, dark ? 0xFFA8B0BD : 0xFF6B7482);
    rv.setInt(R.id.sw_p25, "setBackgroundResource", dark ? R.drawable.widget_act_bg_dark : R.drawable.widget_add_bg);
    rv.setInt(R.id.sw_p45, "setBackgroundResource", dark ? R.drawable.widget_act_bg_dark : R.drawable.widget_add_bg);
    rv.setInt(R.id.sw_action, "setBackgroundResource", dark ? R.drawable.widget_act_bg_dark : R.drawable.widget_add_bg);
    rv.setInt(R.id.sw_reset, "setBackgroundResource", dark ? R.drawable.widget_act_bg_dark : R.drawable.widget_add_bg);
  }
}
