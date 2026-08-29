package com.personal.erp;

import android.content.Intent;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;
import com.personal.erp.widget.WidgetPlugin;
import com.personal.erp.sync.SyncPlugin;
import com.personal.erp.timer.TimerPlugin;

public class MainActivity extends BridgeActivity {
  // ★ Capacitor 8 关键：桥在 BridgeActivity.onCreate 内同步构建（super.onCreate → this.load() → bridgeBuilder.create()）。
  //   自定义插件必须在本类的 load() 里、super.load()（真正创建桥）之前注册；
  //   否则 registerPlugin 只加入 builder 而桥早已创建 → 插件永不生效（「X is not implemented in Android」根因）。
  @Override
  protected void load() {
    registerPlugin(WidgetPlugin.class); // 桌面小组件桥（setTimerState/getTimerState/pushData/getData）
    registerPlugin(SyncPlugin.class);   // 局域网同步服务（start/stop/status/ping）
    registerPlugin(TimerPlugin.class);  // 番茄钟控制栏 + 铃声（showControls/ring）
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
      postJSEvent("erpLaunchTab", "{\"tab\":\"" + tab + "\",\"fresh\":" + fresh + "}");
    }
    // 番茄钟控制栏按钮：暂停/继续/结束 → JS window 事件 timerControl
    if (intent.hasExtra("timer_action")) {
      final String act = intent.getStringExtra("timer_action");
      postJSEvent("timerControl", "{\"action\":\"" + act + "\"}");
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
