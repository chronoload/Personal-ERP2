package com.personal.erp.alarm;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * 重启恢复：开机后从 AlarmStore 回捞未过期闹钟，重新注册到 AlarmManager
 * （Android 重启会清空系统闹钟）。App 未启动也能恢复，保证闹钟不丢。
 */
public class BootReceiver extends BroadcastReceiver {
  @Override
  public void onReceive(Context context, Intent intent) {
    if (!Intent.ACTION_BOOT_COMPLETED.equals(intent.getAction())) return;
    AlarmManager am = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
    JSONArray arr = AlarmStore.readAll(context);
    long now = System.currentTimeMillis();
    for (int i = 0; i < arr.length(); i++) {
      JSONObject o = arr.optJSONObject(i);
      if (o == null) continue;
      long at = o.optLong("at", 0);
      if (at <= now) continue; // 已过期（App 下次启动再同步清理）
      int id = o.optInt("id", 0);
      Intent fi = new Intent(context, AlarmReceiver.class);
      fi.setAction(AlarmReceiver.ACTION_FIRE);
      fi.putExtra("id", id);
      fi.putExtra("title", o.optString("title"));
      fi.putExtra("body", o.optString("body"));
      int flags = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 23 ? PendingIntent.FLAG_IMMUTABLE : 0);
      PendingIntent pi = PendingIntent.getBroadcast(context, id, fi, flags);
      try {
        if (Build.VERSION.SDK_INT >= 31 && !am.canScheduleExactAlarms()) {
          am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi);
        } else {
          am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi);
        }
      } catch (Exception ignored) {}
    }
    // 锁屏常驻通知：重启后系统会清掉通知，重新发一条并排下一次每日更新
    try {
      if (com.personal.erp.widget.WidgetStore.isLockEnabled(context)) {
        com.personal.erp.lockscreen.LockScreenNotifier.ensureChannel(context);
        com.personal.erp.lockscreen.LockScreenNotifier.scheduleDaily(context);
        com.personal.erp.lockscreen.LockScreenNotifier.post(context, false);
      }
    } catch (Exception ignored) {}
  }
}
