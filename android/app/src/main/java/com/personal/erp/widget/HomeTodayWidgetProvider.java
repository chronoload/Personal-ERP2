package com.personal.erp.widget;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.content.Intent;
import android.view.View;
import android.widget.RemoteViews;
import com.personal.erp.MainActivity;
import com.personal.erp.R;
import org.json.JSONArray;
import org.json.JSONObject;

import java.util.Calendar;

/**
 * 开屏首页 · 今日日程（大卡片，4x4）：
 *  - 顶部：日期 + 星期 + 待办计数；下面最多 6 条今日安排（时间 + 标题 + 状态）
 *  - 底部「＋ 添加今日日程」：打开 App 并直接弹出「新建活动」，日期预填今天
 *  - 点任意行/标题：打开 App 查看当天（overview）
 *  - App「设置 › 桌面小组件 › 开屏首页 · 今日日程」可关闭（关闭后卡片只显示提示，不读数据）
 * 安全边界：仅 LinearLayout/TextView + 既有 shape drawable；全 try/catch；空态兜底。
 */
public class HomeTodayWidgetProvider extends AppWidgetProvider {

  private static final int ROWS = 6;

  @Override
  public void onUpdate(Context context, AppWidgetManager mgr, int[] ids) {
    for (int id : ids) {
      try { updateOne(context, mgr, id); } catch (Exception ignored) {}
    }
  }

