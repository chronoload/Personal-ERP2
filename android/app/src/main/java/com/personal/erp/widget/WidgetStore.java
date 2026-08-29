package com.personal.erp.widget;

import android.content.Context;
import android.content.SharedPreferences;
import org.json.JSONArray;
import org.json.JSONObject;

public class WidgetStore {

  static boolean isEnabled(Context ctx) {
    try {
      SharedPreferences sp = ctx.getSharedPreferences(WidgetKeys.PREFS_FILE, Context.MODE_PRIVATE);
      String raw = sp.getString(WidgetKeys.KEY_PREFS, null);
      if (raw == null) return false;
      JSONObject o = new JSONObject(raw);
      return o.optBoolean("widgetEnabled", false);
    } catch (Exception e) { return false; }
  }

  static JSONObject readSnapshot(Context ctx) {
    try {
      SharedPreferences sp = ctx.getSharedPreferences(WidgetKeys.PREFS_FILE, Context.MODE_PRIVATE);
      String raw = sp.getString(WidgetKeys.KEY_SNAP, null);
      if (raw != null) return new JSONObject(raw);
    } catch (Exception ignored) {}
    return null;
  }

  static JSONObject readDB(Context ctx) {
    try {
      SharedPreferences sp = ctx.getSharedPreferences(WidgetKeys.PREFS_FILE, Context.MODE_PRIVATE);
      String raw = sp.getString(WidgetKeys.KEY_DB, null);
      if (raw != null) return new JSONObject(raw);
    } catch (Exception ignored) {}
    return null;
  }

  /** 小组件配置（配置页保存）：{ dark: bool }，缺省浅色 */
  static JSONObject readConfig(Context ctx) {
    try {
      SharedPreferences sp = ctx.getSharedPreferences(WidgetKeys.PREFS_FILE, Context.MODE_PRIVATE);
      String raw = sp.getString(WidgetKeys.KEY_CONFIG, null);
      if (raw != null) return new JSONObject(raw);
    } catch (Exception ignored) {}
    return new JSONObject();
  }

  static boolean isDarkTheme(Context ctx) {
    return readConfig(ctx).optBoolean("dark", false);
  }

  /** 原生写回 db（小组件独立操作的持久层）：每次写自动递增修订号，供 JS 侧检测并回读 */
  static void writeDB(Context ctx, JSONObject db) {
    try {
      SharedPreferences sp = ctx.getSharedPreferences(WidgetKeys.PREFS_FILE, Context.MODE_PRIVATE);
      long rev = sp.getLong(WidgetKeys.KEY_REV, 0) + 1;
      sp.edit()
          .putString(WidgetKeys.KEY_DB, db.toString())
          .putLong(WidgetKeys.KEY_REV, rev)
          .apply();
    } catch (Exception ignored) {}
  }

  /** 原生数据修订号（桌面每次独立操作 +1） */
  static long readRev(Context ctx) {
    try {
      SharedPreferences sp = ctx.getSharedPreferences(WidgetKeys.PREFS_FILE, Context.MODE_PRIVATE);
      return sp.getLong(WidgetKeys.KEY_REV, 0);
    } catch (Exception e) { return 0; }
  }

  static JSONArray getActivitiesForToday(JSONObject db) {
    JSONArray out = new JSONArray();
    if (db == null) return out;
    try {
      java.util.Calendar c = java.util.Calendar.getInstance();
      String todayKey = c.get(java.util.Calendar.YEAR) + "-" + (c.get(java.util.Calendar.MONTH) + 1) + "-" + c.get(java.util.Calendar.DAY_OF_MONTH);
      JSONArray acts = db.optJSONArray("activities");
      if (acts == null) return out;
      for (int i = 0; i < acts.length(); i++) {
        JSONObject a = acts.optJSONObject(i);
        if (a == null) continue;
        String pd = a.optString("planned_date", null);
        long actual = a.optLong("actual_start", 0);
        boolean isToday = false;
        if (actual > 0) {
          java.util.Calendar ac = java.util.Calendar.getInstance();
          ac.setTimeInMillis(actual);
          isToday = ac.get(java.util.Calendar.YEAR) == c.get(java.util.Calendar.YEAR)
              && ac.get(java.util.Calendar.MONTH) == c.get(java.util.Calendar.MONTH)
              && ac.get(java.util.Calendar.DAY_OF_MONTH) == c.get(java.util.Calendar.DAY_OF_MONTH);
        } else if (pd != null && !pd.equals("null") && !pd.isEmpty()) {
          isToday = todayKey.equals(pd) || normalizeDate(pd).equals(todayKey);
        }
        if (isToday) out.put(a);
      }
      out = sortByPlannedStart(out);
    } catch (Exception ignored) {}
    return out;
  }

  private static JSONArray sortByPlannedStart(JSONArray arr) {
    java.util.List<JSONObject> list = new java.util.ArrayList<>();
    for (int i = 0; i < arr.length(); i++) list.add(arr.optJSONObject(i));
    java.util.Collections.sort(list, (a, b) -> {
      String sa = a.optString("planned_start", "");
      String sb = b.optString("planned_start", "");
      if (sa.isEmpty() && sb.isEmpty()) return 0;
      if (sa.isEmpty()) return 1;
      if (sb.isEmpty()) return -1;
      return sa.compareTo(sb);
    });
    JSONArray r = new JSONArray();
    for (JSONObject o : list) r.put(o);
    return r;
  }

  static String normalizeDate(String s) {
    try {
      String[] p = s.split("-");
      return Integer.parseInt(p[0]) + "-" + Integer.parseInt(p[1]) + "-" + Integer.parseInt(p[2]);
    } catch (Exception e) { return s; }
  }

  static String fmtTodayLabel() {
    java.util.Calendar c = java.util.Calendar.getInstance();
    return (c.get(java.util.Calendar.MONTH) + 1) + "月" + c.get(java.util.Calendar.DAY_OF_MONTH) + "日";
  }

  /** 活动已计时长（分钟）：汇总 time_logs，运行中按当前时间计 */
  static int trackedMinutes(JSONObject a) {
    if (a == null) return 0;
    JSONArray logs = a.optJSONArray("time_logs");
    if (logs == null) return 0;
    long now = System.currentTimeMillis();
    int total = 0;
    for (int i = 0; i < logs.length(); i++) {
      JSONObject l = logs.optJSONObject(i);
      if (l == null) continue;
      long start = l.optLong("start", 0);
      long end = l.optLong("end", now);
      if (end > start) total += Math.round((end - start) / 60000.0);
    }
    return total;
  }
}
