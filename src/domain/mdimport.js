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
    if (hh >= 0 && hh <= 23 && mm >= 0 && mm <= 59 && foundDay) {
      return `${dateKeyOf(day)}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
    }
    hh = null; // 只有钟点无日期 → 返回 null，由外层（视图日期组 / 手打回退今天）补日期
  }
  // 无钟点：无日期 → 视为无排程（不猜）
  if (!foundDay) return null;
  return `${dateKeyOf(day)}T09:00`; // 有日期无钟点 → 默认 09:00
}

// 解析活动行（标题 + @指令 + (计划) + 状态标记 + #标签）。
// 指令顺序宽容：先分离 @ 指令（cmd），再从标题部分按任意顺序剥离
// (计划) / 状态(进行中|失败|归档) / #标签 —— 避免指令混入活动名。
function parseActLine(raw, { defaultPlan, defaultMinutes, now }) {
  const out = { title: raw.trim(), note: '', planned_start: null, clock: null, minutes: defaultMinutes || null, planTitle: null, statusMark: null, warnings: [] };
  const strip = (s) => {
    // 循环剥离行尾指令（任意顺序）：(进行中|失败|归档) / (计划) / #标签 / ；备注 —— 避免混入活动名
    let prev;
    do {
      prev = s;
      s = s.replace(/\((进行中|失败|归档)\)\s*$/, (m, st) => { out.statusMark = st; return ''; }).trim();
      s = s.replace(/\(([^()\s][^()]*)\)\s*$/, (m, st) => { if (!out.planTitle) out.planTitle = st.trim(); return ''; }).trim();
      s = s.replace(/\s+#([\w\u4e00-\u9fa5]+)$/, (m, st) => { if (!out.note) out.note = '#' + st; return ''; }).trim();
      // 自由备注：；备注（追加，可与 #标签 并存）
      s = s.replace(/；(.+)$/, (m, nt) => { const t = nt.trim(); if (t) out.note = out.note ? out.note + ' ' + t : t; return ''; }).trim();
    } while (s !== prev);
    return s;
  };
  let body = raw.trim();
  // 1) 先整行剥离（覆盖 @ 之后的指令：`标题 @ 时间 (计划) #标签`）
  body = strip(body);
  // 2) 分离 @ 指令：head = @ 之前（可能残留 (计划)/#标签/状态），cmd = @ 之后（时间/时长）
  let head = body, cmd = '';
  const at = body.indexOf('@');
  if (at >= 0) { head = body.slice(0, at).trim(); cmd = body.slice(at + 1).trim(); }
  // 3) 再剥离 @ 之前的指令（覆盖 `标题 (计划) #标签 @ 时间`）
  head = strip(head);
  out.title = head.trim() || ''; // 空标题：回车空项 → 应用层跳过，不建垃圾实体
  // 4) 解析 @ 指令（时间/时长）
  if (cmd) {
    const dur = parseDuration(cmd);
    if (dur != null) out.minutes = dur;
    // 钟点单独记录（视图 md「## 日期组」下补日期用）
    const cm = cmd.match(/(\d{1,2})[:：点](\d{1,2})?/);
    if (cm && Number(cm[1]) >= 0 && Number(cm[1]) <= 23 && Number(cm[2] || 0) >= 0 && Number(cm[2] || 0) <= 59) {
      out.clock = `${String(Number(cm[1])).padStart(2, '0')}:${String(Number(cm[2] || 0)).padStart(2, '0')}`;
    }
    const when = parseWhen(cmd, now);
    if (when) out.planned_start = when;
    else if (!out.clock) out.warnings.push(`「${out.title}」时间指令无法解析：${cmd}`);
  }
  return out;
}