  static void updateOne(Context ctx, AppWidgetManager mgr, int widgetId) {
    RemoteViews rv = new RemoteViews(ctx.getPackageName(), R.layout.widget_home_today);
    boolean dark = WidgetStore.isDarkTheme(ctx);
    applyTheme(rv, dark);

    boolean enabled = WidgetStore.isHomeTodayEnabled(ctx);
    JSONObject db = enabled ? WidgetStore.readDB(ctx) : null;

    if (!enabled) {
      rv.setTextViewText(R.id.widget_home_title, "今日日程");
      rv.setTextViewText(R.id.widget_home_date, "");
      rv.setTextViewText(R.id.widget_home_empty, "已在本应用设置中关闭这张卡片");
      rv.setViewVisibility(R.id.widget_home_empty, View.VISIBLE);
      rv.setViewVisibility(R.id.widget_home_add, View.GONE);
      for (int i = 1; i <= ROWS; i++) rv.setViewVisibility(rowId(ctx, i), View.GONE);
      bindOpen(ctx, rv, R.id.widget_home_title, false);
      mgr.updateAppWidget(widgetId, rv);
      return;
    }

    rv.setViewVisibility(R.id.widget_home_add, View.VISIBLE);
    rv.setTextViewText(R.id.widget_home_date, dateLabel());

    if (db == null) {
      rv.setTextViewText(R.id.widget_home_title, "今日日程");
      rv.setTextViewText(R.id.widget_home_empty, "打开应用同步一次数据");
      rv.setViewVisibility(R.id.widget_home_empty, View.VISIBLE);
      for (int i = 1; i <= ROWS; i++) rv.setViewVisibility(rowId(ctx, i), View.GONE);
      bindOpen(ctx, rv, R.id.widget_home_empty, false);
    } else {
      JSONArray board = WidgetStore.getBoard(db);
      int n = board.length();
      int todayCount = 0;
      for (int i = 0; i < n; i++) {
        JSONObject it = board.optJSONObject(i);
        if (it != null && "today".equals(it.optString("kind"))) todayCount++;
      }
      int runningN = WidgetStore.boardRunningCount(board);
      int pendingN = WidgetStore.boardPendingCount(board);
      int backlog = WidgetStore.backlogCount(db);
      if (n == 0) rv.setTextViewText(R.id.widget_home_title, "今日日程");
      else if (runningN > 0) rv.setTextViewText(R.id.widget_home_title,
          pendingN > 0 ? "进行中 " + runningN + " · 待办 " + pendingN : "进行中 " + runningN);
      else if (pendingN == 0 && todayCount == 0) rv.setTextViewText(R.id.widget_home_title, "今日无安排 · 待排 " + backlog);
      else if (pendingN == 0) rv.setTextViewText(R.id.widget_home_title, backlog > 0 ? "今日已完成 · 待排 " + backlog : "今日已完成 🎉");
      else rv.setTextViewText(R.id.widget_home_title, "今日日程 · 待办 " + pendingN + "/" + todayCount);

      if (n == 0) {
        // 真正空：今天没任务、也没有待排/延期
        rv.setTextViewText(R.id.widget_home_empty, "快来添加今天的日程 →");
        rv.setViewVisibility(R.id.widget_home_empty, View.VISIBLE);
        for (int i = 1; i <= ROWS; i++) rv.setViewVisibility(rowId(ctx, i), View.GONE);
        bindOpen(ctx, rv, R.id.widget_home_empty, true);
      } else {
        rv.setViewVisibility(R.id.widget_home_empty, View.GONE);
        int show = Math.min(ROWS, n);
        for (int i = 0; i < ROWS; i++) {
          JSONObject it = i < show ? board.optJSONObject(i) : null;
          renderRow(ctx, rv, i + 1, it, dark);
        }
      }
    }

    // 「＋ 添加今日日程」→ 直达新建（日期预填今天）；其余区域 → 打开 App 查看
    Intent fresh = new Intent(ctx, MainActivity.class);
    fresh.putExtra("erp_tab", "overview");
    fresh.putExtra("erp_fresh", true);
    fresh.putExtra("erp_fresh_date", WidgetStore.todayKey());
    PendingIntent pf = PendingIntent.getActivity(ctx, 2001, fresh, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    rv.setOnClickPendingIntent(R.id.widget_home_add, pf);
    // 「＋ 添加今日日程」的加号用 vector drawable
    rv.setTextViewCompoundDrawablesRelative(R.id.widget_home_add, R.drawable.widget_ic_plus_add, 0, 0, 0);
    rv.setInt(R.id.widget_home_add, "setCompoundDrawablePadding", 5);

    bindOpen(ctx, rv, R.id.widget_home_title, false);
    bindOpen(ctx, rv, R.id.widget_home_date, false);
    mgr.updateAppWidget(widgetId, rv);
  }

  private static void renderRow(Context ctx, RemoteViews rv, int pos, JSONObject item, boolean dark) {
    int row = rowId(ctx, pos);
    int glyph = glyphId(ctx, pos);
    int time = timeId(ctx, pos);
    int txt = txtId(ctx, pos);
    if (item == null) { rv.setViewVisibility(row, View.GONE); return; }
    String kind = item.optString("kind", "today");
    JSONObject a = item.optJSONObject("act");
    if (a == null) { rv.setViewVisibility(row, View.GONE); return; }

    String status = a.optString("status", "Planned");
    String clock = extractTime(WidgetStore.clockOf(a));
    String title = a.optString("title", "—");
    int tracked = WidgetStore.trackedMinutes(a);
    if ("running".equals(kind)) title = "进行中 · " + title;
    else if ("overdue".equals(kind)) title = "延期 · " + title;
    else if ("unscheduled".equals(kind)) title = "待排 · " + title;
    if (tracked > 0) title = title + "  ⏱" + tracked + "m";

    int g; int color;
    if ("running".equals(kind) || "Started".equals(status)) { g = R.drawable.widget_ic_running; color = dark ? 0xFF7ED4A3 : 0xFF3DA06A; }
    else if ("overdue".equals(kind)) { g = R.drawable.widget_ic_overdue; color = dark ? 0xFFE0B27A : 0xFFC8892F; }
    else if ("unscheduled".equals(kind)) { g = R.drawable.widget_ic_more; color = dark ? 0xFFA8B0BD : 0xFF8A93A3; }
    else {
      switch (status) {
        case "Started": g = R.drawable.widget_ic_running; color = dark ? 0xFF7ED4A3 : 0xFF3DA06A; break;
        case "Completed": case "Reviewed": case "Archived": g = R.drawable.widget_ic_done; color = dark ? 0xFF8A93A3 : 0xFF9AA3B2; break;
        case "Failed": g = R.drawable.widget_ic_failed; color = dark ? 0xFFE08A8A : 0xFFC05050; break;
        default: g = R.drawable.widget_ic_wait; color = dark ? 0xFF8FB8E8 : 0xFF4A7FBF; break;
      }
    }

    rv.setViewVisibility(row, View.VISIBLE);
    rv.setImageViewResource(glyph, g);
    rv.setInt(glyph, "setColorFilter", color);
    rv.setTextViewText(time, clock);
    rv.setTextColor(time, dark ? 0xFFA8B0BD : 0xFF6B7482);
    rv.setTextViewText(txt, title);
    rv.setTextColor(txt, "Started".equals(status) ? (dark ? 0xFF7ED4A3 : 0xFF2F7D53) : (dark ? 0xFFE8EBF0 : 0xFF1F2430));

    // 行点击 = 打开 App 查看今天
    Intent open = new Intent(ctx, MainActivity.class);
    open.putExtra("erp_tab", "overview");
    PendingIntent po = PendingIntent.getActivity(ctx, 2100 + pos, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    rv.setOnClickPendingIntent(row, po);
  }

  private static void applyTheme(RemoteViews rv, boolean dark) {
    rv.setInt(R.id.widget_home_root, "setBackgroundResource", dark ? R.drawable.widget_bg_dark : R.drawable.widget_bg);
    rv.setInt(R.id.widget_home_add, "setBackgroundResource", dark ? R.drawable.widget_act_bg_dark : R.drawable.widget_add_bg);
    rv.setTextColor(R.id.widget_home_title, dark ? 0xFFF0F2F5 : 0xFF202631);
    rv.setTextColor(R.id.widget_home_date, dark ? 0xFFA8B0BD : 0xFF6B7482);
    rv.setTextColor(R.id.widget_home_empty, dark ? 0xFFA8B0BD : 0xFF9AA3B2);
    rv.setTextColor(R.id.widget_home_add, dark ? 0xFF8FB8E8 : 0xFF4A7FBF);
  }

  private static void bindOpen(Context ctx, RemoteViews rv, int viewId, boolean fresh) {
    Intent intent = new Intent(ctx, MainActivity.class);
    intent.putExtra("erp_tab", "overview");
    if (fresh) {
      intent.putExtra("erp_fresh", true);
      intent.putExtra("erp_fresh_date", WidgetStore.todayKey());
    }
    PendingIntent pi = PendingIntent.getActivity(ctx, 2000, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    rv.setOnClickPendingIntent(viewId, pi);
  }

  private static String dateLabel() {
    Calendar c = Calendar.getInstance();
    String[] wd = {"周日", "周一", "周二", "周三", "周四", "周五", "周六"};
    return (c.get(Calendar.MONTH) + 1) + "月" + c.get(Calendar.DAY_OF_MONTH) + "日 " + wd[c.get(Calendar.DAY_OF_WEEK) - 1];
  }

  private static int rowId(Context ctx, int i) {
    return ctx.getResources().getIdentifier("widget_home_row" + i, "id", ctx.getPackageName());
  }

  private static int glyphId(Context ctx, int i) {
    return ctx.getResources().getIdentifier("widget_home_glyph" + i, "id", ctx.getPackageName());
  }

  private static int timeId(Context ctx, int i) {
    return ctx.getResources().getIdentifier("widget_home_time" + i, "id", ctx.getPackageName());
  }

  private static int txtId(Context ctx, int i) {
    return ctx.getResources().getIdentifier("widget_home_txt" + i, "id", ctx.getPackageName());
  }

  private static String extractTime(String ps) {
    if (ps == null || ps.isEmpty() || ps.equals("null")) return "";
    int t = ps.indexOf('T');
    if (t >= 0 && t + 1 < ps.length()) return ps.substring(t + 1);
    return "";
  }
}
