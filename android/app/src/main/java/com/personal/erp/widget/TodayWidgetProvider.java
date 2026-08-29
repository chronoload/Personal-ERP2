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

/**
 * 当日日程小组件（Loop Habit Tracker 式交互）：
 *  - 每行左侧状态圆钮：○ 待办(点击▶开始) / ● 进行中 / ✓ 已完成
 *  - 右侧时间+标题+已计时长
 *  - 「一键开始」为字段级修改：writeDB 自动 rev++，JS 回前台经 getData 回读覆盖本地，
 *    与 txs 合并机制互补，双向同步闭环。
 * 安全边界：仅 LinearLayout/TextView + shape drawable 资源引用；全 try/catch；空态兜底。
 */
public class TodayWidgetProvider extends AppWidgetProvider {

  @Override
  public void onUpdate(Context context, AppWidgetManager mgr, int[] ids) {
    for (int id : ids) {
      try { updateOne(context, mgr, id); } catch (Exception ignored) {}
    }
  }

  static void updateOne(Context ctx, AppWidgetManager mgr, int widgetId) {
    RemoteViews rv = new RemoteViews(ctx.getPackageName(), R.layout.widget_today);

    boolean dark = WidgetStore.isDarkTheme(ctx);
    applyTheme(ctx, rv, dark);

    JSONObject db = WidgetStore.readDB(ctx);
    if (db == null) {
      rv.setTextViewText(R.id.widget_today_title, "当日日程");
      rv.setTextViewText(R.id.widget_today_empty, "打开应用同步数据");
      rv.setViewVisibility(R.id.widget_today_empty, View.VISIBLE);
      for (int i = 1; i <= 4; i++) hideRow(ctx, rv, i);
      bindOpen(ctx, rv, R.id.widget_today_empty);
    } else {
      JSONArray today = WidgetStore.getActivitiesForToday(db);
      int n = today.length();
      int pending = 0;
      for (int i = 0; i < n; i++) {
        JSONObject x = today.optJSONObject(i);
        String st = x != null ? x.optString("status", "") : "";
        if (!"Completed".equals(st) && !"Reviewed".equals(st) && !"Archived".equals(st)) pending++;
      }
      rv.setTextViewText(R.id.widget_today_title,
          n == 0 ? "当日日程 · 全部完成 🎉" : "当日日程 " + done(n, pending));

      if (n == 0) {
        rv.setViewVisibility(R.id.widget_today_empty, View.VISIBLE);
        for (int i = 1; i <= 4; i++) hideRow(ctx, rv, i);
        bindOpen(ctx, rv, R.id.widget_today_empty);
      } else {
        rv.setViewVisibility(R.id.widget_today_empty, View.GONE);
        int show = Math.min(4, n);
        for (int i = 0; i < 4; i++) {
          JSONObject a = i < show ? today.optJSONObject(i) : null;
          renderRow(ctx, rv, i + 1, a, dark);
        }
      }
    }

    bindOpen(ctx, rv, R.id.widget_today_title);
    // 「＋ 新建」：跳 App 并直接弹新建框
    Intent fresh = new Intent(ctx, MainActivity.class);
    fresh.putExtra("erp_tab", "overview");
    fresh.putExtra("erp_fresh", true);
    PendingIntent pf = PendingIntent.getActivity(ctx, 1, fresh, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    rv.setOnClickPendingIntent(R.id.widget_today_add, pf);
    mgr.updateAppWidget(widgetId, rv);
  }

  private static String done(int n, int pending) {
    return pending == 0 ? "" : "（待办 " + pending + "/" + n + "）";
  }

  /** 单行渲染：act=状态圆钮（Planned 可点开始），txt=时间+标题+计时 */
  private static void renderRow(Context ctx, RemoteViews rv, int pos, JSONObject a, boolean dark) {
    int row = rowId(ctx, pos), act = actId(ctx, pos), txt = txtId(ctx, pos);
    if (a == null) { hideRow(ctx, rv, pos); return; }

    String status = a.optString("status", "Planned");
    String time = extractTime(a.optString("planned_start", ""));
    String title = a.optString("title", "—");
    int tracked = WidgetStore.trackedMinutes(a);
    StringBuilder line = new StringBuilder();
    if (!time.isEmpty()) line.append(time).append("  ");
    line.append(title);
    if (tracked > 0) line.append("  ⏱").append(tracked).append("m");

    String glyph; int color; boolean canStart = false;
    switch (status) {
      case "Started": glyph = "●"; color = dark ? 0xFF7ED4A3 : 0xFF3DA06A; break;
      case "Completed": case "Reviewed": case "Archived": glyph = "✓"; color = dark ? 0xFF8A93A3 : 0xFF9AA3B2; break;
      default: glyph = "▶"; color = dark ? 0xFF8FB8E8 : 0xFF4A7FBF; canStart = true; break;
    }

    rv.setViewVisibility(row, View.VISIBLE);
    rv.setTextViewText(act, glyph);
    rv.setTextColor(act, color);
    rv.setInt(act, "setBackgroundResource", dark ? R.drawable.widget_act_bg_dark : R.drawable.widget_act_bg);
    rv.setTextViewText(txt, line.toString());
    rv.setTextColor(txt, "Started".equals(status) ? (dark ? 0xFF7ED4A3 : 0xFF2F7D53) : (dark ? 0xFFE8EBF0 : 0xFF1F2430));

    if (canStart) {
      Intent it = new Intent(ctx, WidgetActionReceiver.class);
      it.setAction(WidgetActionReceiver.ACTION_START);
      it.putExtra(WidgetActionReceiver.EXTRA_ACTIVITY_ID, a.optString("id"));
      PendingIntent pi = PendingIntent.getBroadcast(ctx, 300 + pos, it,
          PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
      rv.setOnClickPendingIntent(act, pi);
      // 行其余部分点击进 App
      Intent open = new Intent(ctx, MainActivity.class);
      open.putExtra("erp_tab", "overview");
      PendingIntent po = PendingIntent.getActivity(ctx, 10 + pos, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
      rv.setOnClickPendingIntent(txt, po);
      rv.setOnClickPendingIntent(row, po);
    } else {
      Intent open = new Intent(ctx, MainActivity.class);
      open.putExtra("erp_tab", "overview");
      PendingIntent po = PendingIntent.getActivity(ctx, 10 + pos, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
      rv.setOnClickPendingIntent(act, po);
      rv.setOnClickPendingIntent(txt, po);
      rv.setOnClickPendingIntent(row, po);
    }
  }

  private static void applyTheme(Context ctx, RemoteViews rv, boolean dark) {
    rv.setInt(R.id.widget_today_root, "setBackgroundResource", dark ? R.drawable.widget_bg_dark : R.drawable.widget_bg);
    rv.setInt(R.id.widget_today_add, "setBackgroundResource", dark ? R.drawable.widget_act_bg_dark : R.drawable.widget_add_bg);
    rv.setTextColor(R.id.widget_today_title, dark ? 0xFFF0F2F5 : 0xFF202631);
    rv.setTextColor(R.id.widget_today_add, dark ? 0xFF8FB8E8 : 0xFF4A7FBF);
    rv.setTextColor(R.id.widget_today_empty, dark ? 0xFFA8B0BD : 0xFF9AA3B2);
  }

  private static void hideRow(Context ctx, RemoteViews rv, int pos) {
    rv.setViewVisibility(rowId(ctx, pos), View.GONE);
  }

  private static void bindOpen(Context ctx, RemoteViews rv, int viewId) {
    Intent intent = new Intent(ctx, MainActivity.class);
    intent.putExtra("erp_tab", "overview");
    PendingIntent pi = PendingIntent.getActivity(ctx, 0, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    rv.setOnClickPendingIntent(viewId, pi);
  }

  private static int rowId(Context ctx, int i) {
    return ctx.getResources().getIdentifier("widget_today_row" + i, "id", ctx.getPackageName());
  }

  private static int actId(Context ctx, int i) {
    return ctx.getResources().getIdentifier("widget_today_act" + i, "id", ctx.getPackageName());
  }

  private static int txtId(Context ctx, int i) {
    return ctx.getResources().getIdentifier("widget_today_txt" + i, "id", ctx.getPackageName());
  }

  private static String extractTime(String ps) {
    if (ps == null || ps.isEmpty() || ps.equals("null")) return "";
    int t = ps.indexOf('T');
    if (t >= 0 && t + 1 < ps.length()) return ps.substring(t + 1);
    return "";
  }
}