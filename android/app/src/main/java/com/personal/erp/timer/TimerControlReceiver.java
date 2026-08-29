package com.personal.erp.timer;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

import com.personal.erp.MainActivity;

/**
 * 番茄钟控制栏通知按钮接收器：把「暂停/继续/结束」带回前台 App，
 * MainActivity 收到 timer_action extra 后触发 JS window 事件 "timerControl"。
 */
public class TimerControlReceiver extends BroadcastReceiver {
  @Override
  public void onReceive(Context context, Intent intent) {
    String action = intent.getStringExtra("action");
    if (action == null) return;
    Intent launch = new Intent(context, MainActivity.class);
    launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
    launch.putExtra("timer_action", action);
    context.startActivity(launch);
  }
}
