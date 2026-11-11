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

  public static JSONObject readDB(Context ctx) {
    try {
      SharedPreferences sp = ctx.getSharedPreferences(WidgetKeys.PREFS_FILE, Context.MODE_PRIVATE);
      String raw = sp.getString(WidgetKeys.KEY_DB, null);
      if (raw != null) return new JSONObject(raw);
    } catch (Exception ignored) {}
    return null;
  }

  /** 原生独立操作产生的待回读流水（App 一回前台就取走并清空） */
  static JSONArray drainPending(Context ctx) {
    try {
      SharedPreferences sp = ctx.getSharedPreferences(WidgetKeys.PREFS_FILE, Context.MODE_PRIVATE);
      String raw = sp.getString(WidgetKeys.KEY_PENDING, null);
      sp.edit().remove(WidgetKeys.KEY_PENDING).apply();
      if (raw != null) return new JSONArray(raw);
    } catch (Exception ignored) {}
    return new JSONArray();
  }

  static void appendPending(Context ctx, org.json.JSONObject tx) {
    try {
      SharedPreferences sp = ctx.getSharedPreferences(WidgetKeys.PREFS_FILE, Context.MODE_PRIVATE);
      JSONArray arr;
      String raw = sp.getString(WidgetKeys.KEY_PENDING, null);
      arr = raw == null ? new JSONArray() : new JSONArray(raw);
      arr.put(tx);
      sp.edit().putString(WidgetKeys.KEY_PENDING, arr.toString()).apply();
    } catch (Exception ignored) {}
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

  /** 开屏首页 · 今日日程卡片的开关：缺省视为开启（已添加的小组件添加后即可用） */
  static boolean isHomeTodayEnabled(Context ctx) {
    try {
      SharedPreferences sp = ctx.getSharedPreferences(WidgetKeys.PREFS_FILE, Context.MODE_PRIVATE);
      String raw = sp.getString(WidgetKeys.KEY_PREFS, null);
      if (raw == null) return true;
      JSONObject o = new JSONObject(raw);
      return o.optBoolean("homeTodayWidget", true);
    } catch (Exception e) { return true; }
  }

  /** 锁屏 / 开屏页开关：缺省关闭（需用户在设置里主动打开） */
  public static boolean isLockEnabled(Context ctx) {
    return readPrefsFlag(ctx, "lockScreenToday", false);
  }

  /** 亮屏时是否整页盖在锁屏上（需系统授予「全屏通知」；没授予会自动降级为通知） */
  public static boolean isLockFull(Context ctx) {
    return readPrefsFlag(ctx, "lockScreenFull", true);
  }

  private static boolean readPrefsFlag(Context ctx, String key, boolean def) {
    try {
      SharedPreferences sp = ctx.getSharedPreferences(WidgetKeys.PREFS_FILE, Context.MODE_PRIVATE);
      String raw = sp.getString(WidgetKeys.KEY_PREFS, null);
      if (raw == null) return def;
      JSONObject o = new JSONObject(raw);
      return o.has(key) ? o.optBoolean(key, def) : def;
    } catch (Exception e) { return def; }
  }

  // ---------------- 倒计时组件：per-widget 配置 ----------------

  private static String cdKey(int widgetId) { return "widget_cd_" + widgetId; }

  /** 读取该倒计时实例的配置：{mode:'next'|'task'|'custom', activityId, title, target} */
  public static JSONObject readCountdownConfig(Context ctx, int widgetId) {
    try {
      SharedPreferences sp = ctx.getSharedPreferences(WidgetKeys.PREFS_FILE, Context.MODE_PRIVATE);
      String raw = sp.getString(cdKey(widgetId), null);
      return raw == null ? new JSONObject() : new JSONObject(raw);
    } catch (Exception e) { return new JSONObject(); }
  }

  public static void writeCountdownConfig(Context ctx, int widgetId, JSONObject cfg) {
    try {
      SharedPreferences sp = ctx.getSharedPreferences(WidgetKeys.PREFS_FILE, Context.MODE_PRIVATE);
      sp.edit().putString(cdKey(widgetId), cfg == null ? "{}" : cfg.toString()).apply();
    } catch (Exception ignored) {}
  }

  private static String timerKey(int widgetId) { return "widget_cd_timer_" + widgetId; }

  /** 停表运行态：{running:boolean, base:elapsedRealtime基准, elapsed:暂停时固化的毫秒} */
  public static JSONObject readTimerState(Context ctx, int widgetId) {
    try {
      SharedPreferences sp = ctx.getSharedPreferences(WidgetKeys.PREFS_FILE, Context.MODE_PRIVATE);
      String raw = sp.getString(timerKey(widgetId), null);
      return raw == null ? new JSONObject() : new JSONObject(raw);
    } catch (Exception e) { return new JSONObject(); }
  }

  public static void writeTimerState(Context ctx, int widgetId, JSONObject st) {
    try {
      SharedPreferences sp = ctx.getSharedPreferences(WidgetKeys.PREFS_FILE, Context.MODE_PRIVATE);
      sp.edit().putString(timerKey(widgetId), st == null ? "{}" : st.toString()).apply();
    } catch (Exception ignored) {}
  }

  /** 解析 "2026-11-10T09:00" / "2026-11-10 09:00" / "2026-11-10"（无钟点默认 09:00） */
  public static long parseDateTimeMs(String s) {
    try {
      String t = String.valueOf(s == null ? "" : s).trim().replace(' ', 'T');
      if (t.isEmpty() || t.equals("null")) return 0;
      String[] parts = t.split("T");
      String[] d = parts[0].split("-");
      int hh = 9, mm = 0;
      if (parts.length > 1) {
        String[] hm = parts[1].split(":");
        hh = Integer.parseInt(hm[0]);
        if (hm.length > 1) mm = Integer.parseInt(hm[1].replaceAll("[^0-9].*$", ""));
      }
      java.util.Calendar c = java.util.Calendar.getInstance();
      c.set(Integer.parseInt(d[0]), Integer.parseInt(d[1]) - 1, Integer.parseInt(d[2]), hh, mm, 0);
      c.set(java.util.Calendar.MILLISECOND, 0);
      return c.getTimeInMillis();
    } catch (Exception e) { return 0; }
  }

  /** 配置页可选的活动：未完成 + 已排期，按目标时间升序 */
  public static JSONArray openScheduledActivities(JSONObject db) {
    JSONArray out = new JSONArray();
    if (db == null) return out;
    try {
      JSONArray acts = db.optJSONArray("activities");
      if (acts == null) return out;
      java.util.List<JSONObject> list = new java.util.ArrayList<>();
      for (int i = 0; i < acts.length(); i++) {
        JSONObject a = acts.optJSONObject(i);
        if (!isOpenActivity(a)) continue;
        if (parseDateTimeMs(a.optString("planned_start", "")) <= 0) continue;
        list.add(a);
      }
      java.util.Collections.sort(list, (a, b) -> Long.compare(
          parseDateTimeMs(a.optString("planned_start", "")), parseDateTimeMs(b.optString("planned_start", ""))));
      for (JSONObject a : list) out.put(a);
    } catch (Exception ignored) {}
    return out;
  }

  /** 今日键（YYYY-M-D，不补零，与 App 日记/日历一致） */
  public static String todayKey() {
    java.util.Calendar c = java.util.Calendar.getInstance();
    return c.get(java.util.Calendar.YEAR) + "-" + (c.get(java.util.Calendar.MONTH) + 1) + "-" + c.get(java.util.Calendar.DAY_OF_MONTH);
  }

  public static JSONArray getActivitiesForToday(JSONObject db) {
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
        // 排期日期与「实际开始时刻」任一落在今天即算今日：
        // 只认 actual 会让「昨天开始、今天还在进行」的活动漏掉；只认 pd 又会漏掉顺延到今天的手动开始项。
        if (pd != null && !pd.equals("null") && !pd.isEmpty()) {
          isToday = todayKey.equals(pd) || normalizeDate(pd).equals(todayKey);
        }
        if (!isToday && actual > 0) {
          java.util.Calendar ac = java.util.Calendar.getInstance();
          ac.setTimeInMillis(actual);
          isToday = ac.get(java.util.Calendar.YEAR) == c.get(java.util.Calendar.YEAR)
              && ac.get(java.util.Calendar.MONTH) == c.get(java.util.Calendar.MONTH)
              && ac.get(java.util.Calendar.DAY_OF_MONTH) == c.get(java.util.Calendar.DAY_OF_MONTH);
        }
        // 循环活动：今天若有任一 pending 期次 → 纳入今日（对齐看板/日历，提前排期、跳过/完成后轮到今天都会出）
        if (!isToday && a.optString("repeat", "").length() > 0) {
          JSONArray occs = a.optJSONArray("occurrences");
          if (occs != null) {
            for (int oi = 0; oi < occs.length() && !isToday; oi++) {
              JSONObject occ = occs.optJSONObject(oi);
              if (occ == null) continue;
              String od = occ.optString("date", null);
              String ost = occ.optString("status", "pending");
              if (od != null && !od.isEmpty() && "pending".equals(ost)) {
                isToday = todayKey.equals(od) || normalizeDate(od).equals(todayKey);
              }
            }
          }
        }
        if (isToday) out.put(a);
      }
      out = sortByPlannedStart(out);
    } catch (Exception ignored) {}
    return out;
  }

  /** 活动是否「未完成」（完成/复盘/归档都算收尾） */
  public static boolean isOpenActivity(JSONObject a) {
    if (a == null) return false;
    String st = a.optString("status", "Planned");
    return !"Completed".equals(st) && !"Reviewed".equals(st) && !"Archived".equals(st) && !"Failed".equals(st);
  }

  private static String dateKeyOf(JSONObject a) {
    String ps = a.optString("planned_start", null);
    if (ps != null && !ps.isEmpty() && !ps.equals("null")) return normalizeDate(ps);
    String pd = a.optString("planned_date", null);
    if (pd != null && !pd.isEmpty() && !pd.equals("null")) return normalizeDate(pd);
    return null;
  }

  /** 日键 → 可比较整数（YYYYMMDD）。必须走数值：'2026-11-9' 与 '2026-11-10'
   *  的字符串序是反的（'9' > '1'），用 compareTo 会把昨天判成未来。 */
  private static int dayNum(String s) {
    try {
      String[] p = normalizeDate(s).split("-");
      return Integer.parseInt(p[0]) * 10000 + Integer.parseInt(p[1]) * 100 + Integer.parseInt(p[2]);
    } catch (Exception e) { return -1; }
  }

  /** 延留：有排期、早于今天、仍未完成 */
  public static JSONArray getOverdue(JSONObject db) {
    JSONArray out = new JSONArray();
    if (db == null) return out;
    try {
      int todayNum = dayNum(todayKey());
      JSONArray acts = db.optJSONArray("activities");
      if (acts == null) return out;
      for (int i = 0; i < acts.length(); i++) {
        JSONObject a = acts.optJSONObject(i);
        if (!isOpenActivity(a)) continue;
        String dk = dateKeyOf(a);
        if (dk == null) continue;
        int dn = dayNum(dk);
        if (dn > 0 && dn < todayNum) out.put(a);
      }
    } catch (Exception ignored) {}
    return sortByPlannedStart(out);
  }

  /** 未指派时间：既没有具体时段，也没排到某天 */
  public static JSONArray getUnscheduled(JSONObject db) {
    JSONArray out = new JSONArray();
    if (db == null) return out;
    try {
      JSONArray acts = db.optJSONArray("activities");
      if (acts == null) return out;
      for (int i = 0; i < acts.length(); i++) {
        JSONObject a = acts.optJSONObject(i);
        if (!isOpenActivity(a)) continue;
        if (dateKeyOf(a) == null) out.put(a);
      }
    } catch (Exception ignored) {}
    return out;
  }

  /**
   * 小组件用的「今日 + 补充」看板：
   *   · 进行中（Started）永远置顶且必收录——哪怕它的排期是昨天/更早（延期但仍在跑），
   *     因为「正在做的那件事」是最该被看到的信息；否则今天只要有一个待办，
   *     昨天开始的十几条进行中就会被整块吞掉。
   *   · 然后是今日（按时间）
   *   · 今日已无未完成（含今天没任务）→ 追加「延留 + 未指派」，把卡片补满
   * 每项为 {kind: running|today|overdue|unscheduled, act: {...}}，同一条活动只出现一次
   */
  public static JSONArray getBoard(JSONObject db) {
    JSONArray out = new JSONArray();
    if (db == null) return out;
    try {
      JSONArray today = getActivitiesForToday(db);
      JSONArray running = getRunningActivities(db);

      // 1) 进行中置顶（跳过已出现在今日列表里的，避免重复）
      for (int i = 0; i < running.length(); i++) {
        JSONObject a = running.optJSONObject(i);
        if (a == null || containsActivity(today, a.optString("id"))) continue;
        out.put(wrap("running", a));
      }

      // 2) 今日
      for (int i = 0; i < today.length(); i++) {
        JSONObject a = today.optJSONObject(i);
        if (a == null) continue;
        out.put(wrap(isStarted(a) ? "running" : "today", a));
      }

      // 3) 今日没有未完成 → 补延期 + 未指派
      boolean hasPending = false;
      for (int i = 0; i < today.length(); i++) {
        if (isOpenActivity(today.optJSONObject(i))) { hasPending = true; break; }
      }
      if (!hasPending) {
        JSONArray overdue = getOverdue(db);
        for (int i = 0; i < overdue.length(); i++) {
          JSONObject a = overdue.optJSONObject(i);
          if (a == null || boardHas(out, a.optString("id"))) continue;
          out.put(wrap("overdue", a));
        }
        JSONArray unscheduled = getUnscheduled(db);
        for (int i = 0; i < unscheduled.length(); i++) {
          JSONObject a = unscheduled.optJSONObject(i);
          if (a == null || boardHas(out, a.optString("id"))) continue;
          out.put(wrap("unscheduled", a));
        }
      }
    } catch (Exception ignored) {}
    return out;
  }

  /** 所有「进行中」的活动（不限日期），按实际开始时刻升序（最久的在最前） */
  public static JSONArray getRunningActivities(JSONObject db) {
    JSONArray out = new JSONArray();
    if (db == null) return out;
    try {
      JSONArray acts = db.optJSONArray("activities");
      if (acts == null) return out;
      java.util.List<JSONObject> list = new java.util.ArrayList<>();
      for (int i = 0; i < acts.length(); i++) {
        JSONObject a = acts.optJSONObject(i);
        if (a == null || !isStarted(a)) continue;
        list.add(a);
      }
      java.util.Collections.sort(list, (a, b) ->
          Long.compare(a.optLong("actual_start", 0), b.optLong("actual_start", 0)));
      for (JSONObject a : list) out.put(a);
    } catch (Exception ignored) {}
    return out;
  }

  /** 看板里进行中的条数（用于标题） */
  public static int boardRunningCount(JSONArray board) {
    int n = 0;
    for (int i = 0; i < board.length(); i++) {
      JSONObject it = board.optJSONObject(i);
      JSONObject a = it == null ? null : it.optJSONObject("act");
      if (a != null && isStarted(a)) n++;
    }
    return n;
  }

  /** 看板里「待办」（未完成且未开始）的条数 */
  public static int boardPendingCount(JSONArray board) {
    int n = 0;
    for (int i = 0; i < board.length(); i++) {
      JSONObject it = board.optJSONObject(i);
      JSONObject a = it == null ? null : it.optJSONObject("act");
      if (a == null || isStarted(a)) continue;
      if (isOpenActivity(a)) n++;
    }
    return n;
  }

  private static boolean isStarted(JSONObject a) {
    return a != null && "Started".equals(a.optString("status"));
  }

  private static boolean containsActivity(JSONArray arr, String id) {
    if (id == null || id.isEmpty()) return false;
    for (int i = 0; i < arr.length(); i++) {
      JSONObject a = arr.optJSONObject(i);
      if (a != null && id.equals(a.optString("id"))) return true;
    }
    return false;
  }

  private static boolean boardHas(JSONArray board, String id) {
    if (id == null || id.isEmpty()) return false;
    for (int i = 0; i < board.length(); i++) {
      JSONObject it = board.optJSONObject(i);
      JSONObject a = it == null ? null : it.optJSONObject("act");
      if (a != null && id.equals(a.optString("id"))) return true;
    }
    return false;
  }

  private static JSONObject wrap(String kind, JSONObject a) {
    JSONObject o = new JSONObject();
    try { o.put("kind", kind); o.put("act", a == null ? new JSONObject() : a); } catch (Exception ignored) {}
    return o;
  }

  /** 待排积压条数（延留 + 未指派），小组件标题用 */
  public static int backlogCount(JSONObject db) {
    return getOverdue(db).length() + getUnscheduled(db).length();
  }

  /** 小组件展示用的时间文本：有钟点给 HH:MM；只在某天（无钟点）给空 */
  public static String clockOf(JSONObject a) {
    String s = a == null ? "" : a.optString("planned_start", "");
    if (s == null || s.isEmpty() || s.equals("null")) return "";
    return s;
  }

  private static JSONArray sortByPlannedStart(JSONArray arr) {
    java.util.List<JSONObject> list = new java.util.ArrayList<>();
    for (int i = 0; i < arr.length(); i++) list.add(arr.optJSONObject(i));
    java.util.Collections.sort(list, (a, b) -> {
      String sa = clockOf(a);
      String sb = clockOf(b);
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
      // planned_start 形如 2026-11-10T09:00：先截掉时间部分，否则 parseInt("10T09:00") 抛错，
      // 会让整条活动被当成「日期无法识别」而在延留/待排里整批消失（表现为小组件空卡）。
      String day = String.valueOf(s).split("T")[0].split(" ")[0];
      String[] p = day.split("-");
      return Integer.parseInt(p[0]) + "-" + Integer.parseInt(p[1]) + "-" + Integer.parseInt(p[2]);
    } catch (Exception e) { return s; }
  }

  public static String fmtTodayLabel() {
    java.util.Calendar c = java.util.Calendar.getInstance();
    return (c.get(java.util.Calendar.MONTH) + 1) + "月" + c.get(java.util.Calendar.DAY_OF_MONTH) + "日";
  }

  /** 活动已计时长（分钟）：汇总 time_logs，运行中按当前时间计 */
  public static int trackedMinutes(JSONObject a) {
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
