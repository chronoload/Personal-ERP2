package com.personal.erp.widget;

import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Bundle;
import android.view.View;
import android.widget.ArrayAdapter;
import android.widget.Button;
import android.widget.EditText;
import android.widget.RadioGroup;
import android.widget.Spinner;
import androidx.appcompat.app.AppCompatActivity;

import com.personal.erp.R;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

/**
 * 小组件配置页。
 *  - 主题：所有组件共用（写 KeyConfig {dark}）
 *  - 倒计时来源：仅 CountdownWidgetProvider 显示，per-widget 存 widget_cd_<id>
 *    next（下一个任务）/ task（指定任务）/ custom（自定义时间）
 * 保存后只刷新该 id 归属的那个 Provider，避免用错布局渲染其他组件。
 */
public class WidgetConfigureActivity extends AppCompatActivity {
  private int appWidgetId = AppWidgetManager.INVALID_APPWIDGET_ID;
  private String[] activityIds = new String[0];

  @Override
  protected void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    setResult(RESULT_CANCELED);
    Intent intent = getIntent();
    if (intent != null) {
      appWidgetId = intent.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID);
    }
    if (appWidgetId == AppWidgetManager.INVALID_APPWIDGET_ID) { finish(); return; }

    setContentView(R.layout.widget_configure);

    // 主题预填
    boolean dark = WidgetStore.isDarkTheme(this);
    RadioGroup theme = findViewById(R.id.cfg_theme);
    if (dark) theme.check(R.id.cfg_theme_dark);
    else theme.check(R.id.cfg_theme_light);

    Class<?> owner = owningProvider();
    boolean isCountdown = owner == CountdownWidgetProvider.class;
    View box = findViewById(R.id.cfg_countdown_box);
    if (isCountdown) {
      box.setVisibility(View.VISIBLE);
      bindCountdown();
    }

    Button save = findViewById(R.id.cfg_save);
    save.setOnClickListener(v -> {
      boolean isDark = theme.getCheckedRadioButtonId() == R.id.cfg_theme_dark;
      try {
        JSONObject o = new JSONObject();
        o.put("dark", isDark);
        SharedPreferences sp = getSharedPreferences(WidgetKeys.PREFS_FILE, Context.MODE_PRIVATE);
        sp.edit().putString(WidgetKeys.KEY_CONFIG, o.toString()).apply();
      } catch (Exception ignored) {}
      if (isCountdown) saveCountdownConfig();
      refreshOwningProvider(owner);
      Intent result = new Intent();
      result.putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, appWidgetId);
      setResult(RESULT_OK, result);
      finish();
    });
  }

  /** 倒计时：next / task / custom 三选一，按模式切换可见控件（手动计时已拆分为专注停表组件） */
  private void bindCountdown() {
    RadioGroup mode = findViewById(R.id.cfg_cd_mode);
    Spinner spinner = findViewById(R.id.cfg_cd_spinner);
    EditText title = findViewById(R.id.cfg_cd_title);
    EditText time = findViewById(R.id.cfg_cd_time);
    findViewById(R.id.cfg_cd_manual_hint).setVisibility(View.VISIBLE);

    // 活动列表（未完成 + 已排期）
    JSONArray list = WidgetStore.openScheduledActivities(WidgetStore.readDB(this));
    List<String> labels = new ArrayList<>();
    List<String> ids = new ArrayList<>();
    for (int i = 0; i < list.length(); i++) {
      JSONObject a = list.optJSONObject(i);
      if (a == null) continue;
      String ps = WidgetStore.clockOf(a);
      String when = ps.length() > 16 ? ps.substring(5, 16).replace('T', ' ') : ps;
      labels.add(a.optString("title", "任务") + "  ·  " + when);
      ids.add(a.optString("id"));
    }
    if (labels.isEmpty()) {
      labels.add("（没有已排期的活动）");
      ids.add("");
    }
    activityIds = ids.toArray(new String[0]);
    ArrayAdapter<String> ad = new ArrayAdapter<>(this, android.R.layout.simple_spinner_item, labels);
    ad.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item);
    spinner.setAdapter(ad);

    // 预填已有配置
    JSONObject cfg = WidgetStore.readCountdownConfig(this, appWidgetId);
    String m = cfg.optString("mode", "next");
    if ("task".equals(m)) mode.check(R.id.cfg_cd_task);
    else if ("custom".equals(m)) mode.check(R.id.cfg_cd_custom);
    else mode.check(R.id.cfg_cd_next);
    String curId = cfg.optString("activityId", "");
    for (int i = 0; i < activityIds.length; i++) {
      if (activityIds[i].equals(curId)) { spinner.setSelection(i); break; }
    }
    title.setText(cfg.optString("title", ""));
    long target = cfg.optLong("target", 0);
    if (target > 0) {
      java.util.Calendar c = java.util.Calendar.getInstance();
      c.setTimeInMillis(target);
      time.setText(String.format("%04d-%02d-%02d %02d:%02d",
          c.get(java.util.Calendar.YEAR), c.get(java.util.Calendar.MONTH) + 1, c.get(java.util.Calendar.DAY_OF_MONTH),
          c.get(java.util.Calendar.HOUR_OF_DAY), c.get(java.util.Calendar.MINUTE)));
    }

    Runnable sync = () -> {
      boolean task = mode.getCheckedRadioButtonId() == R.id.cfg_cd_task;
      boolean custom = mode.getCheckedRadioButtonId() == R.id.cfg_cd_custom;
      spinner.setVisibility(task ? View.VISIBLE : View.GONE);
      time.setVisibility(custom ? View.VISIBLE : View.GONE);
      title.setVisibility(custom ? View.VISIBLE : View.GONE);
    };
    mode.setOnCheckedChangeListener((g, id) -> sync.run());
    sync.run();
  }

  private void saveCountdownConfig() {
    try {
      RadioGroup mode = findViewById(R.id.cfg_cd_mode);
      Spinner spinner = findViewById(R.id.cfg_cd_spinner);
      EditText title = findViewById(R.id.cfg_cd_title);
      EditText time = findViewById(R.id.cfg_cd_time);

      JSONObject o = new JSONObject();
      if (mode.getCheckedRadioButtonId() == R.id.cfg_cd_task) {
        int idx = spinner.getSelectedItemPosition();
        o.put("mode", "task");
        o.put("activityId", (idx >= 0 && idx < activityIds.length) ? activityIds[idx] : "");
      } else if (mode.getCheckedRadioButtonId() == R.id.cfg_cd_custom) {
        o.put("mode", "custom");
        o.put("title", title.getText().toString().trim());
        long ms = WidgetStore.parseDateTimeMs(time.getText().toString().trim());
        o.put("target", ms);
      } else {
        o.put("mode", "next");
      }
      WidgetStore.writeCountdownConfig(this, appWidgetId, o);
    } catch (Exception ignored) {}
  }

  /** 该 appWidgetId 属于哪个 Provider（先查系统 provider info，再退回 id 反查） */
  private Class<?> owningProvider() {
    AppWidgetManager mgr = AppWidgetManager.getInstance(this);
    try {
      android.appwidget.AppWidgetProviderInfo info = mgr.getAppWidgetInfo(appWidgetId);
      if (info != null && info.provider != null) {
        String cn = info.provider.getClassName();
        if (cn.endsWith("CountdownWidgetProvider")) return CountdownWidgetProvider.class;
        if (cn.endsWith("FocusStopwatchProvider")) return FocusStopwatchProvider.class;
        if (cn.endsWith("HomeTodayWidgetProvider")) return HomeTodayWidgetProvider.class;
        if (cn.endsWith("TodayWidgetProvider")) return TodayWidgetProvider.class;
        if (cn.endsWith("ResourcesWidgetProvider")) return ResourcesWidgetProvider.class;
        if (cn.endsWith("GoalsWidgetProvider")) return GoalsWidgetProvider.class;
        if (cn.endsWith("GoodsWidgetProvider")) return GoodsWidgetProvider.class;
      }
    } catch (Exception ignored) {}
    Class<?>[] providers = {
        TodayWidgetProvider.class, HomeTodayWidgetProvider.class, ResourcesWidgetProvider.class,
        GoalsWidgetProvider.class, GoodsWidgetProvider.class, CountdownWidgetProvider.class,
        FocusStopwatchProvider.class };
    for (Class<?> cls : providers) {
      int[] ids = mgr.getAppWidgetIds(new ComponentName(this, cls));
      for (int id : ids) {
        if (id == appWidgetId) return cls;
      }
    }
    return null;
  }

  private void refreshOwningProvider(Class<?> cls) {
    if (cls == null) return;
    AppWidgetManager mgr = AppWidgetManager.getInstance(this);
    try {
      if (cls == TodayWidgetProvider.class) TodayWidgetProvider.updateOne(this, mgr, appWidgetId);
      else if (cls == HomeTodayWidgetProvider.class) HomeTodayWidgetProvider.updateOne(this, mgr, appWidgetId);
      else if (cls == ResourcesWidgetProvider.class) ResourcesWidgetProvider.updateOne(this, mgr, appWidgetId);
      else if (cls == GoalsWidgetProvider.class) GoalsWidgetProvider.updateOne(this, mgr, appWidgetId);
      else if (cls == GoodsWidgetProvider.class) GoodsWidgetProvider.updateOne(this, mgr, appWidgetId);
      else if (cls == CountdownWidgetProvider.class) CountdownWidgetProvider.updateOne(this, mgr, appWidgetId);
      else if (cls == FocusStopwatchProvider.class) FocusStopwatchProvider.refreshOne(this, appWidgetId);
    } catch (Exception ignored) {}
  }
}
