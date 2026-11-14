package com.personal.erp.launch;

import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * 系统跳转桥：把「复制好的文本 + 打开别的 App」交给系统来做。
 *  · openAi()：按常见 AI 助手包名找一个已安装的直接拉起（文本由 JS 先写剪贴板）
 *  · open({package|url})：通用跳转（指定包名或 URL）
 * 找不到目标时返回 ok=false，由 JS 回退到系统分享面板。
 */
@CapacitorPlugin(name = "AppLaunch")
public class AppLaunchPlugin extends Plugin {

  // 常见 AI 助手包名，按优先级排列；与 AndroidManifest 的 <queries> 保持一致，
  // 否则 Android 11+ 的包可见性限制会让 getLaunchIntentForPackage 一律返回 null。
  private static final String[] AI_PACKAGES = {
      "com.larus.nova",               // 豆包
      "com.deepseek.chat",            // DeepSeek
      "com.openai.chatgpt",           // ChatGPT
      "com.moonshot.kimichat",        // Kimi
      "com.baidu.newapp",             // 文心一言
      "com.aliyun.tea",               // 通义
      "com.google.android.apps.bard", // Gemini
      "com.microsoft.copilot",        // Copilot
  };

  @PluginMethod
  public void openAi(PluginCall call) {
    JSObject ret = new JSObject();
    try {
      PackageManager pm = getContext().getPackageManager();
      for (String pkg : AI_PACKAGES) {
        Intent i = pm.getLaunchIntentForPackage(pkg);
        if (i == null) continue;
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(i);
        ret.put("ok", true);
        ret.put("package", pkg);
        call.resolve(ret);
        return;
      }
      ret.put("ok", false);
      ret.put("error", "no-ai-app");
      call.resolve(ret);
    } catch (Exception e) {
      call.reject(String.valueOf(e.getMessage()));
    }
  }

  @PluginMethod
  public void open(PluginCall call) {
    try {
      String pkg = call.getString("package");
      String url = call.getString("url");
      Intent i = null;
      if (pkg != null && !pkg.isEmpty()) {
        i = getContext().getPackageManager().getLaunchIntentForPackage(pkg);
      } else if (url != null && !url.isEmpty()) {
        i = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
      }
      JSObject ret = new JSObject();
      if (i == null) {
        ret.put("ok", false);
        call.resolve(ret);
        return;
      }
      i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
      getContext().startActivity(i);
      ret.put("ok", true);
      call.resolve(ret);
    } catch (Exception e) {
      call.reject(String.valueOf(e.getMessage()));
    }
  }
}
