package com.personal.erp.sync;

import android.content.Context;
import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

/**
 * 安卓内置 MCP 端点：POST /mcp（MCP JSON-RPC 2.0，单次请求/单次响应）。
 *
 * 数据与 App 共用应用私有目录的 erp-db.json（JS 侧 Capacitor Filesystem 写出），
 * 语义与桌面版 mcp/server.mjs 一致：
 *   · 总开关：db.mcp.enabled !== true → 一切工具返回 ERR_AUTH_DENIED；
 *   · 只追加：只提供 add_* / append_*，没有 update / delete；
 *   · 结果信封：{ok, tool, version, data|error}。
 */
public class McpEndpoint {
  private static final String FILE = "erp-db.json";
  private static final String VERSION = "1.0";
  private static final String[] KNOWN_VERSIONS = {"2024-11-05", "2025-03-26", "2025-06-18", "2025-11-25"};
  private static final String LATEST_VERSION = "2025-11-25";
  private static final String[] CORE = {
      "resources", "rules", "goals", "plans", "activities",
      "txs", "outputs", "valueflows", "goods", "journals",
      "places", "commutes", "templates"
  };

  private final Context ctx;

  public McpEndpoint(Context ctx) { this.ctx = ctx; }

  // ---------------- JSON-RPC ----------------

  public String handle(String body) {
    JSONObject msg;
    try { msg = new JSONObject(body == null ? "" : body); }
    catch (Exception e) { return rpcError(null, -32700, "Parse error"); }
    Object id = msg.opt("id");
    boolean hasId = msg.has("id");
    String method = msg.optString("method", null);
    if (method == null) return hasId ? rpcError(id, -32600, "Invalid Request") : null;
    if (!hasId) return null; // notifications/*
    JSONObject params = msg.optJSONObject("params");
    if (params == null) params = new JSONObject();
    switch (method) {
      case "initialize": {
        String asked = params.optString("protocolVersion", "");
        String version = LATEST_VERSION;
        for (String v : KNOWN_VERSIONS) if (v.equals(asked)) { version = asked; break; }
        JSONObject result = new JSONObject();
        try {
          result.put("protocolVersion", version);
          JSONObject tools = new JSONObject().put("listChanged", false);
          result.put("capabilities", new JSONObject().put("tools", tools));
          result.put("serverInfo", new JSONObject().put("name", "personal-erp").put("version", VERSION));
        } catch (Exception ignored) {}
        return rpcResult(id, result);
      }
      case "ping":
        return rpcResult(id, new JSONObject());
      case "tools/list": {
        JSONObject result = new JSONObject();
        try { result.put("tools", new Tools().list()); } catch (Exception ignored) {}
        return rpcResult(id, result);
      }
      case "tools/call": {
        String name = params.optString("name", "");
        if (name.isEmpty()) return rpcError(id, -32602, "tools/call 需要工具名");
        JSONObject args = params.optJSONObject("arguments");
        if (args == null) args = new JSONObject();
        JSONObject envelope = new Tools().call(name, args);
        JSONObject result = new JSONObject();
        try {
          JSONArray content = new JSONArray();
          content.put(new JSONObject().put("type", "text").put("text", envelope.toString()));
          result.put("content", content);
          result.put("isError", !envelope.optBoolean("ok", false));
        } catch (Exception ignored) {}
        return rpcResult(id, result);
      }
      default:
        return rpcError(id, -32601, "Method not found: " + method);
    }
  }

  private static String rpcResult(Object id, JSONObject result) {
    try {
      return new JSONObject().put("jsonrpc", "2.0").put("id", id).put("result", result).toString();
    } catch (Exception e) { return rpcError(id, -32603, "Internal error"); }
  }

