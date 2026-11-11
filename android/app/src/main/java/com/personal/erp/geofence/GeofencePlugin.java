package com.personal.erp.geofence;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Logger;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import com.google.android.gms.common.ConnectionResult;
import com.google.android.gms.common.GoogleApiAvailability;
import com.google.android.gms.location.Geofence;
import com.google.android.gms.location.GeofencingClient;
import com.google.android.gms.location.GeofencingRequest;
import com.google.android.gms.location.LocationServices;

import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

/**
 * 原生地理围栏桥（Capacitor "Geofence"）。
 *
 * start({places})     为每个地点注册「内圈进入 + 外圈退出」两条围栏（迟滞防抖），
 *                     事件由 GeofenceReceiver 落 GeofenceStore 队列（App 不在前台也不丢）。
 * stop()              注销全部围栏。
 * drain()             取走事件队列（JS 回前台按序对账 currentPlaceId）。
 * status()            权限 + 注册状态。
 * locate()            一次性定位（FusedLocation），用于手动对账/Web 兜底。
 * openSettings()      Android 11+ 后台定位只能去系统设置授权。
 *
 * 注意：Android 12+ 围栏 PendingIntent 由系统填充 extras，必须 FLAG_MUTABLE。
 */
@CapacitorPlugin(
    name = "Geofence",
    permissions = {
        @Permission(alias = "location", strings = {
            android.Manifest.permission.ACCESS_FINE_LOCATION,
            android.Manifest.permission.ACCESS_COARSE_LOCATION,
        }),
        @Permission(alias = "background", strings = {
            android.Manifest.permission.ACCESS_BACKGROUND_LOCATION,
        }),
    }
)
public class GeofencePlugin extends Plugin {
  private static GeofencePlugin INSTANCE;
  static final String ACTION = "com.personal.erp.geofence.EVENT";

  @Override
  public void load() {
    INSTANCE = this;
  }

  @Override
  protected void handleOnDestroy() {
    if (INSTANCE == this) INSTANCE = null;
  }

  private GeofencingClient client() {
    return LocationServices.getGeofencingClient(getContext());
  }

  private PendingIntent pending() {
    Intent i = new Intent(getContext(), GeofenceReceiver.class);
    i.setAction(ACTION);
    int flags = PendingIntent.FLAG_UPDATE_CURRENT;
    if (Build.VERSION.SDK_INT >= 31) flags |= PendingIntent.FLAG_MUTABLE;
    else if (Build.VERSION.SDK_INT >= 23) flags |= PendingIntent.FLAG_IMMUTABLE;
    return PendingIntent.getBroadcast(getContext(), 0, i, flags);
  }

  @PluginMethod
  public void start(PluginCall call) {
    if (getPermissionState("location") != PermissionState.GRANTED) {
      requestPermissionForAlias("location", call, "locationPerms");
      settleGuard(call, 20000, "围栏注册无响应（权限回调未接入）");
      return;
    }
    register(call);
  }

  @PermissionCallback
  private void locationPerms(PluginCall call) {
    if (getPermissionState("location") == PermissionState.GRANTED) register(call);
    else rejectOnce(call, "定位权限被拒绝");
  }

  private void resolveOnce(PluginCall call, JSObject ret) {
    if (claim(call.getCallbackId())) call.resolve(ret);
  }

  private void rejectOnce(PluginCall call, String msg) {
    if (claim(call.getCallbackId())) call.reject(msg);
  }

  private boolean hasGms() {
    try {
      int r = GoogleApiAvailability.getInstance().isGooglePlayServicesAvailable(getContext());
      return r == ConnectionResult.SUCCESS;
    } catch (Throwable t) {
      return false;
    }
  }

