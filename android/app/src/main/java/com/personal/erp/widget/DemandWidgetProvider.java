package com.personal.erp.widget;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.widget.RemoteViews;

import com.personal.erp.MainActivity;
import com.personal.erp.R;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

/**
 * 需求档案小组件（4×3）：按来源查看「谁要什么」。
 *  - 点标题在「全部 / 各来源用户」之间轮换（选择按实例持久化）
 *  - 下方是可滚动的需求队列（状态染色）；点底部「＋ 记一条需求」直接弹窗记录，不用进 App
 */
public class DemandWidgetProvider extends AppWidgetProvider {

  public static final String ACTION_DM_SWITCH = "com.personal.erp.widget.ACTION_DM_SWITCH";
  static final String EXTRA_REQUESTER = "dm_requester";
  private static final String PREF_PREFIX = "widget_dm_rq_";

  @Override
  public void onUpdate(Context context, AppWidgetManager mgr, int[] ids) {
    for (int id : ids) {
      try { updateOne(context, mgr, id); } catch (Exception ignored) {}
    }
  }

  @Override
  public void onReceive(Context context, Intent intent) {
    super.onReceive(context, intent);
    if (ACTION_DM_SWITCH.equals(intent.getAction())) {
      int id = intent.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, -1);
      if (id >= 0) cycleRequester(context, id);
    }
  }

  @Override
  public void onDeleted(Context context, int[] ids) {
    try {
      SharedPreferences sp = context.getSharedPreferences(WidgetKeys.PREFS_FILE, Context.MODE_PRIVATE);
      SharedPreferences.Editor ed = sp.edit();
      for (int id : ids) ed.remove(PREF_PREFIX + id);
      ed.apply();
    } catch (Exception ignored) {}
  }

  static void updateOne(Context ctx, AppWidgetManager mgr, int widgetId) {
    RemoteViews rv = new RemoteViews(ctx.getPackageName(), R.layout.widget_demand);
    boolean dark = WidgetStore.isDarkTheme(ctx);
    rv.setInt(R.id.widget_dm_root, "setBackgroundResource",
        dark ? R.drawable.widget_bg_dark : R.drawable.widget_bg);
    rv.setTextColor(R.id.widget_dm_title, dark ? 0xFFF0F2F5 : 0xFF202631);
    rv.setTextColor(R.id.widget_dm_count, dark ? 0xFFA8B0BD : 0xFF9AA3B2);
    rv.setTextColor(R.id.widget_dm_empty, dark ? 0xFFA8B0BD : 0xFF9AA3B2);
    rv.setTextColor(R.id.widget_dm_add, dark ? 0xFF8FB8E8 : 0xFF4A7FBF);
    rv.setInt(R.id.widget_dm_add, "setBackgroundResource",
        dark ? R.drawable.widget_act_bg_dark : R.drawable.widget_add_bg);

    JSONObject db = WidgetStore.readDB(ctx);
    String rid = requesterOf(ctx, widgetId);
    rv.setTextViewText(R.id.widget_dm_title, "需求 · " + requesterLabel(db, rid));
    rv.setTextViewText(R.id.widget_dm_count, db == null ? "打开应用同步" : pendingText(db, rid));

    Intent svc = new Intent(ctx, DemandWidgetService.class);
    svc.putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId);
    svc.setData(Uri.parse(svc.toUri(Intent.URI_INTENT_SCHEME)));
    rv.setRemoteAdapter(R.id.widget_dm_list, svc);
    rv.setEmptyView(R.id.widget_dm_list, R.id.widget_dm_empty);

    // 行点击 → 进 App 的需求档案
    Intent tpl = new Intent(ctx, MainActivity.class);
    tpl.putExtra("erp_tab", "demands");
    tpl.setData(Uri.parse("erp://widget/demand/open"));
    rv.setPendingIntentTemplate(R.id.widget_dm_list, PendingIntent.getActivity(ctx, 7200, tpl,
        PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_MUTABLE));

    // 标题：切换来源
    Intent sw = new Intent(ctx, DemandWidgetProvider.class);
    sw.setAction(ACTION_DM_SWITCH);
    sw.putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId);
    rv.setOnClickPendingIntent(R.id.widget_dm_title, PendingIntent.getBroadcast(
        ctx, 7220 + widgetId, sw, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE));

    // 底部：桌面直接记一条（小弹窗，不进入主程序）
    Intent add = new Intent(ctx, DemandQuickAddActivity.class);
    add.putExtra(EXTRA_REQUESTER, rid);
    rv.setOnClickPendingIntent(R.id.widget_dm_add, PendingIntent.getActivity(
        ctx, 7230 + widgetId, add, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE));

    Intent open = new Intent(ctx, MainActivity.class);
    open.putExtra("erp_tab", "demands");
    rv.setOnClickPendingIntent(R.id.widget_dm_root, PendingIntent.getActivity(
        ctx, 7210 + widgetId, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE));

    mgr.updateAppWidget(widgetId, rv);
    mgr.notifyAppWidgetViewDataChanged(new int[]{widgetId}, R.id.widget_dm_list);
  }

  static String pendingText(JSONObject db, String rid) {
    JSONArray list = db != null ? db.optJSONArray("demands") : null;
    if (list == null || list.length() == 0) return "待处理 0";
    int open = 0;
    for (int i = 0; i < list.length(); i++) {
      JSONObject d = list.optJSONObject(i);
      if (d == null) continue;
      if (!"open".equals(d.optString("status", "open"))) continue;
      if (rid != null && !rid.isEmpty() && !rid.equals(d.optString("requesterId", ""))) continue;
      open++;
    }
    return "待处理 " + open;
  }

  static String requesterOf(Context ctx, int widgetId) {
    try {
      SharedPreferences sp = ctx.getSharedPreferences(WidgetKeys.PREFS_FILE, Context.MODE_PRIVATE);
      return sp.getString(PREF_PREFIX + widgetId, "");
    } catch (Exception e) { return ""; }
  }

  private static void writeRequester(Context ctx, int widgetId, String rid) {
    try {
      SharedPreferences sp = ctx.getSharedPreferences(WidgetKeys.PREFS_FILE, Context.MODE_PRIVATE);
      sp.edit().putString(PREF_PREFIX + widgetId, rid == null ? "" : rid).apply();
    } catch (Exception ignored) {}
  }

  /** 切换项：全部 + 每个来源用户 */
  private static List<String[]> requesters(JSONObject db) {
    List<String[]> out = new ArrayList<>();
    out.add(new String[]{"", "全部"});
    JSONArray arr = db != null ? db.optJSONArray("requesters") : null;
    if (arr != null) {
      for (int i = 0; i < arr.length(); i++) {
        JSONObject r = arr.optJSONObject(i);
        if (r == null) continue;
        out.add(new String[]{r.optString("id", ""), r.optString("name", "未命名")});
      }
    }
    return out;
  }

  static String requesterLabel(JSONObject db, String rid) {
    if (rid == null || rid.isEmpty()) return "全部";
    for (String[] r : requesters(db)) if (rid.equals(r[0])) return r[1];
    return "来源";
  }

  static void cycleRequester(Context ctx, int widgetId) {
    try {
      List<String[]> list = requesters(WidgetStore.readDB(ctx));
      String cur = requesterOf(ctx, widgetId);
      int idx = 0;
      for (int i = 0; i < list.size(); i++) {
        if (list.get(i)[0].equals(cur)) { idx = i; break; }
      }
      writeRequester(ctx, widgetId, list.get((idx + 1) % list.size())[0]);
    } catch (Exception ignored) {}
    refreshOne(ctx, widgetId);
  }

  static void refreshOne(Context ctx, int widgetId) {
    try { updateOne(ctx, AppWidgetManager.getInstance(ctx), widgetId); } catch (Exception ignored) {}
  }

  static void refreshAll(Context ctx) {
    try {
      AppWidgetManager mgr = AppWidgetManager.getInstance(ctx);
      int[] ids = mgr.getAppWidgetIds(new ComponentName(ctx, DemandWidgetProvider.class));
      for (int id : ids) updateOne(ctx, mgr, id);
    } catch (Exception ignored) {}
  }
}
