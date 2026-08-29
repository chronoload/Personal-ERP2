// 探针：engine.js 时间与原子性域 bug 猎杀（只读验证，不修改 src/tests）
import { seedDB } from '../../../src/store/db.js';
import * as E from '../../../src/domain/engine.js';

function freshDB() {
  const db = seedDB();
  db.resources = [{ id: 'r1', name: 'Token', unit: 'Token', initial: 100, status: 'Active', created: 0 }];
  db.rules = []; db.goals = []; db.plans = []; db.activities = []; db.txs = []; db.outputs = []; db.valueflows = []; db.goods = [];
  db.seq = { r: 1, ru: 0, g: 0, p: 0, a: 0, t: 0, o: 0, v: 0, gd: 0 };
  return db;
}
let passN = 0, bugN = 0;
function report(id, name, expect, actual) {
  const isBug = !Object.is(expect, actual) && JSON.stringify(expect) !== JSON.stringify(actual);
  if (isBug) { bugN++; console.log(`BUG  ${id} ${name}\n     期望=${JSON.stringify(expect)} 实际=${JSON.stringify(actual)}`); }
  else { passN++; console.log(`PASS ${id} ${name} => ${JSON.stringify(actual)}`); }
}
const mk = (db, ps, mins, keep = false, title = 'x') =>
  E.createActivity(db, { title, plan_ids: [], planned_start: ps, planned_minutes: mins, keep_conflict: keep });
const idOf = (db, i) => db.activities[i].id;

// ---------- T2/T3a: 边界相触 end==start 不算冲突；自排他/已完成/弹性排除 ----------
{
  const db = freshDB();
  mk(db, '2026-08-25T09:00', 60);            // A: 09:00-10:00
  const hitsTouch = E.findConflicts(db, { startMs: E.activityWindow(db.activities[0]).end, endMs: E.activityWindow(db.activities[0]).end + 3600000 });
  report('T3a', 'end==start 相触不报冲突 (hits=0)', 0, hitsTouch.length);
  const self = E.findConflicts(db, { startMs: E.activityWindow(db.activities[0]).start, endMs: E.activityWindow(db.activities[0]).end, excludeId: idOf(db, 0) });
  report('T2a', 'findConflicts 排除自身', 0, self.length);
  E.startActivity(db, idOf(db, 0));
  E.completeActivity(db, idOf(db, 0), { expense: { resource_id: 'r1', amount: 1 }, output_title: 'o' });
  const hist = E.findConflicts(db, { startMs: E.activityWindow(db.activities[0]).start, endMs: E.activityWindow(db.activities[0]).end });
  report('T2b', 'Completed 历史事实不拦路', 0, hist.length);
}

// ---------- T3b: 自动顺延落点无冲突（无乒乓） ----------
{
  const db = freshDB();
  mk(db, '2026-08-25T09:00', 60);            // A
  const r = mk(db, '2026-08-25T09:30', 60);  // B 撞 A → 应顺延且不与 A 重叠
  const b = db.activities[1];
  const wb = E.activityWindow(b), wa = E.activityWindow(db.activities[0]);
  const overlap = wb.start < wa.end && wa.start < wb.end;
  report('T3b', '自动顺延后 B 不再与 A 重叠', false, overlap);
  report('T3b2', '返回 shifted 且带目标时刻', true, r.ok && r.shifted === true && typeof r.to === 'string');
}

// ---------- T4a/b: findFreeSlot 当日贴午夜边界 / 跨午夜块 ----------
{
  const db = freshDB();
  mk(db, '2026-08-25T09:00', 60); // 占 09:00-10:00，22:00-24:00 应可用
  const r = mk(db, '2026-08-25T22:00', 120); // 22:00+120 正好压 midnight → 当日可放
  report('T4a', '恰好填满到午夜可当日放下 (start=22:00)', '2026-08-25T22:00', db.activities[1].planned_start);
}
{
  const db = freshDB();
  mk(db, '2026-08-25T23:00', 120); // 块跨午夜 23:00→次日01:00
  const r = mk(db, '2026-08-25T23:30', 60); // 期望落点不与之重叠（次日同时刻或更晚）
  const b = db.activities[1], a0 = db.activities[0];
  const wb = E.activityWindow(b), wa = E.activityWindow(a0);
  const overlap = wb.start < wa.end && wa.start < wb.end;
  report('T4b', '跨午夜块：新活动不重叠(实际落到 ' + b.planned_start + ')', false, overlap);
}

