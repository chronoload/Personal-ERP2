// ============================================================
// domain/mdimport.js
// 手打 Markdown 批量速录 → ERP 实体候选（纯函数，JSON 仍是唯一存储）。
// 规则 v1（md 约定 → 实体）：
//   frontmatter `default: { plan, minutes }` → 全局默认计划/时长（可选）
//   `# 标题`        → 目标 goal（其后普通段落 = 目标描述，多行）
//   `## 标题`       → 计划 plan（归属最近 # 目标）
//   `- [ ] 正文`    → 待办活动 Planned
//   `- [x] 正文`    → 已完成活动 Completed
//   `- 正文`        → 待办活动 Planned（无排程）
//   活动行内指令：
//     `@ <时间词> <钟点?> <时长?>` → planned_start / planned_minutes
//        时间词：今天/明天/后天/周X/星期X/8-31/2026-8-31；钟点 9:00/9点；时长 60分钟/60m/1小时/1h
//     `(计划标题)`  → 显式归属计划（缺省 → 最近 ##；再无 → default.plan）
//     `#标签`       → 写入 note
// 输出候选：{ goals, plans, activities, warnings }，key 为临时引用（g0/p0/a0），
// 由调用方预览确认后走 engine 创建（分配真实 id）。
// 纯函数、零依赖、时间由调用方注入（不读系统时钟），可 node 测试。
// ============================================================

