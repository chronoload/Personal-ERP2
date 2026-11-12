package com.personal.erp.widget;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.widget.RemoteViews;

import com.personal.erp.MainActivity;
import com.personal.erp.R;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.Calendar;

/**
 * 日记小组件：显示某一天的日记正文（默认今天）。
 * 顶部 ‹ › 逐日回溯（今天 / 昨天 / 前天…），点正文进 App 日记页并直接聚焦编辑器。
 * 只读 db 快照，不写库；切日偏移按 widget 实例单独存。
 */
public class DiaryWidgetProvider extends AppWidgetProvider {
  public static final String ACTION_PREV = "com.personal.erp.widget.DIARY_PREV";
  public static final String ACTION_NEXT = "com.personal.erp.widget.DIARY_NEXT";
  public static final String EXTRA_WIDGET_ID = "widget_id";

  @Override
  public void onUpdate(Context context, AppWidgetManager mgr, int[] ids) {
    for (int id : ids) {
      try { updateOne(context, mgr, id); } catch (Exception ignored) {}
    }
  }

  @Override
  public void onReceive(Context context, Intent intent) {
    super.onReceive(context, intent);
    String action = intent.getAction();
    if (!ACTION_PREV.equals(action) && !ACTION_NEXT.equals(action)) return;
    int id = intent.getIntExtra(EXTRA_WIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID);
    if (id == AppWidgetManager.INVALID_APPWIDGET_ID) return;
    int off = readOffset(context, id);
    // 左边界不设限（可以一直往前翻到第一篇之前，显示「这天没有日记」）；
    // 右边界停在今天，避免翻到未来。
    off = ACTION_PREV.equals(action) ? off - 1 : Math.min(0, off + 1);
    writeOffset(context, id, off);
    updateOne(context, AppWidgetManager.getInstance(context), id);
  }

