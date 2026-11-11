package com.personal.erp;

import android.content.Intent;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;
import com.personal.erp.alarm.AlarmPlugin;
import com.personal.erp.widget.WidgetPlugin;
import com.personal.erp.sync.SyncPlugin;
import com.personal.erp.timer.TimerPlugin;
import com.personal.erp.geofence.GeofencePlugin;
import com.personal.erp.lockscreen.LockScreenPlugin;

public class MainActivity extends BridgeActivity {
  // ★ Capacitor 8 关键：桥在 BridgeActivity.onCreate 内同步构建（super.onCreate → this.load() → bridgeBuilder.create()）。
  //   自定义插件必须在本类的 load() 里、super.load()（真正创建桥）之前注册；
  //   否则 registerPlugin 只加入 builder 而桥早已创建 → 插件永不生效（「X is not implemented in Android」根因）。
  @Override
  protected void load() {
    registerPlugin(WidgetPlugin.class); // 桌面小组件桥（setTimerState/getTimerState/pushData/getData）
    registerPlugin(SyncPlugin.class);   // 局域网同步服务（start/stop/status/ping）
    registerPlugin(TimerPlugin.class);  // 番茄钟控制栏 + 铃声（showControls/ring）
    registerPlugin(AlarmPlugin.class);  // 闹钟桥（日程提醒：后台响铃 + 锁屏全屏 + 重启恢复）
    registerPlugin(GeofencePlugin.class); // 地理围栏桥（地点进/出事件 + 一次性定位）
    registerPlugin(LockScreenPlugin.class); // 锁屏 / 开屏桥（常驻通知 + 亮屏整页）
    super.load();
  }

  @Override
  public void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    // 启动 extra 由 load() 内部触发的 onNewIntent(getIntent()) 统一处理（见下），这里不再重复
  }

  @Override
  public void onNewIntent(Intent intent) {
    super.onNewIntent(intent);
    setIntent(intent);
    handleLaunchExtras(intent);
  }

  private void handleLaunchExtras(Intent intent) {
    if (intent == null) return;
    // 桌面小组件点击跳转：PendingIntent 带 erp_tab / erp_fresh extra，
    // WebView 加载后触发 window 事件，JS 侧监听并切换 Tab（可选拷新建弹窗）。
    if (intent.hasExtra("erp_tab")) {
      final String tab = intent.getStringExtra("erp_tab");
      final boolean fresh = intent.getBooleanExtra("erp_fresh", false);
      final String freshDate = intent.getStringExtra("erp_fresh_date");
      postJSEvent("erpLaunchTab", "{\"tab\":\"" + tab + "\",\"fresh\":" + fresh
          + (freshDate != null ? ",\"date\":\"" + freshDate + "\"" : "") + "}");
    }
    // 番茄钟控制栏按钮：暂停/继续/结束 → JS window 事件 timerControl
    if (intent.hasExtra("timer_action")) {
      final String act = intent.getStringExtra("timer_action");
      postJSEvent("timerControl", "{\"action\":\"" + act + "\"}");
    }
    // 闹钟全屏通知点击回 App：停铃 + 通知前端（JS 侧 alarmAction → alarmOpened）
    if (intent.hasExtra("alarm_action")) {
      final String act = intent.getStringExtra("alarm_action");
      final int aid = intent.getIntExtra("alarm_id", 0);
      postJSEvent("alarmAction", "{\"action\":\"" + act + "\",\"id\":" + aid + "}");
    }
  }

  private void postJSEvent(String name, String json) {
    if (getBridge() == null) return;
    getBridge().getWebView().postDelayed(() -> {
      try {
        getBridge().triggerWindowJSEvent(name, json);
      } catch (Exception ignored) {}
    }, 800);
  }
}
