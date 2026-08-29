// 抢救解析器 v3：base64 字符流(_recovered_big.txt) → 标准备份 JSON(_restored_backup.json)
// 流特征：JSON 去掉所有非 [A-Za-z0-9+/=] 字符后的连续串（键名引号冒号逗号全部消失）
// 实测结构：version1exportedAt<12digits>Zdbresources…rules…goals…plans…activities…txs…outputs…valueflows…[goods]seq…
import fs from 'fs';

const SRC = process.argv[2] || './tests/_recovered_big.txt';
const DST = process.argv[3] || './tests/_restored_backup.json';
const t = fs.readFileSync(SRC, 'utf8');
let i = 0;
const log = (...a) => console.log('[trace]', ...a);

const eat = (s) => { if (s && t.startsWith(s, i)) { i += s.length; return true; } return false; };
const peek = (n = 50) => JSON.stringify(t.slice(i, i + n));
const readNum = () => {
  const m = /^[+-]?\d+(\.\d+)?(?=[A-Za-z]|$)/.exec(t.slice(i, i + 24));
  if (!m) return null;
  i += m[0].length;
  // 小数点在损坏流中被剥掉（0.1→01）：JSON 不会有前导零，多位的 0 开头必是「0.x」
  const raw = m[0];
  const n = /^([+-]?)0(\d+)$/.exec(raw) ? Number(`${RegExp.$1}0.${RegExp.$2}`) : Number(raw);
  return Number.isFinite(n) ? n : null;
};
const readEnumOrNull = (names) => {
  if (eat('null')) return null;
  // 长名优先，避免 Archived 被 Active 前缀截断误吃
  for (const n of [...names].sort((a, b) => b.length - a.length)) if (eat(n)) return n;
  return null;
};
const readId = () => {
  // 多字符前缀优先（ru=规则 / gd=商品），单字母前缀兜底
  let m = /^(ru|gd)(\d+)/.exec(t.slice(i, i + 12));
  if (m) { i += m[0].length; return m[1] + m[2]; }
  m = /^([rgpatvo])(\d+)/.exec(t.slice(i, i + 12));
  if (!m) return null;
  i += m[0].length;
  return m[1] + m[2];
};
// maxWin：主题内嵌 base64 图片可达数百 KB，默认窗口必须够大
const readStrUntil = (stopNames, maxWin = 800000) => {
  const win = t.slice(i, i + maxWin);
  let end = win.length;
  for (const n of stopNames) {
    const p = win.indexOf(n);
    if (p !== -1 && p < end) end = p;
  }
  const s = win.slice(0, end);
  i += end;
  return s;
};

// ---------- 顶层：容忍前导杂讯，定位 version ----------
const vp = t.indexOf('version');
if (vp > 0) { log('跳过前导', vp, '字符:', peek(Math.min(vp, 40))); i = vp; }
eat('version');
const ver = readNum() ?? 1; // ★ 先消费 version 的值，否则全盘错位（v2 的根因）
eat('exportedAt');
const dateRaw = readNum(); // 20260823
eat('T');
const timeRaw = String(readNum()).padStart(9, '0'); // 20236274 → 补回前导零 → 020236274
eat('Z');
eat('db');
const exportedAt = `${String(dateRaw).slice(0, 4)}-${+String(dateRaw).slice(4, 6)}-${+String(dateRaw).slice(6, 8)}`
  + `T${timeRaw.slice(0, 2)}:${timeRaw.slice(2, 4)}:${timeRaw.slice(4, 6)}.${timeRaw.slice(6, 9)}Z`;
log(`top ok (version=${ver}), exportedAt = ${exportedAt}, next:`, peek(40));

const db = { resources: [], rules: [], goals: [], plans: [], activities: [], txs: [], outputs: [], valueflows: [], goods: [] };

// ---------- resources ----------
eat('resources');
while (eat('name')) {
  const name = readStrUntil(['unit']);
  eat('unit');
  const unit = readStrUntil(['initial']);
  eat('initial');
  const initial = readNum() ?? 0;
  let color = null;
  const cm = /^([0-9a-f]{6})(?=status)/.exec(t.slice(i, i + 12));
  if (cm) { color = '#' + cm[1]; i += 6; }
  eat('status');
  const status = readEnumOrNull(['Active', 'Archived']);
  eat('created');
  const created = readNum();
  eat('id');
  const id = readId();
  db.resources.push({ id, name, unit, initial, color, status, created });
}
log('resources =', db.resources.length);

// ---------- rules ----------
eat('rules');
while (eat('label')) {
  const label = readStrUntil(['from']);
  eat('from'); const from = readId();
  eat('to'); const to = readId();
  eat('rate'); const rate = readNum() ?? 1;
  eat('status');
  const status = readEnumOrNull(['Active', 'Archived']);
  eat('created'); const created = readNum();
  eat('id'); const id = readId();
  db.rules.push({ id, label, from, to, rate, status, created });
}
log('rules =', db.rules.length);

