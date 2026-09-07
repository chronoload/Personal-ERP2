package com.personal.erp.alarm;

import android.content.Context;
import android.media.MediaPlayer;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.os.VibrationEffect;
import android.os.Vibrator;

/**
 * 闹钟铃声单例：循环播放系统闹铃音 + 波形震动，直到 stop()。
 * AlarmReceiver（到点）与 AlarmPlugin（JS stop）共用，保证被杀后也可停铃。
 */
public class AlarmTonePlayer {
  private static MediaPlayer tone;
  private static Vibrator vibrator;
  private static final long[] PATTERN = { 0, 600, 300, 600 };

  public static synchronized void play(Context ctx) {
    stop();
    try {
      Uri uri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM);
      if (uri == null) uri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION);
      tone = MediaPlayer.create(ctx, uri);
      if (tone != null) {
        tone.setLooping(true);
        tone.start();
      }
      vibrator = (Vibrator) ctx.getSystemService(Context.VIBRATOR_SERVICE);
      if (vibrator != null) {
        if (Build.VERSION.SDK_INT >= 26) vibrator.vibrate(VibrationEffect.createWaveform(PATTERN, 0));
        else vibrator.vibrate(PATTERN, 0);
      }
    } catch (Exception ignored) {}
  }

  public static synchronized void stop() {
    if (tone != null) {
      try {
        if (tone.isPlaying()) tone.stop();
        tone.release();
      } catch (Exception ignored) {}
      tone = null;
    }
    if (vibrator != null) {
      try { vibrator.cancel(); } catch (Exception ignored) {}
    }
  }

  public static synchronized boolean isPlaying() {
    return tone != null;
  }
}
