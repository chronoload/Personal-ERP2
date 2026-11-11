package com.personal.erp.geofence;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * 围栏事件的小型持久队列（SharedPreferences + JSONArray，最多 20 条）。
 * 系统在后台/Doze 唤醒时写入，JS 回到前台 drain 后清空；
 * 即使进程被杀，事件也不会丢。
 */
final class GeofenceStore {
  private static final String PREF = "geofence_state";
  private static final String KEY_EVENTS = "events";
  private static final String KEY_REGISTERED = "registered";
  private static final int MAX_EVENTS = 20;

  private GeofenceStore() {}

  private static SharedPreferences sp(Context c) {
    return c.getSharedPreferences(PREF, Context.MODE_PRIVATE);
  }

  static synchronized void push(Context c, String placeId, String event, long at) {
    try {
      JSONArray arr = read(c);
      JSONObject o = new JSONObject();
      o.put("placeId", placeId);
      o.put("event", event);
      o.put("at", at);
      arr.put(o);
      while (arr.length() > MAX_EVENTS) arr.remove(0);
      sp(c).edit().putString(KEY_EVENTS, arr.toString()).apply();
    } catch (Exception ignored) {}
  }

  static synchronized JSONArray read(Context c) {
    try {
      return new JSONArray(sp(c).getString(KEY_EVENTS, "[]"));
    } catch (Exception e) {
      return new JSONArray();
    }
  }

  static synchronized void clear(Context c) {
    sp(c).edit().putString(KEY_EVENTS, "[]").apply();
  }

  static void setRegistered(Context c, boolean v) {
    sp(c).edit().putBoolean(KEY_REGISTERED, v).apply();
  }

  static boolean isRegistered(Context c) {
    return sp(c).getBoolean(KEY_REGISTERED, false);
  }
}
