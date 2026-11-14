package com.personal.erp.launch;

import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.net.Uri;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;
import org.json.JSONObject;

import java.text.Collator;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;

/**
 * 系统跳转桥：
 *  · listApps()：列出设备上所有「可从桌面启动」的应用（设置页挑选跳转目标）
 *  · open({package|url})：用系统 Intent 启动指定应用或打开 URL
 * 依赖 Manifest 里 <queries> 的 MAIN/LAUNCHER 声明，否则 Android 11+ 只能看到本应用。
 */
@CapacitorPlugin(name = "AppLaunch")
public class AppLaunchPlugin extends Plugin {

  @PluginMethod
  public void listApps(PluginCall call) {
    try {
      PackageManager pm = getContext().getPackageManager();
      Intent main = new Intent(Intent.ACTION_MAIN);
      main.addCategory(Intent.CATEGORY_LAUNCHER);
      List<ResolveInfo> resolved = pm.queryIntentActivities(main, 0);

      String self = getContext().getPackageName();
      HashSet<String> seen = new HashSet<>();
      List<JSONObject> items = new ArrayList<>();
      for (ResolveInfo ri : resolved) {
        if (ri == null || ri.activityInfo == null) continue;
        String pkg = ri.activityInfo.packageName;
        if (pkg == null || pkg.equals(self) || !seen.add(pkg)) continue;
        JSONObject o = new JSONObject();
        o.put("package", pkg);
        o.put("label", String.valueOf(ri.loadLabel(pm)));
        items.add(o);
      }
      final Collator collator = Collator.getInstance(Locale.CHINA);
      items.sort((a, b) -> collator.compare(a.optString("label"), b.optString("label")));

      JSONArray arr = new JSONArray();
      for (JSONObject o : items) arr.put(o);
      JSObject ret = new JSObject();
      ret.put("apps", arr);
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
        ret.put("error", "not-launchable");
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
