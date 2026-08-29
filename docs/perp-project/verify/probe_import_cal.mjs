// 探针：B7/B8 导入时间消毒（importMerge.js）+ B6 日历显示侧有效对手谓词（calendar.js）
// 只读验证：不修改 src/tests，仅在 docs/perp-project/verify/ 下自证
import { seedDB } from '../../../src/store/db.js';
import { mergeImport } from '../../../src/domain/importMerge.js';
import { activityWindow } from '../../../src/domain/engine.js';

let passN = 0, failN = 0;
function check(id, name, expect, actual) {
  const ok = Object.is(expect, actual) || JSON.stringify(expect) === JSON.stringify(actual);
  if (ok) { passN++; console.log(`PASS ${id} ${name} => ${JSON.stringify(actual)}`); }
  else { failN++; console.log(`FAIL ${id} ${name} 期望=${JSON.stringify(expect)} 实际=${JSON.stringify(actual)}`); }
}

// ---------- Part 1: 导入合并消毒 ----------
{
  const db = seedDB();
  const incoming = {
    resources: [{ id: 'rX', name: '新资源', unit: '个', initial: 0, status: 'Active', created: 0 }],
    activities: [
      { id: 'aG', title: '好数据', status: 'Planned', plan_ids: [], time_logs: [], conflicts: [],
        planned_start: '2026-08-25T09:00', planned_end: '2026-08-25T10:00', planned_minutes: 60,
        planned_date: '2026-8-25', repeat_until: '2026-08-30' },
      { id: 'aP1', title: '进位毒', status: 'Planned', plan_ids: [],
        planned_start: '2026-08-25T25:70', planned_end: '2026-08-25T99:99', planned_minutes: 60 },
      { id: 'aP2', title: '个位分毒', status: 'Planned', plan_ids: [],
        planned_start: '2026-08-25T9:5', planned_end: '2026-08-25T10:5', planned_minutes: 60 },
      { id: 'aP3', title: '坏重复日', status: 'Planned', plan_ids: [],
        planned_start: '2026-08-25T09:00', planned_minutes: 30, repeat_until: '2026-13-99' },
    ],
  };
  mergeImport(db, incoming);
  const find = (id) => db.activities.find((x) => x.id === id);
  const g = find('aG'), p1 = find('aP1'), p2 = find('aP2'), p3 = find('aP3');
  check('I1', '好活动 start/end 原样保留', ['2026-08-25T09:00', '2026-08-25T10:00'], [g && g.planned_start, g && g.planned_end]);
  check('I2', '好活动 repeat_until/planned_date 保留', ['2026-08-30', '2026-8-25'], [g && g.repeat_until, g && g.planned_date]);
  check('I3', "'T25:70' 毒 start/end → null", [null, null], [p1 && p1.planned_start, p1 && p1.planned_end]);
  check('I4', "'T25:70' 毒活动窗口为空（弹性安全）", true, !activityWindow(p1));
  check('I5', "'T9:5'/'T10:5' 毒 start/end → null", [null, null], [p2 && p2.planned_start, p2 && p2.planned_end]);
  check('I6', "repeat_until '2026-13-99' → null", null, p3 && p3.repeat_until);
  check('I7', '消毒不外溢：资源正常并入', true, db.resources.some((r) => r.name === '新资源'));
}

// ---------- Part 2: 日历显示侧有效对手谓词（复刻 agendaRow 判定） ----------
function effectiveRivals(db, a) {
  return (a.conflicts || [])
    .map((cid) => db.activities.find((x) => x.id === cid))
    .filter((o) => o && o.status === 'Planned'
      && (() => { const w1 = activityWindow(a), w2 = activityWindow(o); return !!(w1 && w2) && w1.start < w2.end && w2.start < w1.end; })());
}
function mkAct(id, ps, mins, status = 'Planned') {
  return { id, title: id, status, plan_ids: [], planned_start: ps, planned_end: null, planned_minutes: mins };
}
{
  const db = { activities: [] };
  const me = mkAct('me', '2026-08-25T09:00', 60);
  me.conflicts = ['done', 'ghost', 'moved'];
  db.activities.push(me,
    mkAct('done', '2026-08-25T09:30', 60, 'Completed'), // 已完成
    // ghost: 已删除，db 中无此 id
    mkAct('moved', '2026-08-25T15:00', 60));            // 已挪开不再重叠
  check('C1', '对手已 Completed → 不再显示 ⚠', 0, effectiveRivals(db, me).length);
  check('C2', '对手已删除 → 不再显示 ⚠', false, effectiveRivals(db, me).some((o) => o.id === 'ghost'));
  me.conflicts.push('live');
  db.activities.push(mkAct('live', '2026-08-25T09:30', 60)); // 存活 Planned 重叠对手
  check('C3', '存活 Planned 重叠对手 → 显示 ⚠ 且提示其标题', ['live'], effectiveRivals(db, me).map((o) => o.id));
}

// ---------- Part 3: 不变量② 导入侧弹性兜底（幽灵完成降级） ----------
{
  const db = seedDB();
  const incoming = {
    resources: [],
    rules: [], goals: [], plans: [],
    activities: [
      { id: 'legit', title: '合法计划', status: 'Planned', plan_ids: [],
        planned_start: '2026-08-26T09:00', planned_end: '2026-08-26T10:00', planned_minutes: 60 },
      { id: 'ghostA', title: '幽灵完成', status: 'Completed', plan_ids: [],
        actual_start: '2026-08-25T08:00', actual_end: '2026-08-25T09:00', planned_minutes: 60 },
      { id: 'okC', title: '有账完成', status: 'Completed', plan_ids: [], created: 0 },
    ],
    txs: [{ id: 'txOK', resource_id: 'r1', direction: 'debit', amount: 5,
      source_type: 'activity', source_id: 'okC', reversal_of: null, date: '2026-08-25T09:00' }],
    outputs: [{ id: 'outOK', title: '产物', activity_id: 'okC', tags: [], status: 'Draft', created: 0 }],
    valueflows: [], goods: [],
  };
  mergeImport(db, incoming);
  const find = (id) => db.activities.find((x) => x.id === id);
  const g = find('ghostA'), l = find('legit'), ok = find('okC');
  check('J1', '无流水无产出的 Completed 幽灵 → 降级 Planned', 'Planned', g && g.status);
  check('J2', '幽灵 actual_start/actual_end 清空', [null, null], [g && g.actual_start, g && g.actual_end]);
  check('J3', '合法 Planned 原样保留', ['Planned', '2026-08-26T09:00'], [l && l.status, l && l.planned_start]);
  check('J4', '带流水+产出的 Completed 不误伤', 'Completed', ok && ok.status);
}

console.log(`\n==== 探针结果: ${passN} 通过 / ${failN} 失败 ====`);
if (failN > 0) process.exit(1);
