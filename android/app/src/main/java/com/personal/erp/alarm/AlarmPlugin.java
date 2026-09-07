package com.personal.erp.alarm;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * 闹钟原生桥（Capacitor "Alarm"）：
 *  - scheduleAlarm({id,title,body,at})：AlarmManager 精确闹钟（后台/被杀/锁屏仍触发）；
 *    Android 12+ 无 SCHEDULE_EXACT_ALARM 权限时降级 setAndAllowWhileIdle（Doze 下可延迟）。
 *  - cancelAlarm({id}) / cancelAllAlarms()：取消。
 *  - stopAlarm()：停铃 + 取消全屏通知（JS 处理完提醒后调用）。
 * 到点行为在 AlarmReceiver（响铃 + 锁屏全屏提醒 + 停止按钮）；重启恢复在 BootReceiver。
 * JS 侧：Capacitor.registerPlugin('Alarm')。
 */
@CapacitorPlugin(name = "Alarm")
public class AlarmPlugin extends Plugin {

  @PluginMethod
  public void scheduleAlarm(PluginCall call) {
    try {
      Object idObj = call.getData().opt("id");
      Object atObj = call.getData().opt("at");
      if (!(idObj instanceof Number) || !(atObj instanceof Number)) {
        call.reject("id/at required"); return;
      }
      int id = ((Number) idObj).intValue();
      long at = ((Number) atObj).longValue();
      String title = call.getString("title", "⏰ 日程提醒");
      String body = call.getString("body", "");

      Context ctx = getContext();
      AlarmStore.save(ctx, id, title, body, at);

      Intent i = new Intent(ctx, AlarmReceiver.class);
      i.setAction(AlarmReceiver.ACTION_FIRE);
      i.putExtra("id", id);
      i.putExtra("title", title);
      i.putExtra("body", body);
      int flags = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 23 ? PendingIntent.FLAG_IMMUTABLE : 0);
      PendingIntent pi = PendingIntent.getBroadcast(ctx, id, i, flags);
      AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
      if (Build.VERSION.SDK_INT >= 31 && !am.canScheduleExactAlarms()) {
        am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi); // 无精确闹钟权限 → 降级（可能延迟）
      } else {
        am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi);
      }
      call.resolve();
    } catch (Exception e) {
      call.reject(e.getMessage() == null ? "scheduleAlarm failed" : e.getMessage());
    }
  }

  @PluginMethod
  public void cancelAlarm(PluginCall call) {
    try {
      Object idObj = call.getData().opt("id");
      if (idObj instanceof Number) {
        int id = ((Number) idObj).intValue();
        Context ctx = getContext();
        AlarmStore.remove(ctx, id);
        Intent i = new Intent(ctx, AlarmReceiver.class);
        i.setAction(AlarmReceiver.ACTION_FIRE);
        int flags = PendingIntent.FLAG_NO_CREATE | (Build.VERSION.SDK_INT >= 23 ? PendingIntent.FLAG_IMMUTABLE : 0);
        PendingIntent pi = PendingIntent.getBroadcast(ctx, id, i, flags);
        if (pi != null) {
          AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
          am.cancel(pi);
          pi.cancel();
        }
      }
      call.resolve();
    } catch (Exception e) {
      call.reject(e.getMessage() == null ? "cancelAlarm failed" : e.getMessage());
    }
  }

  @PluginMethod
  public void cancelAllAlarms(PluginCall call) {
    try {
      Context ctx = getContext();
      AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
      org.json.JSONArray arr = AlarmStore.readAll(ctx);
      for (int i = 0; i < arr.length(); i++) {
        org.json.JSONObject o = arr.optJSONObject(i);
        if (o == null) continue;
        int id = o.optInt("id", 0);
        Intent it = new Intent(ctx, AlarmReceiver.class);
        it.setAction(AlarmReceiver.ACTION_FIRE);
        int flags = PendingIntent.FLAG_NO_CREATE | (Build.VERSION.SDK_INT >= 23 ? PendingIntent.FLAG_IMMUTABLE : 0);
        PendingIntent pi = PendingIntent.getBroadcast(ctx, id, it, flags);
        if (pi != null) { am.cancel(pi); pi.cancel(); }
      }
      AlarmStore.clear(ctx);
      call.resolve();
    } catch (Exception e) {
      call.reject(e.getMessage() == null ? "cancelAllAlarms failed" : e.getMessage());
    }
  }

  /** 停铃 + 取消全屏通知（JS 处理完闹钟后调用；被杀场景下用户点通知回 App 也会经此） */
  @PluginMethod
  public void stopAlarm(PluginCall call) {
    AlarmTonePlayer.stop();
    try {
      android.app.NotificationManager nm =
          (android.app.NotificationManager) getContext().getSystemService(Context.NOTIFICATION_SERVICE);
      nm.cancel(AlarmReceiver.FULLSCREEN_NOTIF_ID);
    } catch (Exception ignored) {}
    call.resolve();
  }
}
