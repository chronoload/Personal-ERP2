package com.personal.erp.alarm;

import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

import androidx.core.app.NotificationCompat;

import com.personal.erp.MainActivity;
import com.personal.erp.R;

/**
 * 闹钟到点接收器：
 *  - 响铃 + 震动（AlarmTonePlayer 单例，被杀也可停）；
 *  - 发高优常驻通知：锁屏/后台 → fullScreenIntent 全屏亮屏显示（系统闹钟式体验），
 *    「停止响铃」按钮本地停铃，点通知主体回 App（alarm_action=open → JS alarmOpened）。
 *  - ACTION_STOP：本地停铃 + 取消全屏通知（「停止响铃」按钮）。
 */
public class AlarmReceiver extends BroadcastReceiver {
  public static final String ACTION_FIRE = "com.personal.erp.alarm.FIRE";
  public static final String ACTION_STOP = "com.personal.erp.alarm.STOP";
  public static final String CHANNEL_ID = "erp_alarms";
  public static final int FULLSCREEN_NOTIF_ID = 9100;

  @Override
  public void onReceive(Context context, Intent intent) {
    String action = intent.getAction();
    if (ACTION_STOP.equals(action)) {
      AlarmTonePlayer.stop();
      cancelNotif(context);
      return;
    }
    if (!ACTION_FIRE.equals(action)) return;

    int id = intent.getIntExtra("id", 0);
    String title = intent.getStringExtra("title");
    String body = intent.getStringExtra("body");

    // 到点：响铃 + 震动
    AlarmTonePlayer.play(context);

    // 全屏高优通知（锁屏/后台也全屏亮屏显示）+ 停止响铃按钮
    ensureChannel(context);
    PendingIntent open = openApp(context, id);
    NotificationCompat.Builder b = new NotificationCompat.Builder(context, CHANNEL_ID)
        .setSmallIcon(R.mipmap.ic_launcher)
        .setContentTitle(title == null || title.isEmpty() ? "⏰ 日程提醒" : title)
        .setContentText(body == null ? "" : body)
        .setCategory(NotificationCompat.CATEGORY_ALARM)
        .setPriority(NotificationCompat.PRIORITY_MAX)
        .setOngoing(true)
        .setAutoCancel(false)
        .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
        .setContentIntent(open)
        .addAction(R.mipmap.ic_launcher, "停止响铃", stopAction(context, id));
    if (Build.VERSION.SDK_INT >= 21) b.setFullScreenIntent(open, true);
    NotificationManager nm = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
    nm.notify(FULLSCREEN_NOTIF_ID, b.build());
  }

  private void ensureChannel(Context context) {
    if (Build.VERSION.SDK_INT >= 26) {
      android.app.NotificationChannel ch = new android.app.NotificationChannel(
          CHANNEL_ID, "日程提醒闹钟", android.app.NotificationManager.IMPORTANCE_HIGH);
      ch.setDescription("计划时间到点提醒：响铃 + 锁屏全屏显示");
      ch.enableVibration(false); // 震动由 AlarmTonePlayer 统一负责，避免通知双震
      ch.setSound(null, null);   // 声音由 AlarmTonePlayer 统一负责，避免双响
      NotificationManager nm = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
      nm.createNotificationChannel(ch);
    }
  }

  private PendingIntent openApp(Context context, int id) {
    Intent i = new Intent(context, MainActivity.class);
    i.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
    i.putExtra("alarm_action", "open");
    i.putExtra("alarm_id", id);
    int flags = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 23 ? PendingIntent.FLAG_IMMUTABLE : 0);
    return PendingIntent.getActivity(context, 1000 + id, i, flags);
  }

  private PendingIntent stopAction(Context context, int id) {
    Intent i = new Intent(context, AlarmReceiver.class);
    i.setAction(ACTION_STOP);
    i.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
    int flags = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 23 ? PendingIntent.FLAG_IMMUTABLE : 0);
    return PendingIntent.getBroadcast(context, 2000 + id, i, flags);
  }

  private void cancelNotif(Context context) {
    try {
      NotificationManager nm = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
      nm.cancel(FULLSCREEN_NOTIF_ID);
    } catch (Exception ignored) {}
  }
}