  static void updateOne(Context ctx, AppWidgetManager mgr, int widgetId) {
    RemoteViews rv = new RemoteViews(ctx.getPackageName(), R.layout.widget_diary);
    boolean dark = WidgetStore.isDarkTheme(ctx);
    int mainColor = dark ? 0xFFF0F2F5 : 0xFF202631;
    int subColor = dark ? 0xFFA8B0BD : 0xFF9AA3B2;

    rv.setInt(R.id.widget_diary_root, "setBackgroundResource", dark ? R.drawable.widget_bg_dark : R.drawable.widget_bg);
    rv.setTextColor(R.id.widget_diary_body, mainColor);
    rv.setTextColor(R.id.widget_diary_date, subColor);
    rv.setTextColor(R.id.widget_diary_hint, subColor);
    rv.setTextColor(R.id.widget_diary_prev, subColor);
    rv.setTextColor(R.id.widget_diary_next, subColor);

    int offset = readOffset(ctx, widgetId);
    Calendar c = Calendar.getInstance();
    c.add(Calendar.DAY_OF_MONTH, offset);
    String key = dayKey(c);
    rv.setTextViewText(R.id.widget_diary_date, dayLabel(offset, c));

    JSONObject db = WidgetStore.readDB(ctx);
    if (db == null) {
      rv.setTextViewText(R.id.widget_diary_body, "打开应用同步数据");
      rv.setTextViewText(R.id.widget_diary_hint, "");
    } else {
      String md = journalMd(db, key);
      if (md.trim().isEmpty()) {
        rv.setTextViewText(R.id.widget_diary_body, offset == 0 ? "今天还没写，点一下开始 →" : "这天没有日记");
        rv.setTextViewText(R.id.widget_diary_hint, "点按进入日记编辑");
      } else {
        rv.setTextViewText(R.id.widget_diary_body, excerpt(md));
        rv.setTextViewText(R.id.widget_diary_hint, "点按进入日记编辑");
      }
    }

    Intent prev = new Intent(ctx, DiaryWidgetProvider.class);
    prev.setAction(ACTION_PREV);
    prev.putExtra(EXTRA_WIDGET_ID, widgetId);
    rv.setOnClickPendingIntent(R.id.widget_diary_prev, PendingIntent.getBroadcast(ctx, 7000 + widgetId, prev,
        PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE));

    Intent next = new Intent(ctx, DiaryWidgetProvider.class);
    next.setAction(ACTION_NEXT);
    next.putExtra(EXTRA_WIDGET_ID, widgetId);
    rv.setOnClickPendingIntent(R.id.widget_diary_next, PendingIntent.getBroadcast(ctx, 7100 + widgetId, next,
        PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE));

    // 点正文 → 打开 App 日记页，定位到这一天并聚焦编辑器
    Intent open = new Intent(ctx, MainActivity.class);
    open.putExtra("erp_tab", "diary");
    open.putExtra("erp_diary_date", key);
    open.putExtra("erp_diary_edit", true);
    PendingIntent po = PendingIntent.getActivity(ctx, 7200 + widgetId, open,
        PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    rv.setOnClickPendingIntent(R.id.widget_diary_body, po);
    rv.setOnClickPendingIntent(R.id.widget_diary_hint, po);
    rv.setOnClickPendingIntent(R.id.widget_diary_root, po);

    mgr.updateAppWidget(widgetId, rv);
  }

  /** 这一天的日记正文（journals[].date 是不补零的 Y-M-D） */
  private static String journalMd(JSONObject db, String key) {
    try {
      JSONArray js = db.optJSONArray("journals");
      if (js == null) return "";
      for (int i = 0; i < js.length(); i++) {
        JSONObject j = js.optJSONObject(i);
        if (j == null) continue;
        if (key.equals(normKey(j.optString("date", "")))) return j.optString("md", "");
      }
    } catch (Exception ignored) {}
    return "";
  }

  /** 与 JS 侧一致的日键：YYYY-M-D（不补零） */
  private static String normKey(String s) {
    try {
      String day = String.valueOf(s).split("T")[0].split(" ")[0];
      String[] p = day.split("-");
      return Integer.parseInt(p[0]) + "-" + Integer.parseInt(p[1]) + "-" + Integer.parseInt(p[2]);
    } catch (Exception e) { return ""; }
  }

  private static String dayKey(Calendar c) {
    return c.get(Calendar.YEAR) + "-" + (c.get(Calendar.MONTH) + 1) + "-" + c.get(Calendar.DAY_OF_MONTH);
  }

  private static String dayLabel(int offset, Calendar c) {
    String rel;
    if (offset == 0) rel = "今天";
    else if (offset == -1) rel = "昨天";
    else if (offset == -2) rel = "前天";
    else rel = (-offset) + " 天前";
    String wd = String.valueOf("日一二三四五六".charAt(c.get(Calendar.DAY_OF_WEEK) - 1));
    return rel + " · " + (c.get(Calendar.MONTH) + 1) + "月" + c.get(Calendar.DAY_OF_MONTH) + "日 周" + wd;
  }

  /** 小组件只放正文摘要：去掉代码围栏/标题标记，压掉空行，限长 */
  private static String excerpt(String md) {
    StringBuilder sb = new StringBuilder();
    for (String raw : md.split("\n")) {
      String line = raw.trim();
      if (line.isEmpty() || line.startsWith("```")) continue;
      if (line.startsWith("#")) line = line.replaceFirst("^#+\\s*", "");
      if (line.isEmpty()) continue;
      if (sb.length() > 0) sb.append('\n');
      sb.append(line);
      if (sb.length() > 260) break;
    }
    String out = sb.toString();
    return out.length() > 260 ? out.substring(0, 260) + "…" : out;
  }

  private static int readOffset(Context ctx, int widgetId) {
    try {
      SharedPreferences sp = ctx.getSharedPreferences(WidgetKeys.PREFS_FILE, Context.MODE_PRIVATE);
      return sp.getInt("widget_diary_off_" + widgetId, 0);
    } catch (Exception e) { return 0; }
  }

  private static void writeOffset(Context ctx, int widgetId, int v) {
    try {
      SharedPreferences sp = ctx.getSharedPreferences(WidgetKeys.PREFS_FILE, Context.MODE_PRIVATE);
      sp.edit().putInt("widget_diary_off_" + widgetId, v).apply();
    } catch (Exception ignored) {}
  }
}
