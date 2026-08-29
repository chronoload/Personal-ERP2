package com.personal.erp.widget;

import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Bundle;
import android.widget.Button;
import android.widget.RadioGroup;
import androidx.appcompat.app.AppCompatActivity;
import com.personal.erp.R;
import org.json.JSONObject;

/**
 * 小组件配置页：添加/编辑小组件时选择主题（浅色/深色）。
 * 配置存 SharedPreferences("CapacitorStorage") 的 widget_config（KEY_CONFIG）：{ dark: bool }
 * 保存后仅刷新该 id 归属的那个 Provider，避免用错误布局渲染其他类型小组件。
 */
public class WidgetConfigureActivity extends AppCompatActivity {
  private int appWidgetId = AppWidgetManager.INVALID_APPWIDGET_ID;

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

    // 预填当前配置
    boolean dark = WidgetStore.isDarkTheme(this);
    RadioGroup theme = findViewById(R.id.cfg_theme);
    if (dark) theme.check(R.id.cfg_theme_dark);
    else theme.check(R.id.cfg_theme_light);

    Button save = findViewById(R.id.cfg_save);
    save.setOnClickListener(v -> {
      boolean isDark = theme.getCheckedRadioButtonId() == R.id.cfg_theme_dark;
      try {
        JSONObject o = new JSONObject();
        o.put("dark", isDark);
        SharedPreferences sp = getSharedPreferences(WidgetKeys.PREFS_FILE, Context.MODE_PRIVATE);
        sp.edit().putString(WidgetKeys.KEY_CONFIG, o.toString()).apply();
      } catch (Exception ignored) {}
      refreshOwningProvider();
      Intent result = new Intent();
      result.putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, appWidgetId);
      setResult(RESULT_OK, result);
      finish();
    });
  }

  /** 找到拥有该 appWidgetId 的 Provider，只刷新它 */
  private void refreshOwningProvider() {
    AppWidgetManager mgr = AppWidgetManager.getInstance(this);
    Class<?>[] providers = { TodayWidgetProvider.class, ResourcesWidgetProvider.class, GoalsWidgetProvider.class, GoodsWidgetProvider.class };
    for (Class<?> cls : providers) {
      int[] ids = mgr.getAppWidgetIds(new ComponentName(this, cls));
      for (int id : ids) {
        if (id != appWidgetId) continue;
        try {
          if (cls == TodayWidgetProvider.class) TodayWidgetProvider.updateOne(this, mgr, id);
          else if (cls == ResourcesWidgetProvider.class) ResourcesWidgetProvider.updateOne(this, mgr, id);
          else if (cls == GoalsWidgetProvider.class) GoalsWidgetProvider.updateOne(this, mgr, id);
          else if (cls == GoodsWidgetProvider.class) GoodsWidgetProvider.updateOne(this, mgr, id);
        } catch (Exception ignored) {}
        return;
      }
    }
  }
}