  private static String rpcError(Object id, int code, String message) {
    try {
      JSONObject err = new JSONObject().put("code", code).put("message", message);
      return new JSONObject().put("jsonrpc", "2.0").put("id", id).put("error", err).toString();
    } catch (Exception e) { return "{\"jsonrpc\":\"2.0\",\"id\":null,\"error\":{\"code\":-32603,\"message\":\"Internal error\"}}"; }
  }

  // ---------------- 数据文件 ----------------

  private File dbFile() { return new File(ctx.getFilesDir(), FILE); }

  /** 读库；文件不存在 / 解析失败 → null */
  JSONObject readDb() {
    File f = dbFile();
    if (!f.exists()) return null;
    try {
      String raw = new String(Files.readAllBytes(f.toPath()), StandardCharsets.UTF_8);
      JSONObject obj = new JSONObject(raw);
      JSONObject db = (obj.optJSONObject("db") != null && obj.getJSONObject("db").optJSONArray("resources") != null)
          ? obj.getJSONObject("db") : obj;
      if (db.optJSONArray("resources") == null) return null;
      ensureShape(db);
      return db;
    } catch (Exception e) { return null; }
  }

  /** 写库：备份旧文件 → 临时文件 → 原子替换 */
  void writeDb(JSONObject db) throws Exception {
    ensureShape(db);
    JSONObject payload = new JSONObject();
    payload.put("app", "personal-erp");
    payload.put("version", 1);
    payload.put("exportedAt", isoNow());
    payload.put("db", db);
    File f = dbFile();
    File dir = f.getParentFile();
    if (dir != null) dir.mkdirs();
    if (f.exists()) {
      try { Files.copy(f.toPath(), new File(f.getPath() + ".bak").toPath(), java.nio.file.StandardCopyOption.REPLACE_EXISTING); }
      catch (Exception ignored) {}
    }
    File tmp = new File(f.getPath() + ".tmp");
    Files.write(tmp.toPath(), payload.toString().getBytes(StandardCharsets.UTF_8));
    Files.move(tmp.toPath(), f.toPath(), java.nio.file.StandardCopyOption.REPLACE_EXISTING);
  }

  private static void ensureShape(JSONObject db) throws Exception {
    for (String k : CORE) if (db.optJSONArray(k) == null) db.put(k, new JSONArray());
    if (db.optJSONObject("seq") == null) db.put("seq", new JSONObject());
  }