// ---------- T4c: 跨午夜时长永远放不下 → 静默顺延30天 ----------
{
  const db = freshDB();
  mk(db, '2026-08-25T23:00', 60);            // A 占 23:00-24:00（次日00:00）
  const r = mk(db, '2026-08-25T23:30', 60);  // B 与 A 真实重叠 → 触发顺延
  const b = db.activities[1];
  const gapDays = (E.activityWindow(b).start - E.activityWindow(db.activities[0]).start) / 86400000;
  console.log(`     [info] T4c shifted=${!!r.shifted} 实际落到=${b.planned_start} 距期望起点 ${gapDays.toFixed(1)} 天`);
  report('T4c', `跨午夜时长顺延应落在近邻空槽，实际被推 ${gapDays.toFixed(0)} 天后(${b.planned_start})`, true, gapDays <= 2);
}
// ---------- T4d: 30天兜底落点可与占用块重叠（原子性静默失守） ----------
{
  const db = freshDB();
  // 连造 31 天每天 23:30-24:30 的占块（跨午夜），再投一个同刻活动
  let base = new Date(2026, 7, 25);
  for (let i = 0; i < 31; i++) {
    const ps = `${base.getFullYear()}-${base.getMonth() + 1}-${base.getDate()}T23:30`;
    mk(db, ps, 60, false, 'blk' + i); // 各自跨午夜互不相邻日重叠？23:30+60m=次日00:30，与前一日块尾00:30相触不重叠
    base.setDate(base.getDate() + 1);
  }
  const r = mk(db, '2026-08-25T22:00', 90, false, 'NEW'); // 22:00-23:30 相触不冲突? 22:00+90=23:30 恰好贴上
  // 改成真正会撞的：23:45 开始 60 分钟
  const db2 = freshDB();
  base = new Date(2026, 7, 25);
  for (let i = 0; i < 31; i++) {
    const ps = `${base.getFullYear()}-${base.getMonth() + 1}-${base.getDate()}T23:45`;
    mk(db2, ps, 60, false, 'blk' + i); // 每天 23:45→次日00:45
    base.setDate(base.getDate() + 1);
  }
  mk(db2, '2026-08-25T23:45', 60, false, 'NEW'); // 同刻必撞 → 顺延路径
  const nu = db2.activities[db2.activities.length - 1];
  const wn = E.activityWindow(nu);
  const clash = db2.activities.some((x) => x !== nu && (() => { const w = E.activityWindow(x); return w && wn.start < w.end && w.start < wn.end; })());
  console.log(`     [info] T4d NEW 实际落到=${nu.planned_start} 与既有占块是否重叠=${clash}`);
  report('T4d', '30天兜底落点不应与任何占块重叠（实际重叠=' + clash + '，原子性静默失守）', false, clash);
}
// ---------- T5a: deleteActivity 留下孤儿冲突 id ----------
{
  const db = freshDB();
  mk(db, '2026-08-25T09:00', 60, true, 'A');
  mk(db, '2026-08-25T09:30', 60, true, 'B'); // keep → 双向捆绑
  const bid = idOf(db, 1);
  E.deleteActivity(db, bid);
  const a = db.activities[0];
  report('T5a', '删除 B 后 A.conflicts 应为空（实际残留孤儿id=' + JSON.stringify(a.conflicts) + '）', [], a.conflicts);
}
// ---------- T5b: deleteActivityCascade 同样留孤儿 ----------
{
  const db = freshDB();
  mk(db, '2026-08-25T09:00', 60, true, 'A');
  mk(db, '2026-08-25T09:30', 60, true, 'B');
  const bid = idOf(db, 1);
  E.deleteActivityCascade(db, bid);
  const a = db.activities[0];
  report('T5b', '级联删 B 后 A.conflicts 应为空（实际=' + JSON.stringify(a.conflicts) + '）', [], a.conflicts);
}
// ---------- T5c: startActivity override='first' 后第三方捆绑变陈旧 ----------
{
  const db = freshDB();
  mk(db, '2026-08-25T09:00', 120, true, 'A');   // 09:00-11:00
  mk(db, '2026-08-25T09:30', 60, true, 'B');    // 与 A、C 都捆绑
  mk(db, '2026-08-25T10:00', 60, true, 'C');    // 10:00-11:00
  const b = db.activities[1], c = db.activities[2];
  const r = E.startActivity(db, idOf(db, 0), { override: 'first' }); // A 先做，B/C 被挪走
  const movedOverlap = (() => { const wb = E.activityWindow(b), wc = E.activityWindow(c); return wb.start < wc.end && wc.start < wb.end; })();
  console.log(`     [info] first仲裁后 B=${b.planned_start} C=${c.planned_start} B↔C是否仍重叠=${movedOverlap}`);
  report('T5c', 'B 被挪走后其 conflicts 里对 C 的捆绑应清除（实际B.conflicts=' + JSON.stringify(b.conflicts) + ', C.conflicts=' + JSON.stringify(c.conflicts) + '）', [[], []], [b.conflicts, c.conflicts]);
}
// ---------- T6 引擎侧佐证: 完成一侧后捆绑不清理（B6 已修；场景改为先开始后捆绑的真实路径） ----------
{
  const db = freshDB();
  mk(db, '2026-08-25T09:00', 60, false, 'A');
  E.startActivity(db, idOf(db, 0)); // A 先开始（无捆绑无仲裁）
  mk(db, '2026-08-25T09:30', 60, true, 'B'); // 与进行中的 A 重叠且显式保留 → 捆绑
  const b = db.activities[1];
  E.completeActivity(db, idOf(db, 0), { expense: { resource_id: 'r1', amount: 1 }, output_title: 'o' });
  // 日历 agendaRow 只要 conflicts 非空就画 ⚠；B6 修复后完成即解除全部捆绑
  report('T6', '对手已 Completed，Planned 方 conflicts 应清空（UI不再误报⚠；实际=' + JSON.stringify(b.conflicts) + '）', [], b.conflicts);
}