// 「## 日期标题」→ YYYY-M-D（视图 md 用；2026-9-2 / 9月2日 / 9-2）。无法识别返回 null
function parseDateInTitle(title, now) {
  const s = String(title);
  let m = s.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${+m[1]}-${+m[2]}-${+m[3]}`;
  m = s.match(/(\d{1,2})月(\d{1,2})日/);
  if (m) return `${new Date(now).getFullYear()}-${+m[1]}-${+m[2]}`;
  m = s.match(/(?:^|[^\d])(\d{1,2})-(\d{1,2})(?:[^\d]|$)/);
  if (m) return `${new Date(now).getFullYear()}-${+m[1]}-${+m[2]}`;
  return null;
}

/**
 * 解析手打 Markdown → 实体候选。
 * 行尾 id 标记（隐藏式绑定，编辑改名不断链）：
 *   `<!--id:xxx-->`（导出可读注释）或 lute 渲染后的链接 `[!--id:xxx--](!--id:xxx--)`。
 * @param {string} md
 * @param {object} opts { now(ms) } 时间注入（默认当前）
 * @returns {{ goals:Array, plans:Array, activities:Array, warnings:Array, mirror:boolean }}
 */
export function parseMdImport(md, { now = Date.now(), view: forceView = null } = {}) {
  const { fm, rest } = parseFrontmatter(md);
  const goals = [], plans = [], activities = [], warnings = [];
  let curGoal = null, curPlan = null, curDateBase = null;
  const mirror = !!fm.mirror; // 完整镜像：apply 时缺失即删
  // 视图标记（day/week/month）：可来自 frontmatter 或显式传入（workspace 同步时传 curView，
  // 防 Vditor/lute 剥离 frontmatter 后视图身份丢失）。视图模式下 #/## 标题不污染目标/计划。
  const view = forceView || fm.view || null;
  const inView = !!view;
  const defaultPlan = (fm.default && fm.default.plan) || null;
  const defaultMinutes = (fm.default && fm.default.minutes) != null ? Number(fm.default.minutes) || null : null;

  // 行尾 id 标记 → { id } 并剥离（兼容注释 / lute 链接 / 裸残余 三种形态）。
  // 裸残余 `!--id:x--`：Vditor 的 WYSIWYG getValue() 会把 HTML 注释退化输出为可见文本
  // `!--id:x--`，若不剥离会被当成实体标题 → 创建出「以 ID 为名」的垃圾活动/计划/目标。
  const stripId = (line) => {
    let m = line.match(/<!--id:([\w-]+)-->/);
    if (m) return { id: m[1], rest: line.replace(/<!--id:[\w-]+-->/, '').trim() };
    m = line.match(/\[!--id:([\w-]+)--\]\(!--id:\1--\)/);
    if (m) return { id: m[1], rest: line.replace(m[0], '').trim() };
    m = line.match(/!--id:([\w-]+)--/); // 裸残余兜底（WYSIWYG 退化形态）
    if (m) return { id: m[1], rest: line.replace(/!--id:[\w-]+--/, '').trim() };
    return { id: null, rest: line };
  };

  // 行尾状态词 → 目标/计划状态。status：显式标注才设值；未标注为 null
  // （计划默认不强制状态，避免 Active 计划导出再导回被漂移成 Incubating）
  const GOAL_STATUS_WORDS = { '归档': 'Archived', '完成': 'Completed' };
  const PLAN_STATUS_WORDS = { '孵化': 'Incubating', '暂停': 'Paused', '完成': 'Completed', '归档': 'Archived' };
  const pickStatus = (title, map) => {
    const m = String(title).match(/\((归档|完成|孵化|暂停)\)\s*$/);
    if (!m) return { title: String(title).trim(), status: null };
    return { title: String(title).slice(0, m.index).trim(), status: map[m[1]] || null };
  };
  const pushGoal = (title, id = null) => {
    const { title: t, status } = pickStatus(title, GOAL_STATUS_WORDS);
    curGoal = { key: 'g' + goals.length, title: t, desc: '', status: status || 'Active', id };
    goals.push(curGoal);
    curPlan = null;
    curDateBase = null;
  };
  const findOrCreatePlan = (title) => {
    const hit = plans.find((p) => p.title === title);
    if (hit) return hit.key;
    // 视图模式：活动可带 (计划) 归属，但目标无关（不建「（未分类）」goal 候选）
    const goal_key = inView ? 'g-view' : (curGoal ? curGoal.key : (pushGoal('（未分类）'), curGoal.key));
    const { title: t } = pickStatus(title, PLAN_STATUS_WORDS);
    const p = { key: 'p' + plans.length, goal_key, title: t, status: null, id: null, dateBase: null };
    plans.push(p);
    return p.key;
  };
  const pushPlan = (title, id = null) => {
    if (!inView && !curGoal) pushGoal('（未分类）');
    const { title: t, status } = pickStatus(title, PLAN_STATUS_WORDS);
    // 视图 md：「## 日期标题」→ 其下活动补默认日期；它是分组基线，不是真实计划
    const db_ = parseDateInTitle(t, now);
    curDateBase = db_ || null;
    curPlan = { key: 'p' + plans.length, goal_key: inView ? 'g-view' : (curGoal ? curGoal.key : 'g-view'), title: t, status, id, dateBase: curDateBase };
    plans.push(curPlan);
  };

  for (const rawLine of rest.split('\n')) {
    let t = rawLine.trim();
    if (!t) continue;
    // 提取隐藏式 id 标记（改名仍绑定同一对象）
    const { id, rest: body } = stripId(t);
    if (inView) {
      // 视图模式：# 顶部标题（今日/本周/本月）是装饰，不建目标；## 日期标题是分组基线，不建计划。
      // 二者都只影响展示/日期补全，绝不进入目标/计划候选（防污染状态）。
      if (/^#\s+\S/.test(body) && !/^##/.test(body)) { continue; }
      if (/^##+\s+\S/.test(body)) { pushPlan(body.replace(/^##+\s+/, ''), id); continue; }
    } else {
      if (/^#\s+\S/.test(body) && !/^##/.test(body)) { pushGoal(body.replace(/^#\s+/, ''), id); continue; }
      if (/^##+\s+\S/.test(body)) { pushPlan(body.replace(/^##+\s+/, ''), id); continue; }
    }
    // 任务列表项：兼容小写 [x] 与大写 [X]（lute 会把 [x] 规范化为 [X]，getValue 返回到）
    // checkbox 后 \s*（而非 \s+）：`- [ ]`（无内容回车空项）也要识别为 checkbox，否则会被当标题
    const list = body.match(/^[-*]\s+(?:\[( |x|X)\]\s*)?(.*)$/);
    if (list) {
      const checked = list[1] === 'x' || list[1] === 'X';
      const parsed = parseActLine(list[2] || '', { defaultPlan, defaultMinutes, now });
      const planKey = parsed.planTitle
        ? findOrCreatePlan(parsed.planTitle)
        : (curPlan ? curPlan.key : (defaultPlan ? findOrCreatePlan(defaultPlan) : null));
      // 状态：状态标记优先于 [x]（镜像同构）；无标记时 [x]=Completed / [ ]=Planned
      let status = checked ? 'Completed' : 'Planned';
      if (parsed.statusMark === '失败') status = 'Failed';
      else if (parsed.statusMark === '归档') status = 'Archived';
      else if (parsed.statusMark === '进行中') status = 'Started';
      // 日期补全：
      //  ・有 @ 时间指令 → 用解析出的 planned_start；
      //  ・视图模式、且在「## 某日」日期组内新加活动：无时间也默认排到当期日程（无钟点给 09:00）；
      //  ・否则只给钟点：优先「## 日期组」的日期，手打回退今天。
      let planned_start = parsed.planned_start;
      if (!planned_start) {
        if (inView && curDateBase) {
          planned_start = parsed.clock ? `${curDateBase}T${parsed.clock}` : `${curDateBase}T09:00`;
        } else if (parsed.clock) {
          const base = (curPlan && curPlan.dateBase) || dateKeyOf(new Date(now));
          planned_start = `${base}T${parsed.clock}`;
        }
      }
      activities.push({
        key: 'a' + activities.length,
        plan_key: planKey,
        title: parsed.title,
        note: parsed.note,
        planned_start,
        planned_minutes: parsed.minutes,
        status,
        id,
      });
      warnings.push(...parsed.warnings);
      continue;
    }
    // 普通段落 → 当前目标描述
    if (curGoal) curGoal.desc = curGoal.desc ? curGoal.desc + '\n' + t : t;
  }
  return { goals, plans, activities, warnings, mirror, view };
}

// ---- 反向：实体 → md（导出视图，可读可手改；行尾带隐藏式 id 标记，编辑改名仍绑定同一对象）----

function actToMd(a, planTitles) {
  const done = a.status === 'Completed' || a.status === 'Reviewed';
  let line = `- [${done ? 'x' : ' '}] ${a.title}`;
  const bits = [];
  if (a.planned_start) {
    const m = String(a.planned_start).match(/(\d{4}-\d{1,2}-\d{1,2})T?(\d{1,2}:\d{2})?/);
    if (m) bits.push(m[1] + (m[2] ? ' ' + m[2] : ''));
  }
  if (a.planned_minutes) bits.push(`${a.planned_minutes}分钟`);
  if (bits.length) line += ' @ ' + bits.join(' ');
  const pid = Array.isArray(a.plan_ids) && a.plan_ids.length ? a.plan_ids[0] : null;
  if (pid && planTitles.has(pid)) line += ` (${planTitles.get(pid)})`;
  // 状态标注（位于归属之后）：Started/Failed/Archived 需显式，否则导回无法表达
  if (a.status === 'Started') line += ' (进行中)';
  else if (a.status === 'Failed') line += ' (失败)';
  else if (a.status === 'Archived') line += ' (归档)';
  // 自由备注（；分隔，round-trip 保留）：note 含的 #标签 一并输出
  if (a.note && a.note.trim()) line += ' ；' + String(a.note).trim();
  line += ` <!--id:${a.id}-->`; // 隐藏式绑定：改名不断链
  return line;
}

const GOAL_STATUS_SUFFIX = { Archived: ' (归档)', Completed: ' (完成)' };
const PLAN_STATUS_SUFFIX = { Incubating: ' (孵化)', Paused: ' (暂停)', Completed: ' (完成)', Archived: ' (归档)' };

function goalToMdLine(g) {
  return `# ${g.title}${GOAL_STATUS_SUFFIX[g.status] || ''} <!--id:${g.id}-->`;
}
function planToMdLine(p) {
  return `## ${p.title}${PLAN_STATUS_SUFFIX[p.status] || ''} <!--id:${p.id}-->`;
}