  private void register(PluginCall call) {
    // 围栏注册依赖 Play Services；缺失时 Task 可能永不回调，必须自己兜底 settle
    settleGuard(call, 15000, "围栏注册无响应（缺少 Google Play 服务？）");
    if (!hasGms()) {
      GeofenceStore.setRegistered(getContext(), false);
      rejectOnce(call, "设备缺少 Google Play 服务，地理围栏不可用");
      return;
    }
    try {
      JSArray arr = call.getArray("places");
      List<Geofence> fences = new ArrayList<>();
      if (arr != null) {
        for (int i = 0; i < arr.length() && fences.size() < 80; i++) {
          JSONObject o = arr.optJSONObject(i);
          if (o == null) continue;
          String id = o.optString("id", "");
          double lat = o.optDouble("lat", Double.NaN);
          double lng = o.optDouble("lng", Double.NaN);
          double radius = o.optDouble("radius", 120);
          if (id.isEmpty() || Double.isNaN(lat) || Double.isNaN(lng)) continue;
          float r = (float) Math.max(30, Math.min(5000, radius));
          fences.add(build("enter:" + id, lat, lng, r, Geofence.GEOFENCE_TRANSITION_ENTER));
          // 外圈退出半径：r + max(30m, 20%)，形成进/出迟滞，抑制 GPS 抖动
          float rOut = r + Math.max(30f, r * 0.2f);
          fences.add(build("exit:" + id, lat, lng, rOut, Geofence.GEOFENCE_TRANSITION_EXIT));
        }
      }

      if (fences.isEmpty()) {
        // 先清掉旧围栏，再报告 0 条
        client().removeGeofences(pending()).addOnCompleteListener(t -> {
          GeofenceStore.setRegistered(getContext(), false);
          JSObject empty = new JSObject();
          empty.put("count", 0);
          resolveOnce(call, empty);
        });
        return;
      }

      final GeofencingRequest req = new GeofencingRequest.Builder()
          .setInitialTrigger(GeofencingRequest.INITIAL_TRIGGER_ENTER)
          .addGeofences(fences)
          .build();
      final int count = fences.size();

      // 必须先等 remove 完成再加：并发执行时 add 可能被随后的 remove 一并清掉，
      // 表现为「注册成功但围栏从不触发」。
      client().removeGeofences(pending()).addOnCompleteListener(t -> {
        try {
          client().addGeofences(req, pending())
              .addOnSuccessListener(v -> {
                GeofenceStore.setRegistered(getContext(), true);
                JSObject ret = new JSObject();
                ret.put("count", count);
                resolveOnce(call, ret);
              })
              .addOnFailureListener(e -> {
                GeofenceStore.setRegistered(getContext(), false);
                rejectOnce(call, e.getMessage() == null ? "围栏注册失败" : e.getMessage());
              });
        } catch (Exception e) {
          rejectOnce(call, "围栏注册失败：" + (e.getMessage() == null ? "未知原因" : e.getMessage()));
        }
      });
    } catch (Exception e) {
      rejectOnce(call, e.getMessage() == null ? "start failed" : e.getMessage());
    }
  }

  private Geofence build(String id, double lat, double lng, float radius, int type) {
    return new Geofence.Builder()
        .setRequestId(id)
        .setCircularRegion(lat, lng, radius)
        .setExpirationDuration(Geofence.NEVER_EXPIRE)
        .setTransitionTypes(type)
        .build();
  }

  @PluginMethod
  public void stop(PluginCall call) {
    try {
      client().removeGeofences(pending());
    } catch (Exception ignored) {}
    GeofenceStore.setRegistered(getContext(), false);
    call.resolve();
  }

  @PluginMethod
  public void drain(PluginCall call) {
    JSObject ret = new JSObject();
    try {
      ret.put("events", GeofenceStore.read(getContext()));
      GeofenceStore.clear(getContext());
    } catch (Exception e) {
      ret.put("events", new JSArray());
    }
    call.resolve(ret);
  }

  @PluginMethod
  public void status(PluginCall call) {
    JSObject ret = new JSObject();
    PermissionState loc = getPermissionState("location");
    PermissionState bg = getPermissionState("background");
    ret.put("location", loc == null ? "prompt" : loc.toString());
    ret.put("background", bg == null ? "prompt" : bg.toString());
    ret.put("registered", GeofenceStore.isRegistered(getContext()));
    ret.put("gms", hasGms());
    resolveOnce(call, ret);
  }

  @PluginMethod
  public void locate(PluginCall call) {
    if (getPermissionState("location") != PermissionState.GRANTED) {
      requestPermissionForAlias("location", call, "locatePerms");
      // 兜底：注解/launcher 若未生效，requestPermissionForAlias 会既不请求也不回调，
      // 调用会永远悬挂（前端表现就是「一直定位中」）。这里挂一个看门狗，保证必定 settle。
      settleGuard(call, 20000, "定位请求无响应（权限回调未接入）");
      return;
    }
    doLocate(call);
  }

  @PermissionCallback
  private void locatePerms(PluginCall call) {
    if (getPermissionState("location") == PermissionState.GRANTED) doLocate(call);
    else call.reject("定位权限被拒绝");
  }

  // 对同一个 call 只允许 settle 一次，避免 PluginCall 被重复 resolve/reject 抛异常
  private final java.util.Set<String> settledCalls = java.util.Collections.synchronizedSet(new java.util.HashSet<>());

  private boolean claim(String callId) {
    return callId != null && settledCalls.add(callId);
  }

  private void settleGuard(final PluginCall call, long ms, final String msg) {
    final String id = call.getCallbackId();
    new Handler(Looper.getMainLooper()).postDelayed(() -> {
      if (claim(id)) {
        Logger.error("Geofence: " + msg);
        call.reject(msg);
      }
    }, ms);
  }

  @SuppressLint("MissingPermission")
  private void doLocate(PluginCall call) {
    new LocateSession(call).start();
  }