const DAY_MS = 86400000;
const WEEKDAYS = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 7, 天: 7 };
// 本地日期 → 'YYYY-M-D'
function dateKeyOf(d) {
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

// 可选 frontmatter：`---\n key: value \n---`（value 先试 JSON，失败按字符串；`{...}` 走简易 YAML 对象）
function parseFrontmatter(md) {
  const m = md.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!m) return { fm: {}, rest: md };
  const fm = {};
  const tryJson = (s) => { try { return JSON.parse(s); } catch (e) { return undefined; } };
  for (const line of m[1].split('\n')) {
    const i = line.indexOf(':');
    if (i <= 0) continue;
    const k = line.slice(0, i).trim();
    const v = line.slice(i + 1).trim();
    if (!k) continue;
    let parsed = tryJson(v);
    if (parsed === undefined && /^\{/.test(v)) {
      // 简易 YAML 对象：{ key: value, ... }（键可裸写，中文值可裸写）
      parsed = {};
      for (const seg of v.replace(/^\{/, '').replace(/\}$/, '').split(',')) {
        const j = seg.indexOf(':');
        if (j <= 0) continue;
        const kk = seg.slice(0, j).trim().replace(/['"]/g, '');
        let vv = seg.slice(j + 1).trim();
        const jv = tryJson(vv);
        parsed[kk] = jv !== undefined ? jv : vv.replace(/['"]/g, '');
      }
    }
    fm[k] = parsed !== undefined ? parsed : v;
  }
  return { fm, rest: md.slice(m[0].length) };
}

// 解析活动行内的时长（60分钟/60m/1小时/1h/1.5小时）
// 注意：中文单位后不可用 \b（\b 只认 ASCII word 边界，「分钟」后是中文 → 边界失效）
function parseDuration(cmd) {
  let m = cmd.match(/(\d+(?:\.\d+)?)\s*(分钟|分)/);
  if (m) return Math.max(1, Math.round(Number(m[1])));
  m = cmd.match(/(\d+(?:\.\d+)?)\s*m\b/);
  if (m) return Math.max(1, Math.round(Number(m[1])));
  m = cmd.match(/(\d+(?:\.\d+)?)\s*(小时|时)/);
  if (m) return Math.max(1, Math.round(Number(m[1]) * 60));
  m = cmd.match(/(\d+(?:\.\d+)?)\s*h\b/);
  if (m) return Math.max(1, Math.round(Number(m[1]) * 60));
  return null;
}

// 解析时间指令 → planned_start（'YYYY-M-DTHH:MM'，非零填充），无法解析返回 null
function parseWhen(cmd, now) {
  const base = new Date(now);
  let day = new Date(base.getFullYear(), base.getMonth(), base.getDate()); // 当天 0 点
  let foundDay = false;

  // 完整日期 2026-8-31
  let m = cmd.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) { day = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])); foundDay = true; }
  // 月-日 8-31
  if (!foundDay) {
    m = cmd.match(/(?:^|[^\d])(\d{1,2})-(\d{1,2})(?:[^\d]|$)/);
    if (m && !m[1].includes(':')) { day = new Date(base.getFullYear(), Number(m[1]) - 1, Number(m[2])); foundDay = true; }
  }
  // 今天/明天/后天（大后天优先于后天，防子串抢匹配）
  if (!foundDay) {
    const t = cmd.match(/(大后天|后天|明天|今天)/);
    if (t) { const off = { 今天: 0, 明天: 1, 后天: 2, 大后天: 3 }[t[1]]; day = new Date(day.getTime() + off * DAY_MS); foundDay = true; }
  }
  // 周X/星期X → 「下一个」该星期（今天即该日则今天；下X=+7，下下X=+14）
  if (!foundDay) {
    m = cmd.match(/(下下|下)?(?:周|星期)([一二三四五六日天])/);
    if (m) {
      const target = WEEKDAYS[m[2]];
      const cur = (day.getDay() || 7); // 日=7
      let diff = (target - cur + 7) % 7;
      if (m[1] === '下') diff += 7;
      if (m[1] === '下下') diff += 14;
      day = new Date(day.getTime() + diff * DAY_MS);
      foundDay = true;
    }
  }

  // 钟点 9:00 / 9点 / 9点30
  let hh = null, mm = 0;
  m = cmd.match(/(\d{1,2})[:：点](\d{1,2})?/);
  if (m) {
    hh = Number(m[1]);
    if (m[2] != null) mm = Number(m[2]);
    if (hh >= 0 && hh <= 23 && mm >= 0 && mm <= 59) {
      return `${dateKeyOf(day)}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
    }
    hh = null;
  }
  // 无钟点：无日期 → 视为无排程（不猜）
  if (!foundDay) return null;
  return `${dateKeyOf(day)}T09:00`; // 有日期无钟点 → 默认 09:00
}

// 解析活动行（标题 + @指令 + (计划) + #标签）
function parseActLine(raw, { defaultPlan, defaultMinutes, now }) {
  const out = { title: raw.trim(), note: '', planned_start: null, minutes: defaultMinutes || null, planTitle: null, warnings: [] };
  let body = out.title;
  // 0) 行尾 #标签 → note（须在 @ / (计划) 之前提取：标签可能跟在指令后）
  const tag = body.match(/\s+#([\w\u4e00-\u9fa5]+)$/);
  if (tag) { out.note = `#${tag[1]}`; body = body.slice(0, tag.index).trim(); }
  // 1) 行尾 (计划标题)
  const pm = body.match(/\(([^()\s][^()]*)\)\s*$/);
  if (pm) { out.planTitle = pm[1].trim(); body = body.slice(0, pm.index).trim(); }
  // 2) @ 指令（时间/时长）
  const at = body.indexOf('@');
  if (at >= 0) {
    out.title = body.slice(0, at).trim();
    const cmd = body.slice(at + 1).trim();
    if (cmd) {
      const dur = parseDuration(cmd);
      if (dur != null) out.minutes = dur;
      const when = parseWhen(cmd, now);
      if (when) out.planned_start = when;
      else out.warnings.push(`「${out.title || raw.trim()}」时间指令无法解析：${cmd}`);
    }
  }
  if (!out.title) out.title = '（未命名活动）';
  return out;
}

/**
 * 解析手打 Markdown → 实体候选。
 * @param {string} md
 * @param {object} opts { now(ms) } 时间注入（默认当前）
 * @returns {{ goals:Array, plans:Array, activities:Array, warnings:Array }}
 */
export function parseMdImport(md, { now = Date.now() } = {}) {
  const { fm, rest } = parseFrontmatter(md);
  const goals = [], plans = [], activities = [], warnings = [];
  let curGoal = null, curPlan = null;
  const defaultPlan = (fm.default && fm.default.plan) || null;
  const defaultMinutes = (fm.default && fm.default.minutes) != null ? Number(fm.default.minutes) || null : null;

  const pushGoal = (title) => {
    curGoal = { key: 'g' + goals.length, title: title.trim(), desc: '' };
    goals.push(curGoal);
    curPlan = null;
  };
  const findOrCreatePlan = (title) => {
    const hit = plans.find((p) => p.title === title);
    if (hit) return hit.key;
    if (!curGoal) pushGoal('（未分类）');
    const p = { key: 'p' + plans.length, goal_key: curGoal.key, title: title.trim() };
    plans.push(p);
    return p.key;
  };
  const pushPlan = (title) => {
    if (!curGoal) pushGoal('（未分类）');
    curPlan = { key: 'p' + plans.length, goal_key: curGoal.key, title: title.trim() };
    plans.push(curPlan);
  };

  for (const rawLine of rest.split('\n')) {
    const t = rawLine.trim();
    if (!t) continue;
    if (/^#\s+\S/.test(t) && !/^##/.test(t)) { pushGoal(t.replace(/^#\s+/, '')); continue; }
    if (/^##+\s+\S/.test(t)) { pushPlan(t.replace(/^##+\s+/, '')); continue; }
    const list = t.match(/^[-*]\s+(?:\[( |x)\]\s+)?(.*)$/);
    if (list) {
      const checked = list[1] === 'x';
      const parsed = parseActLine(list[2] || '', { defaultPlan, defaultMinutes, now });
      const planKey = parsed.planTitle
        ? findOrCreatePlan(parsed.planTitle)
        : (curPlan ? curPlan.key : (defaultPlan ? findOrCreatePlan(defaultPlan) : null));
      activities.push({
        key: 'a' + activities.length,
        plan_key: planKey,
        title: parsed.title,
        note: parsed.note,
        planned_start: parsed.planned_start,
        planned_minutes: parsed.minutes,
        status: checked ? 'Completed' : 'Planned',
      });
      warnings.push(...parsed.warnings);
      continue;
    }
    // 普通段落 → 当前目标描述
    if (curGoal) curGoal.desc = curGoal.desc ? curGoal.desc + '\n' + t : t;
  }
  return { goals, plans, activities, warnings };
}
