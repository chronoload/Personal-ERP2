package com.personal.erp.lockscreen;

import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;

import com.personal.erp.MainActivity;
import com.personal.erp.R;
import com.personal.erp.widget.WidgetStore;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.Calendar;

/**
 * 锁屏 / 开屏：一条常驻通知（锁屏可见、大文本列出今日安排）+ 可选的整页开屏。
 *
 * 设计边界：
 *  - 通知是主通道：不需要特殊权限（POST_NOTIFICATIONS 已由 App 启动时申请），锁屏上恒定可见；
 *  - 整页开屏走 fullScreenIntent：Android 14+ 只有用户允许「全屏通知」才会盖在锁屏上，
 *    未允许时系统自动降级为普通通知，所以永远先发通知再谈全屏；
 *  - 每天 07:00 由 AlarmManager 触发一次重发（当天首次才带全屏，避免反复弹屏）。
 */
public class LockScreenNotifier {

  static final String CHANNEL_ID = "erp_lock_today";
  static final int NOTIF_ID = 0x1E01;
  static final String ACTION_DAILY = "com.personal.erp.lockscreen.DAILY";
  private static final String KEY_LAST_FULL = "lock_last_full_day";
  private static final int DAILY_HOUR = 7; // 每天 07:00 更新并尝试开屏

