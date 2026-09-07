package com.personal.erp.alarm;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * 闹钟持久化（SharedPreferences）：被杀 / 重启 / WebView 存储清理后仍可恢复。
 * JS 侧 sync 会重新调度，BootReceiver 也从此处回捞，双保险。
 */
public class AlarmStore {
  static final String PREFS = "erp_alarms";
  static final String KEY = "alarms";

  static JSONArray readAll(Context ctx) {
    try {
      SharedPreferences sp = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
      String raw = sp.getString(KEY, null);
      if (raw != null) return new JSONArray(raw);
    } catch (Exception ignored) {}
    return new JSONArray();
  }

  /** 写入（同 id 覆盖）；at 为 epoch ms */
  static void save(Context ctx, int id, String title, String body, long at) {
    try {
      JSONArray arr = readAll(ctx);
      JSONArray out = new JSONArray();
      for (int i = 0; i < arr.length(); i++) {
        JSONObject o = arr.optJSONObject(i);
        if (o != null && o.optInt("id", -1) != id) out.put(o);
      }
      JSONObject o = new JSONObject();
      o.put("id", id);
      o.put("title", title == null ? "" : title);
      o.put("body", body == null ? "" : body);
      o.put("at", at);
      out.put(o);
      ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(KEY, out.toString()).apply();
    } catch (Exception ignored) {}
  }

  static void remove(Context ctx, int id) {
    try {
      JSONArray arr = readAll(ctx);
      JSONArray out = new JSONArray();
      for (int i = 0; i < arr.length(); i++) {
        JSONObject o = arr.optJSONObject(i);
        if (o != null && o.optInt("id", -1) != id) out.put(o);
      }
      ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(KEY, out.toString()).apply();
    } catch (Exception ignored) {}
  }

  static void clear(Context ctx) {
    try {
      ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().remove(KEY).apply();
    } catch (Exception ignored) {}
  }
}