// 给「含 title 且无 id 绑定」的实体行补隐藏式 id（新建行绑定，防重复创建/误判缺失即删）。
// type: goal(# 标题) / plan(## 标题) / activity(- [ ] 标题)；已有 id 绑定的行不重复补。
// occurrence：同标题出现多行时绑定第 occurrence 个匹配行（0=第一个），防同标题多行只绑第一个。
export function bindEntityLine(md, type, title, id, occurrence = 0) {
  const esc = String(title).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  let re;
  if (type === 'goal') re = new RegExp(`^(#\\s+[^\\n]*${esc}[^\\n]*)$`, 'm');
  else if (type === 'plan') re = new RegExp(`^(##\\s+[^\\n]*${esc}[^\\n]*)$`, 'm');
  else re = new RegExp(`^([-*]\\s+\\[[ xX]\\]\\s+[^\\n]*${esc}[^\\n]*)$`, 'm');
  let seen = -1;
  return String(md).replace(re, (line) => {
    if (/(<!--id:|!--id:)/.test(line)) return line; // 已有绑定不重复补
    seen++;
    if (seen !== occurrence) return line;
    return line + ` <!--id:${id}-->`;
  });
}

// 单实体 → 其对应 md 行（视图编辑「局部同步」用：只替换该对象行，不整份重写）
export function serializeEntityLine(db, ent) {
  if (ent == null) return '';
  if (ent.goal_id !== undefined) return planToMdLine(ent);
  if (ent.desc !== undefined) return goalToMdLine(ent);
  return actToMd(ent, new Map((db.plans || []).map((p) => [p.id, p.title])));
}