  /**
   * 一次性定位会话。
   *
   * 不用 FusedLocation：设备缺 Google Play Services 时它的 Task 可能永不完成，
   * 表现为前端一直「定位中」。这里直接走系统 LocationManager，
   * 并保证三条出口（命中 / 超时 / 无可用提供商）都必定 settle。
   */
  private final class LocateSession {
    private static final long TIMEOUT_MS = 12000;
    private static final long FRESH_MS = 10 * 60 * 1000;

    private final PluginCall call;
    private final String callId;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final LocationManager lm;
    private final LocationListener listener;

    LocateSession(PluginCall call) {
      this.call = call;
      this.callId = call.getCallbackId();
      this.lm = (LocationManager) getContext().getSystemService(Context.LOCATION_SERVICE);
      this.listener = new LocationListener() {
        @Override
        public void onLocationChanged(Location location) {
          deliver(location);
        }

        @Override
        public void onStatusChanged(String provider, int status, Bundle extras) {}

        @Override
        public void onProviderEnabled(String provider) {}

        @Override
        public void onProviderDisabled(String provider) {}
      };
    }

    void start() {
      if (lm == null) {
        fail("此设备不支持定位");
        return;
      }
      // 系统定位总开关关闭时，所有 provider 都会不可用：直接给出可操作的原因
      boolean anyEnabled = false;
      try {
        anyEnabled = lm.isProviderEnabled(LocationManager.GPS_PROVIDER)
            || lm.isProviderEnabled(LocationManager.NETWORK_PROVIDER);
      } catch (Exception ignored) {}
      if (!anyEnabled) {
        fail("系统定位服务已关闭，请在设置中打开");
        return;
      }

      // 先用足够新的缓存，室内等首帧不至于卡满超时
      Location cached = bestLastKnown();
      if (cached != null && System.currentTimeMillis() - cached.getTime() <= FRESH_MS) {
        deliver(cached);
        return;
      }

      handler.postDelayed(() -> {
        Location last = bestLastKnown();
        if (last != null) deliver(last);
        else fail("定位超时，无法获取当前位置");
      }, TIMEOUT_MS);

      try {
        if (lm.isProviderEnabled(LocationManager.GPS_PROVIDER)) {
          lm.requestLocationUpdates(LocationManager.GPS_PROVIDER, 0L, 0f, listener, Looper.getMainLooper());
        }
        if (lm.isProviderEnabled(LocationManager.NETWORK_PROVIDER)) {
          lm.requestLocationUpdates(LocationManager.NETWORK_PROVIDER, 0L, 0f, listener, Looper.getMainLooper());
        }
      } catch (Exception e) {
        fail("定位请求失败：" + (e.getMessage() == null ? "未知原因" : e.getMessage()));
      }
    }

    private Location bestLastKnown() {
      Location best = null;
      String[] providers = {
          LocationManager.GPS_PROVIDER,
          LocationManager.NETWORK_PROVIDER,
          LocationManager.PASSIVE_PROVIDER,
      };
      for (String p : providers) {
        try {
          Location l = lm.getLastKnownLocation(p);
          if (l == null) continue;
          if (best == null || l.getTime() > best.getTime()) best = l;
        } catch (Exception ignored) {}
      }
      return best;
    }

    private void cleanup() {
      try { lm.removeUpdates(listener); } catch (Exception ignored) {}
      handler.removeCallbacksAndMessages(null);
    }

    private void deliver(Location loc) {
      if (!claim(callId)) return;
      cleanup();
      JSObject ret = new JSObject();
      ret.put("lat", loc.getLatitude());
      ret.put("lng", loc.getLongitude());
      if (loc.hasAccuracy()) ret.put("accuracy", loc.getAccuracy());
      if (loc.getProvider() != null) ret.put("provider", loc.getProvider());
      ret.put("ageMs", Math.max(0, System.currentTimeMillis() - loc.getTime()));
      call.resolve(ret);
    }

    private void fail(String msg) {
      if (!claim(callId)) return;
      cleanup();
      call.reject(msg);
    }
  }

  @PluginMethod
  public void openSettings(PluginCall call) {
    try {
      Intent i = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
      i.setData(Uri.parse("package:" + getContext().getPackageName()));
      i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
      getContext().startActivity(i);
      call.resolve();
    } catch (Exception e) {
      call.reject("open settings failed");
    }
  }

  /** 供 Receiver 在 App 存活时通知 JS 去 drain；App 不在前台则只留在队列里。 */
  static void emit() {
    GeofencePlugin inst = INSTANCE;
    if (inst == null) return;
    try {
      Activity act = inst.getActivity();
      if (act == null) return;
      act.runOnUiThread(() -> {
        try {
          if (inst.getBridge() != null) inst.getBridge().triggerWindowJSEvent("geofenceEvent", "{}");
        } catch (Exception ignored) {}
      });
    } catch (Exception ignored) {}
  }
}
