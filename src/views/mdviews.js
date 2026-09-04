// ============================================================
// views/mdviews.js
// 「视图」= 对 db 的一次**重排**：把同一份数据按不同语义组织成一份 md 文本，
// 填入唯一的 Vditor（单一文本编辑兼展示器）直接编辑。无任何 UI 组件。
// 组织器输出带 frontmatter `view:` 标记 + 隐藏式 id，应用时走「视图局部同步」，
// 只更新对应活动、完全不干扰视图范围外的数据。db 是唯一真源。
// ============================================================

// ---- 日期工具（本地时区，YYYY-M-D；导出供 workspace 导航用）----
const DAY_MS = 86400000;
const WD = ['日', '一', '二', '三', '四', '五', '六'];
export function dkey(d) { return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; }
export function todayKey(now = Date.now()) { return dkey(new Date(now)); }
export function parseKey(k) { const [y, m, d] = String(k).split('-').map(Number); return new Date(y, m - 1, d); }
export function addDays(k, n) { return dkey(new Date(parseKey(k).getTime() + n * DAY_MS)); }
function weekdayCN(d) { return WD[d.getDay()]; }
function weekStartKey(k) { const d = parseKey(k); const off = (d.getDay() + 6) % 7; return dkey(new Date(d.getTime() - off * DAY_MS)); }
function datePartOf(dt) { return String(dt || '').split('T')[0]; }
function timePartOf(dt) { const m = String(dt || '').match(/T(\d{1,2}:\d{2})/); return m ? m[1] : ''; }
function byTime(a, b) { return timePartOf(a.planned_start).localeCompare(timePartOf(b.planned_start)); }

// 活动 → md 行（视图版：时间只给钟点，日期由「## 日期组」承载；带隐藏式 id）
function actToViewLine(a, planTitles) {
  const done = a.status === 'Completed' || a.status === 'Reviewed';
  let line = `- [${done ? 'x' : ' '}] ${a.title}`;
  const tm = timePartOf(a.planned_start);
  if (tm) line += ` @ ${tm}`;
  if (a.planned_minutes) line += ` ${a.planned_minutes}分钟`;
  const pid = Array.isArray(a.plan_ids) && a.plan_ids.length ? a.plan_ids[0] : null;
  if (pid && planTitles.has(pid)) line += ` (${planTitles.get(pid)})`;
  if (a.status === 'Started') line += ' (进行中)';
  else if (a.status === 'Failed') line += ' (失败)';
  else if (a.status === 'Archived') line += ' (归档)';
  if (a.note && a.note.trim()) line += ' ；' + String(a.note).trim();
  line += ` <!--id:${a.id}-->`;
  return line;
}

function planTitlesOf(db) { return new Map((db.plans || []).map((p) => [p.id, p.title])); }
function unschedOf(db) { return (db.activities || []).filter((a) => !datePartOf(a.planned_start)); }
function pushUnsch(lines, db, withPlan) {
  const u = unschedOf(db);
  if (!u.length) return;
  lines.push('', '## 未排程');
  u.sort(byTime).forEach((a) => lines.push(actToViewLine(a, withPlan)));
}

const FM = (view, now) => ['---', `view: ${view}`, `updated: ${todayKey(now)}`, '---', ''];

// 锚点容错：仅接受 'YYYY-M-D' 字符串；数字时间戳或非法值回退到今天（防 NaN）
function anchorKey(anchor, now) {
  return typeof anchor === 'string' && /^\d{4}-\d{1,2}-\d{1,2}/.test(anchor) ? anchor : todayKey(now);
}

// 日视图：anchor 所在日（默认今天）
export function organizeDay(db, anchor = null, now = Date.now()) {
  const withPlan = planTitlesOf(db);
  const k = anchorKey(anchor, now);
  const d = parseKey(k);
  const dayActs = (db.activities || []).filter((a) => datePartOf(a.planned_start) === k).sort(byTime);
  const lines = [...FM('day', now), `# 今日 · ${k} 周${weekdayCN(d)}`, '', `## ${k} 周${weekdayCN(d)}`];
  dayActs.forEach((a) => lines.push(actToViewLine(a, withPlan)));
  if (!dayActs.length) lines.push('（今天没有已排程活动）');
  pushUnsch(lines, db, withPlan);
  return lines.join('\n').replace(/\n+$/, '') + '\n';
}

// 周视图：anchor 所在周（周一为起点）
export function organizeWeek(db, anchor = null, now = Date.now()) {
  const withPlan = planTitlesOf(db);
  const ws = weekStartKey(anchorKey(anchor, now));
  const lines = [...FM('week', now), `# 本周 · ${ws} ~ ${addDays(ws, 6)}`, ''];
  for (let i = 0; i < 7; i++) {
    const k = addDays(ws, i);
    const dayActs = (db.activities || []).filter((a) => datePartOf(a.planned_start) === k).sort(byTime);
    if (!dayActs.length) continue;
    const d = parseKey(k);
    lines.push(`## ${k} 周${weekdayCN(d)}`);
    dayActs.forEach((a) => lines.push(actToViewLine(a, withPlan)));
  }
  if (lines.length <= 3) lines.push('（本周没有已排程活动）');
  pushUnsch(lines, db, withPlan);
  return lines.join('\n').replace(/\n+$/, '') + '\n';
}

// 月视图：anchor 所在月
export function organizeMonth(db, anchor = null, now = Date.now()) {
  const withPlan = planTitlesOf(db);
  const ad = parseKey(anchorKey(anchor, now));
  const y = ad.getFullYear(), m = ad.getMonth();
  const prefix = `${y}-${m + 1}`;
  const byDay = new Map();
  for (const a of db.activities || []) {
    const k = datePartOf(a.planned_start);
    if (k && k.startsWith(prefix + '-')) {
      if (!byDay.has(k)) byDay.set(k, []);
      byDay.get(k).push(a);
    }
  }
  const lines = [...FM('month', now), `# 本月 · ${y}年${m + 1}月`, ''];
  if (!byDay.size) lines.push('（本月没有已排程活动）');
  for (const [k, arr] of [...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const dd = parseKey(k);
    lines.push(`## ${k} 周${weekdayCN(dd)}`);
    arr.sort(byTime).forEach((a) => lines.push(actToViewLine(a, withPlan)));
  }
  pushUnsch(lines, db, withPlan);
  return lines.join('\n').replace(/\n+$/, '') + '\n';
}
