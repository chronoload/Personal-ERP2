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
import java.util.HashMap;
import java.util.Map;

/**
 * 目标与计划小组件（极简实现）：仅 LinearLayout + TextView，全 try/catch。
 */
public class GoalsWidgetProvider extends AppWidgetProvider {

  @Override
  public void onUpdate(Context context, AppWidgetManager mgr, int[] ids) {
    for (int id : ids) {
      try {
        updateOne(context, mgr, id);
      } catch (Exception ignored) {}
    }
  }

  static void updateOne(Context ctx, AppWidgetManager mgr, int widgetId) {
    RemoteViews rv = new RemoteViews(ctx.getPackageName(), R.layout.widget_goals);

    // 主题（配置页选择）：浅色 / 深色
    boolean dark = WidgetStore.isDarkTheme(ctx);
    rv.setInt(R.id.widget_goals_root, "setBackgroundResource", dark ? R.drawable.widget_bg_dark : R.drawable.widget_bg);
    rv.setTextColor(R.id.widget_goals_title, dark ? 0xFFF0F2F5 : 0xFF202631);
    rv.setTextColor(R.id.widget_goals_empty, dark ? 0xFFA8B0BD : 0xFF9AA3B2);
    rv.setTextColor(R.id.widget_goals_meta, dark ? 0xFFA8B0BD : 0xFF9AA3B2);
    for (int i = 1; i <= 3; i++) rv.setTextColor(rowId(ctx, i), dark ? 0xFFE8EBF0 : 0xFF1F2430);

    rv.setTextViewText(R.id.widget_goals_title, "目标与计划");

    JSONObject db = WidgetStore.readDB(ctx);
    if (db == null) {
      rv.setTextViewText(R.id.widget_goals_empty, "打开应用同步数据");
      rv.setViewVisibility(R.id.widget_goals_empty, View.VISIBLE);
      for (int i = 1; i <= 3; i++) rv.setViewVisibility(rowId(ctx, i), View.GONE);
      rv.setViewVisibility(R.id.widget_goals_bar, View.GONE);
      rv.setTextViewText(R.id.widget_goals_meta, "");
    } else {
      JSONArray goals = db.optJSONArray("goals");
      JSONArray plans = db.optJSONArray("plans");
      if (goals == null || goals.length() == 0) {
        rv.setTextViewText(R.id.widget_goals_empty, "暂无目标");
        rv.setViewVisibility(R.id.widget_goals_empty, View.VISIBLE);
        for (int i = 1; i <= 3; i++) rv.setViewVisibility(rowId(ctx, i), View.GONE);
      } else {
        rv.setViewVisibility(R.id.widget_goals_empty, View.GONE);
        Map<String, Integer> planCount = new HashMap<>();
        if (plans != null) {
          for (int i = 0; i < plans.length(); i++) {
            JSONObject p = plans.optJSONObject(i);
            if (p == null) continue;
            String gid = p.optString("goal_id", "");
            planCount.put(gid, planCount.getOrDefault(gid, 0) + 1);
          }
        }
        int show = Math.min(3, goals.length());
        for (int i = 0; i < 3; i++) {
          int row = rowId(ctx, i + 1);
          if (i < show) {
            JSONObject g = goals.optJSONObject(i);
            if (g == null) { rv.setViewVisibility(row, View.GONE); continue; }
            String title = g.optString("title", "—");
            int c = planCount.getOrDefault(g.optString("id", ""), 0);
            rv.setTextViewText(row, title + "  (" + c + " 计划)");
            rv.setViewVisibility(row, View.VISIBLE);
          } else {
            rv.setViewVisibility(row, View.GONE);
          }
        }
        // 今日完成度进度条：今日 Completed+Reviewed / 今日全部活动
        try {
          JSONArray acts = db.optJSONArray("activities");
          int total = 0, done = 0;
          if (acts != null) {
            java.util.Calendar c = java.util.Calendar.getInstance();
            String todayKey = c.get(java.util.Calendar.YEAR) + "-" + (c.get(java.util.Calendar.MONTH) + 1) + "-" + c.get(java.util.Calendar.DAY_OF_MONTH);
            for (int i = 0; i < acts.length(); i++) {
              JSONObject a = acts.optJSONObject(i);
              if (a == null) continue;
              long actual = a.optLong("actual_start", 0);
              boolean isToday = false;
              if (actual > 0) {
                java.util.Calendar ac = java.util.Calendar.getInstance();
                ac.setTimeInMillis(actual);
                isToday = ac.get(java.util.Calendar.YEAR) == c.get(java.util.Calendar.YEAR)
                    && ac.get(java.util.Calendar.MONTH) == c.get(java.util.Calendar.MONTH)
                    && ac.get(java.util.Calendar.DAY_OF_MONTH) == c.get(java.util.Calendar.DAY_OF_MONTH);
              } else {
                String pd = a.optString("planned_date", "");
                isToday = pd.equals(todayKey) || WidgetStore.normalizeDate(pd).equals(todayKey);
              }
              if (!isToday) continue;
              total++;
              String st = a.optString("status", "");
              if ("Completed".equals(st) || "Reviewed".equals(st) || "Archived".equals(st)) done++;
            }
          }
          if (total > 0) {
            rv.setViewVisibility(R.id.widget_goals_bar, View.VISIBLE);
            rv.setProgressBar(R.id.widget_goals_bar, 100, done * 100 / total, false);
            rv.setTextViewText(R.id.widget_goals_meta, "今日完成度 " + done + "/" + total);
          } else {
            rv.setViewVisibility(R.id.widget_goals_bar, View.GONE);
            rv.setTextViewText(R.id.widget_goals_meta, "");
          }
        } catch (Exception ignored) {}
      }
    }

    Intent intent = new Intent(ctx, MainActivity.class);
    intent.putExtra("erp_tab", "goals");
    PendingIntent pi = PendingIntent.getActivity(ctx, 0, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    rv.setOnClickPendingIntent(R.id.widget_goals_title, pi);
    rv.setOnClickPendingIntent(R.id.widget_goals_empty, pi);
    for (int i = 1; i <= 3; i++) rv.setOnClickPendingIntent(rowId(ctx, i), pi);
    mgr.updateAppWidget(widgetId, rv);
  }

  private static int rowId(Context ctx, int i) {
    return ctx.getResources().getIdentifier("widget_goals_row" + i, "id", ctx.getPackageName());
  }
}