package com.personal.erp.lockscreen;

import android.app.KeyguardManager;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.WindowManager;
import android.widget.TextView;
import androidx.appcompat.app.AppCompatActivity;

import com.personal.erp.MainActivity;
import com.personal.erp.R;
import com.personal.erp.widget.WidgetStore;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * 亮屏开屏页：由通知的 fullScreenIntent 拉起，整页展示今日日程。
 *  -「＋ 添加今日日程」→ App 新建（日期预填今天）
 *  -「解锁查看」→ 请求解除锁屏并进入 App
 *  -「关闭」→ 收起本页，锁屏通知仍在
 * Android 8.0 以下用窗口标志；8.1+ 用 setShowWhenLocked / setTurnScreenOn。
 */
public class LockScreenActivity extends AppCompatActivity {

  @Override
  protected void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    showOverLockscreen();
    setContentView(R.layout.activity_lock_screen);
    bind();
  }

  private void showOverLockscreen() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
      setShowWhenLocked(true);
      setTurnScreenOn(true);
    } else {
      getWindow().addFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED
          | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON);
    }
    getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
  }

  private void bind() {
    TextView title = findViewById(R.id.lock_title);
    TextView sub = findViewById(R.id.lock_sub);
    TextView empty = findViewById(R.id.lock_empty);
    TextView add = findViewById(R.id.lock_add);
    TextView open = findViewById(R.id.lock_open);
    TextView close = findViewById(R.id.lock_close);
    TextView more = findViewById(R.id.lock_more);

    int[] rowIds = {R.id.lock_row1, R.id.lock_row2, R.id.lock_row3, R.id.lock_row4, R.id.lock_row5};
    TextView[] rows = new TextView[rowIds.length];
    for (int i = 0; i < rowIds.length; i++) rows[i] = findViewById(rowIds[i]);

    JSONObject db = WidgetStore.readDB(this);
    JSONArray board = WidgetStore.getBoard(db);
    int n = board.length();
    int todayCount = 0;
    for (int i = 0; i < n; i++) {
      JSONObject it = board.optJSONObject(i);
      if (it != null && "today".equals(it.optString("kind"))) todayCount++;
    }
    int runningN = WidgetStore.boardRunningCount(board);
    int pendingN = WidgetStore.boardPendingCount(board);
    if (n == 0) title.setText("今日日程");
    else if (runningN > 0) title.setText(pendingN > 0 ? "进行中 " + runningN + " · 待办 " + pendingN : "进行中 " + runningN);
    else if (pendingN == 0 && todayCount == 0) title.setText("今日无安排 · 待排 " + WidgetStore.backlogCount(db));
    else if (pendingN == 0) title.setText("今日已完成");
    else title.setText("今日日程");
    sub.setText(WidgetStore.fmtTodayLabel() + (n == 0 ? "" : " · 待办 " + pendingN + "/" + todayCount));

    if (n == 0) {
      empty.setText("快来添加今天的日程 —— 点下方按钮");
      empty.setVisibility(View.VISIBLE);
      more.setVisibility(View.GONE);
      for (TextView r : rows) r.setVisibility(View.GONE);
    } else {
      empty.setVisibility(View.GONE);
      int show = Math.min(rows.length, n);
      for (int i = 0; i < rows.length; i++) {
        if (i >= show) { rows[i].setVisibility(View.GONE); continue; }
        JSONObject it = board.optJSONObject(i);
        String kind = it == null ? "today" : it.optString("kind", "today");
        JSONObject a = it == null ? null : it.optJSONObject("act");
        boolean done = !WidgetStore.isOpenActivity(a);
        rows[i].setText(line(a, done, kind));
        rows[i].setTextColor(done ? 0xFF8A93A3
            : ("running".equals(kind) ? 0xFF3DA06A
              : ("overdue".equals(kind) ? 0xFFE0B27A : ("unscheduled".equals(kind) ? 0xFF9AA6B8 : 0xFFE8EBF0))));
        rows[i].setVisibility(View.VISIBLE);
      }
      more.setVisibility(n > rows.length ? View.VISIBLE : View.GONE);
      if (n > rows.length) more.setText("还有 " + (n - rows.length) + " 条 · 解锁查看全部");
    }

    add.setOnClickListener(v -> {
      Intent i = new Intent(this, MainActivity.class);
      i.putExtra("erp_tab", "overview");
      i.putExtra("erp_fresh", true);
      i.putExtra("erp_fresh_date", WidgetStore.todayKey());
      i.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
      startActivity(i);
      finish();
    });

    open.setOnClickListener(v -> {
      try {
        KeyguardManager km = (KeyguardManager) getSystemService(Context.KEYGUARD_SERVICE);
        if (km != null) km.requestDismissKeyguard(this, null);
      } catch (Exception ignored) {}
      Intent i = new Intent(this, MainActivity.class);
      i.putExtra("erp_tab", "overview");
      i.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
      startActivity(i);
      finish();
    });

    close.setOnClickListener(v -> finish());
  }

  private static String line(JSONObject a, boolean done, String kind) {
    if (a == null) return "";
    String clock = "";
    String ps = WidgetStore.clockOf(a);
    int t = ps.indexOf('T');
    if (t >= 0 && t + 1 < ps.length()) clock = ps.substring(t + 1);
    String title = a.optString("title", "—");
    if ("running".equals(kind)) title = "进行中 · " + title;
    else if ("overdue".equals(kind)) title = "延期 · " + title;
    else if ("unscheduled".equals(kind)) title = "待排 · " + title;
    int tracked = WidgetStore.trackedMinutes(a);
    StringBuilder sb = new StringBuilder();
    sb.append(done ? "✓ " : ("running".equals(kind) ? "● " : "○ "));
    if (!clock.isEmpty()) sb.append(clock).append("  ");
    sb.append(title);
    if (tracked > 0) sb.append(" · ").append(tracked).append("m");
    return sb.toString();
  }
}