// 在 md 文本中定位某 id 的行并替换（新行为空串则删除该行）。返回新文本。
export function replaceEntityLine(md, id, newLine) {
  const re = new RegExp(`^.*(?:<!--id:${id}-->|\\[!--id:${id}--\\]\\(!--id:${id}--\\)).*$`, 'm');
  return String(md).replace(re, (m) => {
    if (newLine === '') return ''; // 删行（连同前导空行）
    return newLine;
  });
}

/**
 * db → 手打规则 Markdown（与 parseMdImport 互逆）。
 * 完整镜像（mirror: true）：导出**全部**目标/计划/活动（含已归档/已完成），
 * 应用时缺失即删——md 成为计划面唯一真源。状态用行尾词标注保持同构。
 * 事务流水/收支/期次等 JSON 专属字段不进 md（md 是计划面的可读交换格式）。
 * @param {object} db { goals, plans, activities }
 * @returns {string} 可读 md 文本
 */
export function serializeDbToMd(db) {
  const goals = db.goals || [];
  const plans = db.plans || [];
  const acts = db.activities || [];
  const planTitles = new Map(plans.map((p) => [p.id, p.title]));
  const orphan = acts.filter((a) => !Array.isArray(a.plan_ids) || !a.plan_ids.length);
  const lines = [];
  lines.push('---', 'mirror: true', `updated: ${dateKeyOf(new Date())}`, '---', '');
  for (const g of goals) {
    lines.push(goalToMdLine(g));
    if (g.desc && g.desc.trim()) lines.push('', g.desc);
    const gPlans = plans.filter((p) => p.goal_id === g.id);
    for (const p of gPlans) {
      lines.push('', planToMdLine(p));
      const pActs = acts.filter((a) => Array.isArray(a.plan_ids) && a.plan_ids.includes(p.id));
      for (const a of pActs) lines.push(actToMd(a, planTitles));
    }
  }
  if (orphan.length) {
    lines.push('', '## 未分类');
    for (const a of orphan) lines.push(actToMd(a, planTitles));
  }
  return lines.join('\n').replace(/\n+$/, '') + '\n';
}

