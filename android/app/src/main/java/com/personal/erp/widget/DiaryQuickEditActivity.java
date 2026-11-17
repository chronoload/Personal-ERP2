package com.personal.erp.widget;

import android.app.Activity;
import android.os.Bundle;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.EditText;
import android.widget.TextView;
import android.widget.Toast;

import com.personal.erp.R;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.Calendar;

/**
 * 桌面「日记小组件」直接编辑：Dialog 主题，不启动主界面。
 * 写入原生 db 后登记 native_journals，App 回前台按 rev 回读并合并，不丢内容。
 */
public class DiaryQuickEditActivity extends Activity {

  private static final String EXTRA_DATE = "erp_diary_date";

  private JSONObject db;
  private String key = "";

  @Override
  protected void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    setContentView(R.layout.activity_diary_quick);

    db = WidgetStore.readDB(this);
    key = normalizeKey(getIntent().getStringExtra(EXTRA_DATE));
    if (key.isEmpty()) key = WidgetStore.todayKey();

    EditText body = findViewById(R.id.dqe_body);
    TextView date = findViewById(R.id.dqe_date);
    TextView hint = findViewById(R.id.dqe_hint);
    date.setText(dayLabel(key));

    if (db == null) {
      hint.setText("还没有本机数据：先打开一次应用完成同步。");
      body.setEnabled(false);
      findViewById(R.id.dqe_save).setEnabled(false);
    } else {
      JSONObject j = findJournal(db, key);
      body.setText(j == null ? "" : j.optString("md", ""));
      hint.setText(j == null ? "这天还没有日记，直接写第一条。" : "保存后同步到应用日记页。");
    }

    // 打开即聚焦并弹键盘，少一步点击
    body.requestFocus();
    getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_STATE_VISIBLE
        | WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE);

    findViewById(R.id.dqe_cancel).setOnClickListener(v -> finish());
    ((Button) findViewById(R.id.dqe_save)).setOnClickListener(v -> save(body));
  }

  private void save(EditText body) {
    if (db == null) {
      Toast.makeText(this, "先打开应用同步数据", Toast.LENGTH_SHORT).show();
      return;
    }
    String text = body.getText().toString();
    try {
      JSONArray list = db.optJSONArray("journals");
      if (list == null) { list = new JSONArray(); db.put("journals", list); }

      JSONObject existing = findJournal(db, key);
      String id;
      if (existing != null) {
        existing.put("md", text);
        id = existing.optString("id", "");
        if (!existing.has("parses")) existing.put("parses", new JSONArray());
      } else {
        if (text.trim().isEmpty()) { finish(); return; } // 空白不新建
        JSONObject seq = db.optJSONObject("seq");
        if (seq == null) { seq = new JSONObject(); db.put("seq", seq); }
        int n = seq.optInt("j", 0) + 1;
        seq.put("j", n);
        id = "j" + n;
        JSONObject j = new JSONObject();
        j.put("id", id);
        j.put("date", key);
        j.put("md", text);
        j.put("parses", new JSONArray());
        list.put(j);
      }

      JSONArray nativeIds = db.optJSONArray("native_journals");
      if (nativeIds == null) { nativeIds = new JSONArray(); db.put("native_journals", nativeIds); }
      if (!contains(nativeIds, id)) nativeIds.put(id);

      WidgetStore.writeDB(this, db); // rev++ → App 回前台回读
      DiaryWidgetProvider.refreshAll(this);
      Toast.makeText(this, "已保存", Toast.LENGTH_SHORT).show();
      setResult(RESULT_OK);
      finish();
    } catch (Exception e) {
      Toast.makeText(this, "保存失败：" + e.getMessage(), Toast.LENGTH_SHORT).show();
    }
  }

  private static boolean contains(JSONArray arr, String v) {
    for (int i = 0; i < arr.length(); i++) {
      if (v.equals(arr.optString(i))) return true;
    }
    return false;
  }

  /** 按日键（YYYY-M-D 不补零）找日记条目 */
  private static JSONObject findJournal(JSONObject db, String key) {
    JSONArray list = db.optJSONArray("journals");
    if (list == null) return null;
    for (int i = 0; i < list.length(); i++) {
      JSONObject j = list.optJSONObject(i);
      if (j == null) continue;
      if (key.equals(normalizeKey(j.optString("date", "")))) return j;
    }
    return null;
  }

  private static String normalizeKey(String s) {
    try {
      String day = String.valueOf(s).split("T")[0].split(" ")[0];
      String[] p = day.split("-");
      return Integer.parseInt(p[0]) + "-" + Integer.parseInt(p[1]) + "-" + Integer.parseInt(p[2]);
    } catch (Exception e) { return ""; }
  }

  /** 今天 / 昨天 / 前天 · M月D日 周X */
  private static String dayLabel(String key) {
    try {
      String[] p = key.split("-");
      int y = Integer.parseInt(p[0]);
      int m = Integer.parseInt(p[1]);
      int d = Integer.parseInt(p[2]);
      Calendar c = Calendar.getInstance();
      c.set(y, m - 1, d, 0, 0, 0);
      c.set(Calendar.MILLISECOND, 0);
      Calendar t = Calendar.getInstance();
      t.set(Calendar.HOUR_OF_DAY, 0);
      t.set(Calendar.MINUTE, 0);
      t.set(Calendar.SECOND, 0);
      t.set(Calendar.MILLISECOND, 0);
      long days = Math.round((t.getTimeInMillis() - c.getTimeInMillis()) / 86400000.0);
      String rel;
      if (days == 0) rel = "今天";
      else if (days == 1) rel = "昨天";
      else if (days == 2) rel = "前天";
      else if (days > 0) rel = days + " 天前";
      else rel = (-days) + " 天后";
      String wd = String.valueOf("日一二三四五六".charAt(c.get(Calendar.DAY_OF_WEEK) - 1));
      return rel + " · " + m + "月" + d + "日 周" + wd;
    } catch (Exception e) { return key; }
  }
}
