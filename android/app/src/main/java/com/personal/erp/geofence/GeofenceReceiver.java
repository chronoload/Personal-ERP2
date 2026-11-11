package com.personal.erp.geofence;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

import com.google.android.gms.location.Geofence;
import com.google.android.gms.location.GeofencingEvent;

import java.util.List;

/**
 * 地理围栏事件接收器（manifest 注册，App 被杀也能收到）。
 * 只负责把「哪个地点的进/出」按时间顺序写入 GeofenceStore 队列，
 * 真正的 currentPlaceId 对账由 JS 回前台 drain() 时完成（避免后台写库冲突）。
 */
public class GeofenceReceiver extends BroadcastReceiver {
  @Override
  public void onReceive(Context context, Intent intent) {
    GeofencingEvent ev = GeofencingEvent.fromIntent(intent);
    if (ev == null || ev.hasError()) return;

    int type = ev.getGeofenceTransition();
    String kind = type == Geofence.GEOFENCE_TRANSITION_ENTER ? "enter"
        : type == Geofence.GEOFENCE_TRANSITION_EXIT ? "exit" : null;
    if (kind == null) return;

    List<Geofence> hit = ev.getTriggeringGeofences();
    if (hit == null) return;

    long at = System.currentTimeMillis();
    for (Geofence g : hit) {
      String req = g.getRequestId();
      if (req == null) continue;
      int idx = req.indexOf(':');
      if (idx <= 0) continue;
      // 只接受同类型围栏（内圈 enter / 外圈 exit），防止迟滞圈互相触发
      if (!req.substring(0, idx).equals(kind)) continue;
      GeofenceStore.push(context, req.substring(idx + 1), kind, at);
    }

    GeofencePlugin.emit();
  }
}
