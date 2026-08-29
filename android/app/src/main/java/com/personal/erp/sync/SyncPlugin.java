package com.personal.erp.sync;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * 局域网同步服务插件：安卓 App 内一键启动/停止 HTTP 同步服务（手机当服务器）。
 * JS 侧：Capacitor.registerPlugin('Sync') → start({port}) / stop() / status()
 */
@CapacitorPlugin(name = "Sync")
public class SyncPlugin extends Plugin {
  private static final int DEFAULT_PORT = 6920;
  private MiniHttpServer server;

  @PluginMethod
  public void start(PluginCall call) {
    try {
      Integer p = call.getInt("port");
      int port = p != null ? p : DEFAULT_PORT;
      if (server != null && server.isRunning()) {
        call.resolve(statusObj(port));
        return;
      }
      server = new MiniHttpServer(getContext(), port);
      server.start();
      call.resolve(statusObj(port));
    } catch (Exception e) {
      call.reject(e.getMessage() == null ? "start failed" : e.getMessage());
    }
  }

  @PluginMethod
  public void stop(PluginCall call) {
    if (server != null) server.stop();
    JSObject ret = new JSObject();
    ret.put("running", false);
    ret.put("port", DEFAULT_PORT);
    ret.put("ip", MiniHttpServer.localIp());
    call.resolve(ret);
  }

  @PluginMethod
  public void status(PluginCall call) {
    call.resolve(statusObj(DEFAULT_PORT));
  }

  /** 插件自检：JS 侧确认 Capacitor 桥真的连上了原生 Sync 插件（排查「not implemented in Android」） */
  @PluginMethod
  public void ping(PluginCall call) {
    JSObject ret = new JSObject();
    ret.put("ok", true);
    ret.put("name", "Sync");
    call.resolve(ret);
  }

  private JSObject statusObj(int port) {
    JSObject ret = new JSObject();
    ret.put("running", server != null && server.isRunning());
    ret.put("port", port);
    ret.put("ip", MiniHttpServer.localIp());
    return ret;
  }
}