  private static String isoNow() {
    SimpleDateFormat f = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US);
    return f.format(new Date());
  }

  // ---------------- 工具实现 ----------------

  class Tools {
    JSONArray list() throws Exception {
      JSONArray tools = new JSONArray();
      tools.put(tool("erp.status", "整体状态：资源余额、目标/计划/活动/流水数量、建议预算与资本锁定情况。", "{}"));
      tools.put(tool("erp.goals", "列出目标及其下的计划。", "{\"includeArchived\":{\"type\":\"boolean\"}}"));
      tools.put(tool("erp.activities", "列出活动；可按日期、状态、计划过滤。", "{\"date\":{\"type\":\"string\"},\"status\":{\"type\":\"string\"},\"planId\":{\"type\":\"string\"},\"limit\":{\"type\":\"integer\"}}"));
      tools.put(tool("erp.transactions", "最近的收支流水（按时间倒序）。", "{\"limit\":{\"type\":\"integer\"},\"resource\":{\"type\":\"string\"}}"));
      tools.put(tool("erp.journal", "读取某一天的日记 Markdown（默认今天）。", "{\"date\":{\"type\":\"string\"}}"));
      tools.put(tool("erp.add_goal", "新建目标（只追加）。", "{\"title\":{\"type\":\"string\"},\"desc\":{\"type\":\"string\"}}"));
      tools.put(tool("erp.add_plan", "在指定目标下新建计划（只追加）。", "{\"goalId\":{\"type\":\"string\"},\"title\":{\"type\":\"string\"},\"budget\":{\"type\":\"number\"},\"priority\":{\"type\":\"integer\"},\"horizonMonths\":{\"type\":\"integer\"}}"));
      tools.put(tool("erp.add_activity", "新建活动（只追加）。", "{\"title\":{\"type\":\"string\"},\"planId\":{\"type\":\"string\"},\"date\":{\"type\":\"string\"},\"start\":{\"type\":\"string\"},\"minutes\":{\"type\":\"integer\"},\"repeat\":{\"type\":\"string\"},\"note\":{\"type\":\"string\"}}"));
      tools.put(tool("erp.add_tx", "记一笔收支（只追加）。", "{\"direction\":{\"type\":\"string\"},\"amount\":{\"type\":\"number\"},\"resource\":{\"type\":\"string\"},\"note\":{\"type\":\"string\"}}"));
      tools.put(tool("erp.append_journal", "把一段 Markdown 追加到某天日记末尾。", "{\"text\":{\"type\":\"string\"},\"date\":{\"type\":\"string\"}}"));
      return tools;
    }

    private JSONObject tool(String name, String desc, String propsJson) throws Exception {
      JSONObject t = new JSONObject();
      t.put("name", name);
      t.put("description", desc);
      JSONObject schema = new JSONObject();
      schema.put("type", "object");
      schema.put("properties", new JSONObject(propsJson));
      t.put("inputSchema", schema);
      return t;
    }

    JSONObject call(String name, JSONObject args) {
      JSONObject db = readDb();
      if (db == null) return err(name, "ERR_NO_DATA", "未找到数据文件 erp-db.json（在 App 里先保存一次数据）");
      JSONObject mcp = db.optJSONObject("mcp");
      if (mcp == null || !mcp.optBoolean("enabled", false)) {
        return err(name, "ERR_AUTH_DENIED", "外部访问已关闭：请在 App「设置 › 外部访问 · MCP / 脚本」中打开开关后重试。");
      }
      try {
        switch (name) {
          case "erp.status": return ok(name, status(db), null);
          case "erp.goals": return ok(name, goals(db, args.optBoolean("includeArchived", false)), null);
          case "erp.activities": return ok(name, activities(db, args), null);
          case "erp.transactions": return ok(name, txs(db, args), null);
          case "erp.journal": return ok(name, journal(db, args), null);
          case "erp.add_goal": return append(name, db, addGoal(db, args));
          case "erp.add_plan": return append(name, db, addPlan(db, args));
          case "erp.add_activity": return append(name, db, addActivity(db, args));
          case "erp.add_tx": return append(name, db, addTx(db, args));
          case "erp.append_journal": return append(name, db, appendJournal(db, args));
          default: return err(name, "ERR_VALIDATION", "未知工具：" + name);
        }
      } catch (Exception e) {
        return err(name, "ERR_INTERNAL", e.getMessage() == null ? e.toString() : e.getMessage());
      }
    }
  }

  // ---- 只读 ----

  private JSONObject status(JSONObject db) throws Exception {
    JSONArray resources = db.optJSONArray("resources");
    JSONObject data = new JSONObject();
    data.put("file", dbFile().getAbsolutePath());
    data.put("schemaVersion", db.optInt("schemaVersion", 0));
    data.put("resources", resourceBalances(resources, db.optJSONArray("txs")));
    JSONObject counts = new JSONObject();
    counts.put("goals", len(db, "goals"));
    counts.put("plans", len(db, "plans"));
    counts.put("activities", len(db, "activities"));
    counts.put("transactions", len(db, "txs"));
    counts.put("journals", len(db, "journals"));
    data.put("counts", counts);
    JSONObject budget = new JSONObject();
    budget.put("recommended", 0); // 预算模型在 JS 侧；安卓端点先只给计数
    budget.put("addLocked", db.optBoolean("capitalLock", false));
    data.put("budget", budget);
    return data;
  }

  private static JSONArray resourceBalances(JSONArray resources, JSONArray txs) throws Exception {
    JSONArray out = new JSONArray();
    if (resources == null) return out;
    for (int i = 0; i < resources.length(); i++) {
      JSONObject r = resources.getJSONObject(i);
      double bal = r.optDouble("initial", 0);
      if (txs != null) {
        for (int j = 0; j < txs.length(); j++) {
          JSONObject t = txs.getJSONObject(j);
          if (!r.optString("id").equals(t.optString("resource_id"))) continue;
          bal += t.optDouble("debit", 0) - t.optDouble("credit", 0);
        }
      }
      JSONObject row = new JSONObject();
      row.put("id", r.optString("id"));
      row.put("name", r.optString("name"));
      row.put("unit", r.optString("unit", ""));
      row.put("status", r.optString("status", "Active"));
      row.put("balance", Math.round(bal * 100) / 100.0);
      out.put(row);
    }
    return out;
  }

  private JSONArray goals(JSONObject db, boolean includeArchived) throws Exception {
    JSONArray out = new JSONArray();
    JSONArray goals = db.optJSONArray("goals");
    JSONArray plans = db.optJSONArray("plans");
    if (goals == null) return out;
    for (int i = 0; i < goals.length(); i++) {
      JSONObject g = goals.getJSONObject(i);
      if (!includeArchived && "Archived".equals(g.optString("status"))) continue;
      JSONObject row = new JSONObject();
      row.put("id", g.optString("id"));
      row.put("title", g.optString("title"));
      row.put("status", g.optString("status", "Active"));
      row.put("desc", g.optString("desc", ""));
      JSONArray sub = new JSONArray();
      if (plans != null) {
        for (int j = 0; j < plans.length(); j++) {
          JSONObject p = plans.getJSONObject(j);
          if (!g.optString("id").equals(p.optString("goal_id"))) continue;
          JSONObject pr = new JSONObject();
          pr.put("id", p.optString("id"));
          pr.put("title", p.optString("title"));
          pr.put("status", p.optString("status", "Incubating"));
          pr.put("budget", p.isNull("budget") ? null : p.optDouble("budget", 0));
          pr.put("priority", p.optInt("priority", 3));
          pr.put("horizonMonths", p.optInt("horizonMonths", 3));
          sub.put(pr);
        }
      }
      row.put("plans", sub);
      out.put(row);
    }
    return out;
  }

  private JSONArray activities(JSONObject db, JSONObject args) throws Exception {
    String day = args.has("date") ? normDay(args.optString("date")) : null;
    if (args.has("date") && day == null) throw new IllegalArgumentException("日期无法识别：" + args.optString("date"));
    String status = args.optString("status", null);
    String planId = args.optString("planId", null);
    int limit = Math.max(1, Math.min(200, args.optInt("limit", 50)));
    JSONArray out = new JSONArray();
    JSONArray list = db.optJSONArray("activities");
    if (list == null) return out;
    for (int i = 0; i < list.length() && out.length() < limit; i++) {
      JSONObject a = list.getJSONObject(i);
      if (day != null && !day.equals(activityDay(a))) continue;
      if (status != null && !status.isEmpty() && !status.equals(a.optString("status"))) continue;
      if (planId != null && !planId.isEmpty()) {
        JSONArray ids = a.optJSONArray("plan_ids");
        boolean hit = false;
        if (ids != null) for (int j = 0; j < ids.length(); j++) if (planId.equals(ids.optString(j))) hit = true;
        if (!hit) continue;
      }
      JSONObject row = new JSONObject();
      row.put("id", a.optString("id"));
      row.put("title", a.optString("title"));
      row.put("status", a.optString("status", "Planned"));
      row.put("planned_date", a.isNull("planned_date") ? null : a.optString("planned_date"));
      row.put("planned_start", a.isNull("planned_start") ? null : a.optString("planned_start"));
      row.put("planned_minutes", a.optInt("planned_minutes", 0));
      row.put("repeat", a.isNull("repeat") ? null : a.optString("repeat"));
      row.put("plan_ids", a.optJSONArray("plan_ids") == null ? new JSONArray() : a.optJSONArray("plan_ids"));
      row.put("note", a.optString("note", ""));
      out.put(row);
    }
    return out;
  }

  private JSONArray txs(JSONObject db, JSONObject args) throws Exception {
    int limit = Math.max(1, Math.min(200, args.optInt("limit", 30)));
    String res = args.optString("resource", null);
    String rid = res != null && !res.isEmpty() ? resolveResource(db, res) : null;
    if (res != null && !res.isEmpty() && rid == null) throw new IllegalArgumentException("资源不存在：" + res);
    JSONArray out = new JSONArray();
    JSONArray list = db.optJSONArray("txs");
    if (list == null) return out;
    for (int i = list.length() - 1; i >= 0 && out.length() < limit; i--) {
      JSONObject t = list.getJSONObject(i);
      if (rid != null && !rid.equals(t.optString("resource_id"))) continue;
      JSONObject row = new JSONObject();
      row.put("id", t.optString("id"));
      row.put("resource", resourceName(db, t.optString("resource_id")));
      row.put("direction", t.optDouble("debit", 0) > 0 ? "income" : "expense");
      row.put("amount", Math.abs(t.optDouble("debit", 0) - t.optDouble("credit", 0)));
      row.put("note", t.optString("note", ""));
      row.put("created", t.optLong("created", 0));
      out.put(row);
    }
    return out;
  }

  private JSONObject journal(JSONObject db, JSONObject args) throws Exception {
    String key = args.has("date") ? normDay(args.optString("date")) : todayKey();
    if (key == null) throw new IllegalArgumentException("日期无法识别：" + args.optString("date"));
    JSONObject j = findJournal(db, key);
    JSONObject data = new JSONObject();
    data.put("date", key);
    data.put("md", j == null ? "" : j.optString("md", ""));
    data.put("exists", j != null);
    return data;
  }

  // ---- 追加写 ----

  private JSONObject addGoal(JSONObject db, JSONObject args) throws Exception {
    String title = args.optString("title", "").trim();
    if (title.isEmpty()) throw new IllegalArgumentException("title 必填");
    JSONObject g = new JSONObject();
    g.put("id", nextId(db, "g"));
    g.put("title", title);
    g.put("desc", args.optString("desc", "").trim());
    g.put("status", "Active");
    g.put("created", System.currentTimeMillis());
    db.getJSONArray("goals").put(g);
    JSONObject data = new JSONObject().put("id", g.optString("id")).put("title", title).put("status", "Active");
    return data;
  }

  private JSONObject addPlan(JSONObject db, JSONObject args) throws Exception {
    String goalId = args.optString("goalId", "").trim();
    String title = args.optString("title", "").trim();
    if (goalId.isEmpty()) throw new IllegalArgumentException("goalId 必填");
    if (title.isEmpty()) throw new IllegalArgumentException("title 必填");
    if (db.optBoolean("capitalLock", false)) throw new IllegalArgumentException("资本锁定中：请先清理死账或归档/完成部分计划");
    if (!hasId(db.optJSONArray("goals"), goalId)) throw new IllegalArgumentException("所属目标不存在");
    if (args.has("budget") && !args.isNull("budget") && args.optDouble("budget", 0) < 0) {
      throw new IllegalArgumentException("budget 必须 ≥ 0 或省略");
    }
    JSONObject p = new JSONObject();
    p.put("id", nextId(db, "p"));
    p.put("goal_id", goalId);
    p.put("title", title);
    p.put("budget", args.isNull("budget") || !args.has("budget") ? null : args.optDouble("budget", 0));
    p.put("color", null);
    p.put("priority", clamp(args.optInt("priority", 3), 1, 5));
    p.put("horizonMonths", clamp(args.optInt("horizonMonths", 3), 1, 36));
    p.put("budgetState", "active");
    p.put("frozenAt", null);
    p.put("status", "Incubating");
    p.put("created", System.currentTimeMillis());
    p.put("default_expenses", new JSONArray());
    p.put("default_incomes", new JSONArray());
    db.getJSONArray("plans").put(p);
    JSONObject data = new JSONObject().put("id", p.optString("id")).put("title", title)
        .put("goal_id", goalId).put("status", "Incubating");
    return data;
  }

  private JSONObject addActivity(JSONObject db, JSONObject args) throws Exception {
    String title = args.optString("title", "").trim();
    if (title.isEmpty()) throw new IllegalArgumentException("title 必填");
    if (db.optBoolean("capitalLock", false)) throw new IllegalArgumentException("资本锁定中：请先清理死账或归档/完成部分计划");
    String key = args.has("date") ? normDay(args.optString("date")) : todayKey();
    if (key == null) throw new IllegalArgumentException("日期无法识别：" + args.optString("date"));
    String clock = args.has("start") ? padTime(args.optString("start")) : null;
    if (args.has("start") && clock == null) throw new IllegalArgumentException("钟点无法识别：" + args.optString("start"));
    String repeat = args.optString("repeat", null);
    if (repeat != null && !repeat.isEmpty() && !"daily".equals(repeat) && !"weekday".equals(repeat) && !"weekly".equals(repeat)) {
      throw new IllegalArgumentException("repeat 只支持 daily / weekday / weekly");
    }
    String planId = args.optString("planId", "").trim();
    if (!planId.isEmpty() && !hasId(db.optJSONArray("plans"), planId)) throw new IllegalArgumentException("关联计划不存在");

    JSONObject a = new JSONObject();
    a.put("id", nextId(db, "a"));
    a.put("title", title);
    a.put("note", args.optString("note", "").trim());
    JSONArray planIds = new JSONArray();
    if (!planId.isEmpty()) planIds.put(planId);
    a.put("plan_ids", planIds);
    a.put("planned_start", clock == null ? null : padDay(key) + "T" + clock);
    a.put("planned_date", clock == null ? key : null);
    a.put("planned_minutes", Math.max(0, args.optInt("minutes", 0)));
    a.put("repeat", repeat == null || repeat.isEmpty() ? null : repeat);
    a.put("repeat_until", null);
    a.put("occurrences", new JSONArray());
    a.put("time_logs", new JSONArray());
    a.put("theme", null);
    a.put("place_id", null);
    a.put("depth", args.has("depth") ? args.optBoolean("depth") : null);
    a.put("preset_expenses", new JSONArray());
    a.put("preset_incomes", new JSONArray());
    a.put("conflicts", new JSONArray());
    a.put("actual_start", null);
    a.put("actual_end", null);
    a.put("status", "Planned");
    a.put("failedReason", null);
    a.put("retryCount", 0);
    a.put("maxRetries", 3);
    a.put("created", System.currentTimeMillis());
    db.getJSONArray("activities").put(a);

    JSONObject data = new JSONObject();
    data.put("id", a.optString("id"));
    data.put("title", title);
    data.put("planned_start", a.isNull("planned_start") ? null : a.optString("planned_start"));
    data.put("planned_date", a.isNull("planned_date") ? null : a.optString("planned_date"));
    data.put("status", "Planned");
    return data;
  }

  private JSONObject addTx(JSONObject db, JSONObject args) throws Exception {
    String dir = args.optString("direction", "").toLowerCase(Locale.ROOT);
    boolean income = "income".equals(dir) || "debit".equals(dir);
    boolean expense = "expense".equals(dir) || "credit".equals(dir);
    if (!income && !expense) throw new IllegalArgumentException("direction 只支持 income / expense");
    double amount = args.optDouble("amount", 0);
    if (!(amount > 0)) throw new IllegalArgumentException("amount 必须 > 0");
    String res = args.optString("resource", "");
    String rid = res.isEmpty() ? firstActiveResource(db) : resolveResource(db, res);
    if (rid == null) throw new IllegalArgumentException("资源不存在：" + (res.isEmpty() ? "（无可用资源）" : res));

    JSONObject t = new JSONObject();
    t.put("id", nextId(db, "t"));
    t.put("resource_id", rid);
    t.put("debit", income ? amount : 0);
    t.put("credit", expense ? amount : 0);
    t.put("source_type", "manual");
    t.put("source_id", "manual");
    t.put("note", args.optString("note", "").trim());
    t.put("reversal_of", null);
    t.put("created", System.currentTimeMillis());
    db.getJSONArray("txs").put(t);

    JSONObject data = new JSONObject();
    data.put("id", t.optString("id"));
    data.put("resource_id", rid);
    data.put("debit", t.optDouble("debit", 0));
    data.put("credit", t.optDouble("credit", 0));
    data.put("note", t.optString("note", ""));
    return data;
  }

  private JSONObject appendJournal(JSONObject db, JSONObject args) throws Exception {
    String text = args.optString("text", "");
    if (text.trim().isEmpty()) throw new IllegalArgumentException("text 不能为空");
    String key = args.has("date") ? normDay(args.optString("date")) : todayKey();
    if (key == null) throw new IllegalArgumentException("日期无法识别：" + args.optString("date"));
    JSONObject j = findJournal(db, key);
    if (j == null) {
      j = new JSONObject();
      j.put("id", nextId(db, "j"));
      j.put("date", key);
      j.put("md", "");
      j.put("parses", new JSONArray());
      db.getJSONArray("journals").put(j);
    }
    if (j.optJSONArray("parses") == null) j.put("parses", new JSONArray());
    String prev = j.optString("md", "");
    String next = prev.trim().isEmpty() ? text.trim() + "\n" : prev.replaceAll("\\n+$", "") + "\n\n" + text.trim() + "\n";
    j.put("md", next);
    JSONObject data = new JSONObject();
    data.put("date", key);
    data.put("added", text.trim().length());
    data.put("total", next.length());
    return data;
  }

  // ---------------- 落盘 + 信封 ----------------

  private JSONObject append(String name, JSONObject db, JSONObject data) {
    try {
      writeDb(db);
      return ok(name, data, null);
    } catch (Exception e) {
      return err(name, "ERR_INTERNAL", "写文件失败：" + (e.getMessage() == null ? e.toString() : e.getMessage()));
    }
  }

  private static JSONObject ok(String tool, Object data, JSONArray warnings) {
    JSONObject env = new JSONObject();
    try {
      env.put("ok", true);
      env.put("tool", tool);
      env.put("version", VERSION);
      env.put("data", data);
      if (warnings != null && warnings.length() > 0) env.put("warnings", warnings);
    } catch (Exception ignored) {}
    return env;
  }

  private static JSONObject err(String tool, String code, String message) {
    JSONObject env = new JSONObject();
    try {
      env.put("ok", false);
      env.put("tool", tool);
      env.put("version", VERSION);
      env.put("error", new JSONObject().put("code", code).put("message", message));
    } catch (Exception ignored) {}
    return env;
  }

  // ---------------- 小工具 ----------------

  private static int len(JSONObject db, String key) {
    JSONArray a = db.optJSONArray(key);
    return a == null ? 0 : a.length();
  }

  private static boolean hasId(JSONArray list, String id) throws Exception {
    if (list == null) return false;
    for (int i = 0; i < list.length(); i++) {
      if (id.equals(list.optJSONObject(i) == null ? null : list.optJSONObject(i).optString("id"))) return true;
    }
    return false;
  }

  private static int clamp(int v, int lo, int hi) { return Math.min(hi, Math.max(lo, v)); }

  private String resolveResource(JSONObject db, String nameOrId) throws Exception {
    JSONArray list = db.optJSONArray("resources");
    if (list == null) return null;
    for (int i = 0; i < list.length(); i++) {
      JSONObject r = list.getJSONObject(i);
      if (nameOrId.equals(r.optString("id")) || nameOrId.equals(r.optString("name"))) return r.optString("id");
    }
    return null;
  }

  private static String firstActiveResource(JSONObject db) throws Exception {
    JSONArray list = db.optJSONArray("resources");
    if (list == null) return null;
    for (int i = 0; i < list.length(); i++) {
      JSONObject r = list.getJSONObject(i);
      if (!"Inactive".equals(r.optString("status"))) return r.optString("id");
    }
    return null;
  }

  private static String resourceName(JSONObject db, String rid) throws Exception {
    JSONArray list = db.optJSONArray("resources");
    if (list != null) {
      for (int i = 0; i < list.length(); i++) {
        JSONObject r = list.getJSONObject(i);
        if (rid.equals(r.optString("id"))) return r.optString("name");
      }
    }
    return rid;
  }

  private static JSONObject findJournal(JSONObject db, String key) throws Exception {
    JSONArray list = db.optJSONArray("journals");
    if (list == null) return null;
    for (int i = 0; i < list.length(); i++) {
      JSONObject j = list.getJSONObject(i);
      if (key.equals(normDay(j.optString("date", "")))) return j;
    }
    return null;
  }

  private static String nextId(JSONObject db, String key) {
    try {
      JSONObject seq = db.optJSONObject("seq");
      if (seq == null) { seq = new JSONObject(); db.put("seq", seq); }
      int n = seq.optInt(key, 0) + 1;
      seq.put(key, n);
      return key + n;
    } catch (Exception e) { return key + System.currentTimeMillis(); }
  }

  private static String activityDay(JSONObject a) {
    String start = a.isNull("planned_start") ? null : a.optString("planned_start");
    if (start != null && !start.isEmpty()) return normDay(start);
    String date = a.isNull("planned_date") ? null : a.optString("planned_date");
    return date == null ? null : normDay(date);
  }

  /** YYYY-M-D（不补零，与 App 日记键一致） */
  static String normDay(String s) {
    if (s == null) return null;
    java.util.regex.Matcher m = java.util.regex.Pattern.compile("(\\d{4})-(\\d{1,2})-(\\d{1,2})").matcher(s);
    if (!m.find()) return null;
    return Integer.parseInt(m.group(1)) + "-" + Integer.parseInt(m.group(2)) + "-" + Integer.parseInt(m.group(3));
  }

  static String padDay(String key) {
    java.util.regex.Matcher m = java.util.regex.Pattern.compile("(\\d{4})-(\\d{1,2})-(\\d{1,2})").matcher(key == null ? "" : key);
    if (!m.find()) return null;
    return String.format(Locale.US, "%04d-%02d-%02d", Integer.parseInt(m.group(1)), Integer.parseInt(m.group(2)), Integer.parseInt(m.group(3)));
  }

  static String padTime(String s) {
    if (s == null) return null;
    java.util.regex.Matcher m = java.util.regex.Pattern.compile("(\\d{1,2}):(\\d{2})").matcher(s);
    if (!m.find()) return null;
    int h = Integer.parseInt(m.group(1));
    int mi = Integer.parseInt(m.group(2));
    if (h < 0 || h > 23 || mi < 0 || mi > 59) return null;
    return String.format(Locale.US, "%02d:%02d", h, mi);
  }

  private static String todayKey() {
    java.util.Calendar c = java.util.Calendar.getInstance();
    return c.get(java.util.Calendar.YEAR) + "-" + (c.get(java.util.Calendar.MONTH) + 1) + "-" + c.get(java.util.Calendar.DAY_OF_MONTH);
  }
}