  public static void ensureChannel(Context ctx) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
    NotificationManager nm = ctx.getSystemService(NotificationManager.class);
    if (nm == null) return;
    NotificationChannel ch = new NotificationChannel(CHANNEL_ID, "今日日程 · 锁屏", NotificationManager.IMPORTANCE_HIGH);
    ch.setDescription("锁屏上常驻展示今天的日程；可在应用设置里关闭");
    ch.setShowBadge(false);
    ch.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
    nm.createNotificationChannel(ch);
  }

  /** 系统是否允许「全屏通知」（Android 14+ 才有正式开关） */
  public static boolean canUseFullScreen(Context ctx) {
    try {
      if (Build.VERSION.SDK_INT >= 34) {
        NotificationManager nm = ctx.getSystemService(NotificationManager.class);
        return nm != null && nm.canUseFullScreenIntent();
      }
      return true;
    } catch (Exception e) { return false; }
  }

  /** 常规刷新：只更新通知内容，不触发全屏 */
  public static void post(Context ctx, boolean allowFull) {
    if (!WidgetStore.isLockEnabled(ctx)) return;
    ensureChannel(ctx);
    try {
      JSONObject db = WidgetStore.readDB(ctx);
      JSONArray board = WidgetStore.getBoard(db);
      int n = board.length();
      StringBuilder body = new StringBuilder();
      String first = "";
      for (int i = 0; i < n; i++) {
        JSONObject it = board.optJSONObject(i);
        if (it == null) continue;
        String kind = it.optString("kind", "today");
        JSONObject a = it.optJSONObject("act");
        if (a == null) continue;
        boolean done = !WidgetStore.isOpenActivity(a);
        String line = rowLine(a, done, kind);
        if (i < 8) body.append(line).append('\n');
        if (i == 0) first = line;
      }
      if (n == 0) body.append("今天还没有安排，点下方按钮添加第一条。");
      if (n > 8) body.append("…还有 ").append(n - 8).append(" 条");

      int todayCount = 0;
      for (int i = 0; i < n; i++) {
        JSONObject it = board.optJSONObject(i);
        if (it != null && "today".equals(it.optString("kind"))) todayCount++;
      }
      int runningN = WidgetStore.boardRunningCount(board);
      int pendingN = WidgetStore.boardPendingCount(board);
      int backlog = WidgetStore.backlogCount(db);
      String title;
      if (n == 0) title = "今日日程";
      else if (runningN > 0) title = pendingN > 0 ? "进行中 " + runningN + " · 待办 " + pendingN : "进行中 " + runningN;
      else if (pendingN == 0 && todayCount == 0) title = "今日无安排 · 待排 " + backlog;
      else if (pendingN == 0) title = backlog > 0 ? "今日已完成 · 还有 " + backlog + " 条待排" : "今日已完成 🎉";
      else title = "今日日程 · 待办 " + pendingN + "/" + todayCount;
      String sub = WidgetStore.fmtTodayLabel() + (n == 0 ? "" : " · 共 " + n + " 条");

      Intent openIntent = new Intent(ctx, MainActivity.class);
      openIntent.putExtra("erp_tab", "overview");
      openIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
      PendingIntent openPi = PendingIntent.getActivity(ctx, 3000, openIntent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

      Intent addIntent = new Intent(ctx, MainActivity.class);
      addIntent.putExtra("erp_tab", "overview");
      addIntent.putExtra("erp_fresh", true);
      addIntent.putExtra("erp_fresh_date", WidgetStore.todayKey());
      addIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
      PendingIntent addPi = PendingIntent.getActivity(ctx, 3001, addIntent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

      NotificationCompat.Builder b = new NotificationCompat.Builder(ctx, CHANNEL_ID)
          .setSmallIcon(R.mipmap.ic_launcher)
          .setContentTitle(title)
          .setContentText(first.isEmpty() ? sub : sub + "｜" + first)
          .setStyle(new NotificationCompat.BigTextStyle().bigText(body.toString().trim()))
          .setOngoing(true)
          .setOnlyAlertOnce(true)
          .setShowWhen(false)
          .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
          .setCategory(NotificationCompat.CATEGORY_REMINDER)
          .setPriority(NotificationCompat.PRIORITY_HIGH)
          .setContentIntent(openPi)
          .addAction(0, "＋ 添加今日日程", addPi)
          .addAction(0, "查看今天", openPi);

      if (allowFull && WidgetStore.isLockFull(ctx) && canUseFullScreen(ctx)) {
        Intent full = new Intent(ctx, LockScreenActivity.class);
        full.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent fullPi = PendingIntent.getActivity(ctx, 3002, full, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        b.setFullScreenIntent(fullPi, true);
      }

      NotificationManagerCompat.from(ctx).notify(NOTIF_ID, b.build());
      scheduleDaily(ctx); // 幂等：同一 PendingIntent 重排下一次 07:00
    } catch (Exception ignored) {}
  }

  /** 每日 07:00：当天首次允许整页开屏，之后只更新内容 */
  public static void postDaily(Context ctx) {
    if (!WidgetStore.isLockEnabled(ctx)) return;
    boolean firstToday = false;
    try {
      SharedPreferences sp = ctx.getSharedPreferences("erp_lock_store", Context.MODE_PRIVATE);
      String last = sp.getString(KEY_LAST_FULL, "");
      String today = WidgetStore.todayKey();
      if (!today.equals(last)) {
        sp.edit().putString(KEY_LAST_FULL, today).apply();
        firstToday = true;
      }
    } catch (Exception ignored) {}
    post(ctx, firstToday);
  }

  /** 用户主动预览（设置页按钮）：无视当天一次的限制，立即尝试整页开屏 */
  public static void preview(Context ctx) {
    if (!WidgetStore.isLockEnabled(ctx)) return;
    post(ctx, true);
  }

  public static void cancel(Context ctx) {
    try { NotificationManagerCompat.from(ctx).cancel(NOTIF_ID); } catch (Exception ignored) {}
  }

  /** 安排下一次每日更新（07:00，非精确，允许 Doze 下触发） */
  public static void scheduleDaily(Context ctx) {
    try {
      AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
      if (am == null) return;
      PendingIntent pi = dailyPi(ctx);
      Calendar c = Calendar.getInstance();
      c.set(Calendar.HOUR_OF_DAY, DAILY_HOUR);
      c.set(Calendar.MINUTE, 0);
      c.set(Calendar.SECOND, 0);
      c.set(Calendar.MILLISECOND, 0);
      if (c.getTimeInMillis() <= System.currentTimeMillis()) c.add(Calendar.DAY_OF_MONTH, 1);
      am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, c.getTimeInMillis(), pi);
    } catch (Exception ignored) {}
  }

  public static void cancelDaily(Context ctx) {
    try {
      AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
      if (am != null) am.cancel(dailyPi(ctx));
    } catch (Exception ignored) {}
  }

  private static PendingIntent dailyPi(Context ctx) {
    Intent i = new Intent(ctx, LockScreenDailyReceiver.class);
    i.setAction(ACTION_DAILY);
    return PendingIntent.getBroadcast(ctx, 3003, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
  }

  private static String rowLine(JSONObject a, boolean done, String kind) {
    String clock = "";
    String ps = WidgetStore.clockOf(a);
    int t = ps.indexOf('T');
    if (t >= 0 && t + 1 < ps.length()) clock = ps.substring(t + 1);
    String title = a.optString("title", "—");
    if ("running".equals(kind)) title = "进行中 · " + title;
    else if ("overdue".equals(kind)) title = "延期 · " + title;
    else if ("unscheduled".equals(kind)) title = "待排 · " + title;
    int tracked = WidgetStore.trackedMinutes(a);
    StringBuilder sb = new StringBuilder();
    if (done) sb.append("已完成 · ");
    if (!clock.isEmpty()) sb.append(clock).append("  ");
    sb.append(title);
    if (tracked > 0) sb.append(" · ").append(tracked).append("m");
    return sb.toString();
  }
}