// 把 Vditor/lute 渲染后的链接式 id 标记 `[!--id:x--](!--id:x--)` 转回可读注释 `<!--id:x-->`（导出 .md 文件用）
export function normalizeIdMarkers(md) {
  return String(md).replace(/\[!--id:([\w-]+)--\]\(!--id:\1--\)/g, '<!--id:$1-->');
}

// 空行 id 错位修复（文本级）。回车时 Vditor 会把上一行行尾的隐藏式 id 标记「下移/复制」到新的空待办行，
// 导致原行丢 id、空行带 id → 同步时原行被当新活动复制出副本。此函数把藏在空行里的 id 归还给
// 「上一个无 id 的内容活动行」；若上一内容行已有 id（纯复制）则去掉空行的重复 id。
// 幂等：修复后再跑不产生变化。返回修复后的文本（无变化则原样返回）。
export function repairIdMarkers(md) {
  const ID_RE = /(?:<!--id:([\w-]+)-->|\[!--id:([\w-]+)--\]\(!--id:\2--\))/;
  const lineId = (l) => { const m = l.match(ID_RE); return (m && (m[1] || m[2])) || null; };
  const lines = String(md).split('\n');
  let lastContent = -1; // 上一个「有内容的活动行」下标
  let changed = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!ID_RE.test(line)) {
      if (/^[-*]\s+\[[ xX]\]\s*\S/.test(line.trim())) lastContent = i; // 有内容的活动行 → 锚点
      continue;
    }
    const stripped = line.replace(ID_RE, '').trim();
    if (!/^[-*]\s+\[[ xX]\]\s*$/.test(stripped)) { lastContent = i; continue; } // 有内容的行 → 锚点
    // 空 checkbox 行但带 id = 错位锚点（回车残留）
    if (lastContent >= 0) {
      const id = lineId(line);
      if (!ID_RE.test(lines[lastContent])) {
        lines[lastContent] = lines[lastContent].replace(/\s*$/, '') + ` <!--id:${id}-->`; // 归还
      }
      lines[i] = line.replace(ID_RE, '').replace(/\s+$/, ''); // 空行去掉多余 id（留 `- [ ]` 供输入）
      changed = true;
    }
    // 无上一内容行 → 保留 ghost（交缺失判定）
  }
  return changed ? lines.join('\n') : String(md);
}