// ---------- goals ----------
eat('goals');
while (eat('title')) {
  const title = readStrUntil(['desc']);
  eat('desc');
  const desc = readStrUntil(['created']);
  eat('created'); const created = readNum();
  eat('id'); const id = readId();
  db.goals.push({ id, title, desc, created });
}
log('goals =', db.goals.length);

// ---------- plans ----------
eat('plans');
while (eat('goalid') || eat('goal_id')) {
  const goal_id = readId();
  eat('title'); const title = readStrUntil(['budget']);
  eat('budget');
  const budget = eat('null') ? null : readNum();
  eat('color');
  let color = null;
  const pc = /^[0-9a-f]{6}(?=status)/.exec(t.slice(i, i + 12));
  if (pc) { color = '#' + pc[0]; i += 6; } else eat('null');
  eat('status');
  const status = readEnumOrNull(['Incubating', 'Active', 'Frozen', 'Archived']);
  eat('created'); const created = readNum();
  eat('id'); const id = readId();
  db.plans.push({ id, goal_id, title, budget, color, status, created });
}
log('plans =', db.plans.length);

// ---------- activities ----------
const THEME_ENDS = ['actualstart'];
eat('activities');
while (eat('title')) {
  const title = readStrUntil(['note']);
  eat('note');
  const note = readStrUntil(['planids']);
  eat('planids');
  const pidsRaw = readStrUntil(['planneddate']);
  const plan_ids = (pidsRaw.match(/[rgp]\d+/g) || []);
  eat('planneddate');
  const pdRaw = readStrUntil(['plannedstart', 'plannedminutes']);
  // planned_date 存储为 YYYY-M-D（非补零）：去线后 7 位=单月双日，8 位=双月双日
  let planned_date = null;
  if (/^\d{8}$/.test(pdRaw)) planned_date = `${pdRaw.slice(0, 4)}-${+pdRaw.slice(4, 6)}-${+pdRaw.slice(6, 8)}`;
  else if (/^(\d{4})(\d)(\d{2})$/.test(pdRaw)) planned_date = `${RegExp.$1}-${+RegExp.$2}-${RegExp.$3}`;
  let planned_start = null;
  if (eat('plannedstart')) {
    const psRaw = readStrUntil(['plannedminutes']);
    // 两种形态：YYYYMMDDTHHMM（无秒）与 YYYYMMDDTHHMMSS
    const m = /^(\d{8})T(\d{4})(\d{2})?/.exec(psRaw);
    if (m) planned_start = `${m[1].slice(0, 4)}-${+m[1].slice(4, 6)}-${+m[1].slice(6, 8)}T${m[2].slice(0, 2)}:${m[2].slice(2, 4)}`;
  }
  eat('plannedminutes');
  const planned_minutes = readNum() ?? 0;
  eat('repeat');
  const repeat = readEnumOrNull(['daily', 'weekly', 'monthly', 'weekday']);
  eat('repeatuntil');
  const ruRaw = readStrUntil(['timelogs']);
  let repeat_until = null;
  if (/^\d{8}$/.test(ruRaw)) repeat_until = `${ruRaw.slice(0, 4)}-${+ruRaw.slice(4, 6)}-${+ruRaw.slice(6, 8)}`;
  else if (/^(\d{4})(\d)(\d{2})$/.test(ruRaw)) repeat_until = `${RegExp.$1}-${+RegExp.$2}-${RegExp.$3}`;
  const time_logs = [];
  eat('timelogs');
  while (eat('start')) {
    const start = readNum();
    let end = null;
    if (eat('end')) end = readNum();
    time_logs.push(end != null ? { start, end } : { start });
  }
  let theme = null;
  if (eat('theme')) {
    if (eat('null')) theme = null;
    else if (eat('type')) {
      const type = readEnumOrNull(['gradient', 'image']);
      if (type === 'gradient') {
        eat('value');
        theme = { type, value: readStrUntil(THEME_ENDS) };
      } else {
        eat('url');
        // 恢复流中 "data:image/jpeg;base64," → "dataimage/jpegbase64"（斜杠属 base64 表保留）
        const dm = /^dataimage\/?(jpeg|png)base64/.exec(t.slice(i, i + 32));
        if (dm) {
          i += dm[0].length;
          theme = { type: 'image', url: `data:image/${dm[1]};base64,` + readStrUntil(THEME_ENDS) };
        } else {
          theme = { type: 'image', url: '' };
        }
      }
    }
  }
  eat('actualstart');
  const actual_start = eat('null') ? null : readNum();
  eat('actualend');
  const actual_end = eat('null') ? null : readNum();
  eat('status');
  const status = readEnumOrNull(['Planned', 'Started', 'Completed', 'Reviewed', 'Archived']);
  eat('created');
  const created = readNum();
  eat('id');
  const id = readId();
  // planned_end = 起始 + 时长（约定 YYYY-MM-DDTHH:MM；手工进位，避免 Date 解析非补零月份的兼容问题）
  let planned_end = null;
  if (planned_start && /^\d{4}-(\d{1,2})-(\d{2})T(\d{2}):(\d{2})$/.test(planned_start)) {
    const [, mo, dy, hh, mm] = planned_start.match(/^\d{4}-(\d{1,2})-(\d{2})T(\d{2}):(\d{2})$/).map(Number);
    const total = ((dy - 1) * 1440) + hh * 60 + mm + planned_minutes; // 从当月 1 日 00:00 起的分钟数
    const dim = new Date(2020, mo, 0).getDate(); // 该月天数（仅用合法月份构造）
    const p2 = (n) => String(n).padStart(2, '0');
    const year = planned_start.slice(0, 4);
    planned_end = total < dim * 1440
      ? `${year}-${mo}-${p2(Math.floor(total / 1440) + 1)}T${p2(Math.floor((total % 1440) / 60))}:${p2(total % 60)}`
      : null; // 跨月场景罕见，放弃推算保持 null
  }
  db.activities.push({
    id, title, note, plan_ids, planned_date,
    planned_start, planned_end,
    planned_minutes, repeat, repeat_until, time_logs, theme, conflicts: [],
    actual_start, actual_end, status, created,
  });
}
log('activities =', db.activities.length, '(含主题图',
  db.activities.filter((a) => a.theme?.type === 'image').map((a) => a.theme.url.length + 'B').join(',') || '无', ')');

