package com.personal.erp.widget;

import android.app.Activity;
import android.os.Bundle;
import android.view.View;
import android.widget.ArrayAdapter;
import android.widget.Button;
import android.widget.EditText;
import android.widget.Spinner;
import android.widget.TextView;
import android.widget.Toast;

import com.personal.erp.R;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

/**
 * 桌面「＋ 记一条需求」的小弹窗：选择来源 → 写原文 → 直接写进原生 db。
 * 写入后登记 native_demands，App 回前台按 rev 回读时合并，不丢记录。
 */
public class DemandQuickAddActivity extends Activity {

  private JSONObject db;
  private final List<String> ids = new ArrayList<>();
  private Spinner spinner;

  @Override
  protected void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    setContentView(R.layout.activity_demand_quick);
    setTitle("记一条需求");

    db = WidgetStore.readDB(this);
    spinner = findViewById(R.id.dq_requester);
    Button save = findViewById(R.id.dq_save);
    TextView hint = findViewById(R.id.dq_hint);

    List<String> names = new ArrayList<>();
    JSONArray requesters = db != null ? db.optJSONArray("requesters") : null;
    if (requesters != null) {
      for (int i = 0; i < requesters.length(); i++) {
        JSONObject r = requesters.optJSONObject(i);
        if (r == null) continue;
        ids.add(r.optString("id", ""));
        names.add(r.optString("name", "未命名")
            + (r.optString("role", "").isEmpty() ? "" : " · " + r.optString("role", "")));
      }
    }

    if (ids.isEmpty()) {
      hint.setText("还没有来源用户：请先在应用「需求档案」里新增一位，再回来记。");
      save.setEnabled(false);
    } else {
      ArrayAdapter<String> ad = new ArrayAdapter<>(this, android.R.layout.simple_spinner_item, names);
      ad.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item);
      spinner.setAdapter(ad);
      // 预选小组件当前来源
      String want = getIntent().getStringExtra(DemandWidgetProvider.EXTRA_REQUESTER);
      int idx = want == null ? -1 : ids.indexOf(want);
      if (idx >= 0) spinner.setSelection(idx);
    }

    findViewById(R.id.dq_cancel).setOnClickListener(v -> finish());
    save.setOnClickListener(v -> save());
  }

  private void save() {
    EditText textEl = findViewById(R.id.dq_text);
    EditText noteEl = findViewById(R.id.dq_note);
    String text = textEl.getText().toString().trim();
    if (text.isEmpty()) {
      Toast.makeText(this, "先写下他要什么", Toast.LENGTH_SHORT).show();
      return;
    }
    if (db == null || ids.isEmpty()) return;
    try {
      String rid = ids.get(spinner.getSelectedItemPosition());
      JSONArray demands = db.optJSONArray("demands");
      if (demands == null) { demands = new JSONArray(); db.put("demands", demands); }

      JSONObject seq = db.optJSONObject("seq");
      if (seq == null) { seq = new JSONObject(); db.put("seq", seq); }
      int n = seq.optInt("dm", 0) + 1;
      seq.put("dm", n);

      String id = "dm" + n;
      JSONObject d = new JSONObject();
      d.put("id", id);
      d.put("requesterId", rid);
      d.put("text", text);
      d.put("note", noteEl.getText().toString().trim());
      d.put("status", "open");
      d.put("kind", "");
      d.put("targetId", "");
      d.put("createdAt", System.currentTimeMillis());
      demands.put(d);

      JSONArray nativeIds = db.optJSONArray("native_demands");
      if (nativeIds == null) { nativeIds = new JSONArray(); db.put("native_demands", nativeIds); }
      nativeIds.put(id);

      WidgetStore.writeDB(this, db); // rev++ → App 回前台回读
      DemandWidgetProvider.refreshAll(this);
      Toast.makeText(this, "已记下", Toast.LENGTH_SHORT).show();
      setResult(RESULT_OK);
      finish();
    } catch (Exception e) {
      Toast.makeText(this, "记录失败：" + e.getMessage(), Toast.LENGTH_SHORT).show();
    }
  }
}
