package com.personal.erp.lockscreen;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** 每天 07:00：重发锁屏通知（当天首次尝试整页开屏），并安排下一次 */
public class LockScreenDailyReceiver extends BroadcastReceiver {
  @Override
  public void onReceive(Context context, Intent intent) {
    try {
      LockScreenNotifier.postDaily(context);
      LockScreenNotifier.scheduleDaily(context);
    } catch (Exception ignored) {}
  }
}