// ---------- txs ----------
eat('txs');
while (t.startsWith('id', i)) {
  const saveI = i;
  i += 2;
  const id = readId();
  if (!eat('resourceid')) { i = saveI; break; } // 回滚含 id 键名（下一段的 id）
  const resource_id = readId();
  eat('debit'); const debit = readNum() ?? 0;
  eat('credit'); const credit = readNum() ?? 0;
  eat('sourcetype');
  const source_type = readEnumOrNull(['activity', 'reversal', 'rule', 'manual', 'good', 'valueflow', 'conversion', 'goods']);
  eat('sourceid');
  const source_id = readStrUntil(['note']);
  eat('note');
  const note = readStrUntil(['reversalof']);
  eat('reversalof');
  const reversal_of = eat('null') ? null : readId();
  eat('created');
  const created = readNum();
  db.txs.push({ id, resource_id, debit, credit, source_type, source_id, note, reversal_of, created });
}
log('txs =', db.txs.length, 'next:', peek(30));

// ---------- outputs（两种版本：旧版 id 在前；新版 title 在前、id/activity_id 收尾） ----------
eat('outputs');
if (t.startsWith('id', i)) {
  while (t.startsWith('id', i)) {
    const saveI = i;
    i += 2;
    const id = readId();
    if (!eat('activityid')) { i = saveI; break; }
    const activity_id = readId();
    eat('title'); const title = readStrUntil(['tags']);
    eat('tags');
    const tagsRaw = readStrUntil(['status']);
    const tags = tagsRaw.match(/[A-Za-z]+/g) || [];
    eat('status');
    const status = readEnumOrNull(['Draft', 'Published', 'Archived']);
    eat('note');
    eat('created');
    const created = readNum();
    db.outputs.push({ id, activity_id, title, tags, note: '', status, created });
  }
} else {
  while (eat('title')) {
    const title = readStrUntil(['tags']);
    eat('tags');
    const tagsRaw = readStrUntil(['note']);
    const tags = tagsRaw.match(/[A-Za-z]+/g) || [];
    eat('note');
    const note = readStrUntil(['status']);
    eat('status');
    const status = readEnumOrNull(['Draft', 'Published', 'Archived']);
    eat('created'); const created = readNum();
    eat('id'); const id = readId();
    eat('activityid'); const activity_id = readId();
    db.outputs.push({ id, activity_id, title, tags, note, status, created });
  }
}
log('outputs =', db.outputs.length, 'next:', peek(30));

// ---------- valueflows ----------
eat('valueflows');
while (t.startsWith('id', i)) {
  const saveI = i;
  i += 2;
  const id = readId();
  if (!eat('outputid')) { i = saveI; break; }
  const output_id = readId();
  eat('giver');
  const giver = readStrUntil(['receiver']);
  eat('receiver');
  const receiver = readStrUntil(['status']);
  eat('status');
  const status = readEnumOrNull(['Pending', 'Overdue', 'Closed']);
  eat('expected');
  const expected = readNum();
  eat('feedback');
  const feedback = readStrUntil(['created']);
  eat('created');
  const created = readNum();
  db.valueflows.push({ id, output_id, giver, receiver, status, expected, feedback, created });
}
log('valueflows =', db.valueflows.length, 'next:', peek(30));

