package com.personal.erp.timer;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.media.MediaPlayer;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.os.VibrationEffect;
import android.os.Vibrator;

import androidx.core.app.NotificationCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.personal.erp.MainActivity;
import com.personal.erp.R;

/**
 * 番茄钟原生增强：
 *  - showControls：控制栏常驻通知（⏸ 暂停 / ▶ 继续 / ⏹ 结束），按钮经 TimerControlReceiver 回 JS；
 *  - ring / stopRing：到时播放系统铃声（闹铃音）并震动，直到用户处理。
 * JS 侧：Capacitor.registerPlugin('Timer') → showControls/hideControls/ring/stopRing；
 * 按钮事件 window 事件 "timerControl" {action: pause|resume|stop}。
 */
@CapacitorPlugin(name = "Timer")
public class TimerPlugin extends Plugin {
  public static final String CHANNEL_ID = "timer_controls";
  public static final int NOTIF_ID = 9001;
  private MediaPlayer ringtone;

  private NotificationManager nm() {
    return (NotificationManager) getContext().getSystemService(Context.NOTIFICATION_SERVICE);
  }

  private void ensureChannel() {
    if (Build.VERSION.SDK_INT >= 26) {
      NotificationChannel ch = new NotificationChannel(CHANNEL_ID, "番茄钟控制", NotificationManager.IMPORTANCE_HIGH);
      ch.setDescription("运行中番茄钟的暂停/继续/结束操作与到时提醒");
      nm().createNotificationChannel(ch);
    }
  }

  private PendingIntent action(String act) {
    Intent i = new Intent(getContext(), TimerControlReceiver.class);
    i.setAction("com.personal.erp.timer.CONTROL");
    i.putExtra("action", act);
    i.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
    int flags = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 23 ? PendingIntent.FLAG_IMMUTABLE : 0);
    return PendingIntent.getBroadcast(getContext(), act.hashCode(), i, flags);
  }

  private PendingIntent openApp() {
    Intent i = new Intent(getContext(), MainActivity.class);
    i.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
    int flags = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 23 ? PendingIntent.FLAG_IMMUTABLE : 0);
    return PendingIntent.getActivity(getContext(), 0, i, flags);
  }

  private String mmss(long ms) {
    long total = Math.max(0, ms) / 1000;
    return String.format(java.util.Locale.US, "%02d:%02d", total / 60, total % 60);
  }

  /** 显示/更新控制栏常驻通知。running=true → 显示「暂停」；否则显示「继续」。 */
  @PluginMethod
  public void showControls(PluginCall call) {
    try {
      ensureChannel();
      String title = call.getString("title", "🍅 番茄钟");
      boolean running = call.getBoolean("running", true);
      // ★ Capacitor 桥把 JS 数字反序列化为 Integer（1500000 在 int 范围），PluginCall.getLong 只认 Long
      //   → 用 getLong 读会拿默认 0 → 通知恒显「00:00」。改用 Number 安全读取。
      long remainingMs = 0;
      Object rem = call.getData().opt("remainingMs");
      if (rem instanceof Number) remainingMs = ((Number) rem).longValue();
      String state = running ? ("倒计时 " + mmss(remainingMs)) : ("已暂停 · " + mmss(remainingMs));

      NotificationCompat.Builder b = new NotificationCompat.Builder(getContext(), CHANNEL_ID)
          .setSmallIcon(R.mipmap.ic_launcher)
          .setContentTitle(title)
          .setContentText(state)
          .setOngoing(true)          // 常驻，不可滑动清除
          .setOnlyAlertOnce(true)    // 更新不重复响铃
          .setContentIntent(openApp())
          .setVisibility(NotificationCompat.VISIBILITY_PUBLIC);
      if (running) b.addAction(R.mipmap.ic_launcher, "⏸ 暂停", action("pause"));
      else b.addAction(R.mipmap.ic_launcher, "▶ 继续", action("resume"));
      b.addAction(R.mipmap.ic_launcher, "⏹ 结束", action("stop"));
      nm().notify(NOTIF_ID, b.build());
      call.resolve();
    } catch (Exception e) {
      call.reject(e.getMessage() == null ? "showControls failed" : e.getMessage());
    }
  }

  @PluginMethod
  public void hideControls(PluginCall call) {
    try { nm().cancel(NOTIF_ID); } catch (Exception ignored) {}
    call.resolve();
  }

  /** 到时响铃 + 震动（重复直到 stopRing）。 */
  @PluginMethod
  public void ring(PluginCall call) {
    try {
      stopRingInternal();
      Uri uri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM);
      if (uri == null) uri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION);
      ringtone = MediaPlayer.create(getContext(), uri);
      if (ringtone != null) {
        ringtone.setLooping(true);
        ringtone.start();
      }
      Vibrator v = (Vibrator) getContext().getSystemService(Context.VIBRATOR_SERVICE);
      if (v != null) {
        long[] pattern = { 0, 600, 300, 600 };
        if (Build.VERSION.SDK_INT >= 26) v.vibrate(VibrationEffect.createWaveform(pattern, 0));
        else v.vibrate(pattern, 0);
      }
    } catch (Exception ignored) {}
    call.resolve();
  }

  @PluginMethod
  public void stopRing(PluginCall call) {
    stopRingInternal();
    call.resolve();
  }

  private void stopRingInternal() {
    if (ringtone != null) {
      try { if (ringtone.isPlaying()) ringtone.stop(); ringtone.release(); } catch (Exception ignored) {}
      ringtone = null;
    }
  }
}