// ---------- T1a: parseDt 对非法时分静默进位 → B7 入口校验已修复为拒绝 ----------
{
  const db = freshDB();
  const r = mk(db, '2026-08-25T25:70', 60, false, 'X'); // 小时25 分70
  report('T1a', "'T25:70' 应被入口校验拒绝（B7 已修，实际=" + JSON.stringify(r) + "）", false, r.ok);
  report('T1a2', '被拒活动未入库', 0, db.activities.length);
}
// ---------- T1b: 分钟个位数 'T9:5' → B8 入口校验拒绝；缺省字段的更新不擦除既有窗口 ----------
{
  const db = freshDB();
  const rb = mk(db, '2026-08-25T09:5', 60, true, 'B'); // 模拟导入脏数据走入口（分钟个位）
  report('T1b', "'T9:5' 应被入口校验拒绝", false, rb.ok);
  mk(db, '2026-08-25T09:00', 60, true, 'A');
  const ra = mk(db, '2026-08-25T11:00', 60, true, 'C'); // 合法创建放行（空闲槽，无原子性干扰）
  const c = db.activities[db.activities.length - 1];
  E.updateActivity(db, c.id, { title: 'C', planned_minutes: 61 }); // 缺省 planned_start 的更新（B8 无擦除）
  report('T1b2', '合法创建仍放行', true, ra.ok);
  report('T1b3', '缺省时间字段更新保留原窗口（不弹性化、planned_end 重推）', true, c.planned_start === '2026-08-25T11:00' && !!E.activityWindow(c) && E.activityWindow(c).end - E.activityWindow(c).start === 61 * 60000);
}

// ---------- T7: fmtDt/parseDt 往返 & 午夜 ----------
{
  const db = freshDB();
  mk(db, '2026-08-25T23:30', 45); // 跨 midnight
  const a = db.activities[0], w = E.activityWindow(a);
  const roundTrip = new Date(a.planned_end.replace(/-/g, '/')).getTime(); // 用宽松解析对照
  const direct = new Date(2026, 7, 26, 0, 15).getTime();
  report('T7a', '跨午夜 planned_end=次日00:15', direct, w.end);
  const reparse = (() => { const m = a.planned_end.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/); return m ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]).getTime() : NaN; })();
  report('T7b', 'fmtDt 输出可被严格格式无损回读（往返一致）', w.end, reparse);
}

console.log(`\n==== 结果: ${bugN} 个真bug / ${passN} 个通过(含误报排除) ====`);