// ---------- seq / goods（新版导出顺序为 seq→goods，与旧版相反；双序兼容） ----------
const GKEYS = ['name', 'emoji', 'resourceid', 'costs', 'amount', 'price', 'note', 'status', 'created', 'id'];

function parseSeq() {
  const s = { r: 0, ru: 0, g: 0, p: 0, a: 0, t: 0, o: 0, v: 0, gd: 0 };
  // 尾部可能带重编码填充残留（如 w==），逐键读取到非法字符为止
  for (;;) {
    const m = /^(ru|gd|[rgpatvo])(\d+)/.exec(t.slice(i, i + 12));
    if (!m) break;
    i += m[0].length;
    s[m[1]] = Number(m[2]);
  }
  Object.assign(seq, s);
}

// 商品实体键序不固定（旧版 name 开头，迁移过的 costs 可能挂在 id 之后）：
// 实体内按任意顺序吃已知键，再次遇到 name（且已有 id）即下一实体边界
function parseGoods() {
  while (t.startsWith('name', i)) {
    const g = { id: null, name: '', emoji: '', costs: [], note: '', status: 'Active', created: null };
    for (let guard = 0; guard < 64; guard++) {
      if (t.startsWith('name', i) && g.id !== null) break; // 下一实体
      if (eat('name')) { g.name = readStrUntil(GKEYS); continue; }
      if (eat('emoji')) { g.emoji = readStrUntil(GKEYS); continue; }
      if (eat('costs')) {
        while (eat('resourceid')) {
          const rid = readId();
          eat('amount');
          g.costs.push({ resource_id: rid, amount: readNum() ?? 0 });
        }
        continue;
      }
      if (eat('resourceid')) { // 旧单资源格式：resourceid+price
        const rid = readId();
        eat('price');
        const amt = readNum();
        g.resource_id = rid;
        if (amt != null && !g.costs.length) g.price = amt; // 兼容字段，导入时由 goodCosts 归一
        continue;
      }
      if (eat('note')) { g.note = readStrUntil(GKEYS); continue; }
      if (eat('status')) { g.status = readEnumOrNull(['Active', 'Archived']); continue; }
      if (eat('created')) { g.created = readNum(); continue; }
      if (eat('id')) { g.id = readId(); continue; }
      break; // 未知内容 → 实体结束
    }
    // 统一 costs：旧单资源格式转多资源数组（与 engine.goodCosts 契约一致）
    if (!g.costs.length && g.resource_id && g.price != null) g.costs = [{ resource_id: g.resource_id, amount: g.price }];
    db.goods.push(g);
  }
}

let seq = { r: 0, ru: 0, g: 0, p: 0, a: 0, t: 0, o: 0, v: 0, gd: 0 };
if (t.startsWith('seq', i)) { i += 3; parseSeq(); parseGoods(); }
else if (t.startsWith('goods', i)) { i += 5; parseGoods(); if (t.startsWith('seq', i)) { i += 3; parseSeq(); } }
db.seq = seq;
log('goods =', db.goods.length);
log('seq =', JSON.stringify(seq), '剩余未消费:', peek(40));

// ---------- 校验 & 输出 ----------
const problems = [];
for (const [k, keyOf] of [['resources', (e) => e.id], ['rules', (e) => e.id], ['goals', (e) => e.id],
  ['plans', (e) => e.id], ['activities', (e) => e.id], ['txs', (e) => e.id],
  ['outputs', (e) => e.id], ['valueflows', (e) => e.id]]) {
  const bad = db[k].filter((e) => !keyOf(e) || e.created == null);
  if (bad.length) problems.push(`${k}: ${bad.length} 条缺 id/created`);
}
const seqExpect = { resources: 'r', rules: 'ru', goals: 'g', plans: 'p', activities: 'a', txs: 't', outputs: 'o', valueflows: 'v' };
for (const [arr, sk] of Object.entries(seqExpect)) {
  const n = db[arr].length;
  if (n > seq[sk]) problems.push(`${arr}: 解析出 ${n} 条 > seq.${sk}=${seq[sk]}（可疑）`);
}
if (problems.length) console.log('\n[校验警告]', ...problems, '\n');

const out = { app: 'personal-erp', version: 1, exportedAt, db };
fs.writeFileSync(DST, JSON.stringify(out, null, 2), 'utf8');

console.log('\n== 重建统计 ==');
for (const k of Object.keys(db)) console.log(k + ':', db[k].length, '条');
if (db.activities[0]) console.log('\n样例 activity:\n', JSON.stringify(db.activities[0]).slice(0, 400));
console.log(`\n已写出 ${DST} （${fs.statSync(DST).size} bytes）`);
