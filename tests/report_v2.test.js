// tests/report_v2.test.js
// 周报/月报 v2：活动级明细 / 时间估计偏差 / 价值产出 / 排程健康 / 预算资源趋势 + meta 特征种子（TDD）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildReport, stripIdentity } from '../src/domain/report.js';

function ms(s) {
  const [d, t] = s.split('T');
  const [y, m, dd] = d.split('-').map(Number);
  const [hh, mi] = t.split(':').map(Number);
  return new Date(y, m - 1, dd, hh, mi).getTime();
}

// 本周（2026-8-24 周一 ~ 8-30 周日），now 用周六 8-29
function freshDB() {
  return {
    resources: [
      { id: 'r1', name: '价值元', unit: '元', initial: 100, status: 'Active', created: 0 },
      { id: 'r2', name: '精力', unit: '点', initial: 50, status: 'Active', created: 0 },
    ],
    plans: [
      { id: 'p1', goal_id: 'g1', title: '写作', budget: 100, status: 'Active', created: 0 },
      { id: 'p2', goal_id: null, title: '杂务', budget: 50, status: 'Active', created: 0 },
    ],
    goals: [{ id: 'g1', title: '出版一本书', desc: '', status: 'Active', created: 0 }],
    activities: [
      // 完成活动：60 分钟计划，实际 time_logs 90 分钟 → 偏差 1.5；有挂账；有输出→价值流
      {
        id: 'a1', title: '写稿', plan_ids: ['p1'], status: 'Completed',
        planned_minutes: 60, planned_start: '2026-8-25T09:00',
        actual_start: ms('2026-8-25T09:00'), actual_end: ms('2026-8-25T10:30'),
        time_logs: [{ start: ms('2026-8-25T09:00'), end: ms('2026-8-25T10:30') }],
        conflicts: [], retryCount: 0, created: ms('2026-8-24T08:00'),
      },
      // 失败活动：30 分钟计划，无 time_logs、无实际 → actual_minutes 0；retryCount 2；冲突 1
      {
        id: 'a2', title: '排版', plan_ids: ['p1'], status: 'Failed',
        planned_minutes: 30, planned_start: '2026-8-26T09:00',
        actual_start: null, actual_end: ms('2026-8-26T09:10'),
        time_logs: [], conflicts: ['ax'], retryCount: 2, created: ms('2026-8-25T08:00'),
      },
      // 弹性活动（无时长无时间）：不计入时间偏差
      {
        id: 'a3', title: '散步', plan_ids: ['p2'], status: 'Completed',
        planned_minutes: 0, planned_start: null,
        actual_start: ms('2026-8-27T08:00'), actual_end: ms('2026-8-27T08:40'),
        time_logs: [], conflicts: [], retryCount: 0, created: ms('2026-8-27T07:00'),
      },
      // 上周活动（出界）：不应出现在本期明细
      { id: 'a4', title: '旧活', plan_ids: [], status: 'Completed', planned_minutes: 10,
        planned_start: '2026-8-20T09:00', actual_start: ms('2026-8-20T09:00'), actual_end: ms('2026-8-20T09:10'),
        time_logs: [], conflicts: [], retryCount: 0, created: ms('2026-8-19T08:00') },
    ],
    txs: [
      // a1 挂账：支出 10 value元 + 收入 5 value元 + 耗精力 3
      { id: 't1', resource_id: 'r1', debit: 0, credit: 10, source_type: 'activity', source_id: 'a1', note: 'x', reversal_of: null, created: ms('2026-8-25T10:01') },
      { id: 't2', resource_id: 'r1', debit: 5, credit: 0, source_type: 'activity', source_id: 'a1', note: 'y', reversal_of: null, created: ms('2026-8-25T10:02') },
      { id: 't3', resource_id: 'r2', debit: 0, credit: 3, source_type: 'activity', source_id: 'a1', note: 'z', reversal_of: null, created: ms('2026-8-25T10:03') },
      // 冲正 t2 → 反冲 5（本期，抵 a1 收入）
      { id: 't4', resource_id: 'r1', debit: 5, credit: 0, source_type: 'reversal', source_id: 't2', note: 'rev', reversal_of: 't2', created: ms('2026-8-26T09:00') },
    ],
    outputs: [
      { id: 'o1', title: '第一章', tags: [], note: '', status: 'Archived', activity_id: 'a1', created: ms('2026-8-25T10:30') },
    ],
    valueflows: [
      { id: 'v1', output_id: 'o1', giver: '', receiver: '', status: 'Pending', created: ms('2026-8-25T10:30') },
    ],
    goods: [], rules: [], seq: {},
  };
}

const NOW = ms('2026-8-29T12:00');

test('v2: actDetail 活动级明细——含本期活动的行级数据', () => {
  const r = buildReport(freshDB(), { period: 'week', offset: 0, now: NOW });
  assert.ok(Array.isArray(r.actDetail), 'actDetail 存在且为数组');
  // 本期计入 a1/a2/a3；a4 上周出界不计
  const ids = r.actDetail.map((x) => x.id).sort();
  assert.deepEqual(ids, ['a1', 'a2', 'a3']);

  const a1 = r.actDetail.find((x) => x.id === 'a1');
  assert.equal(a1.planned_minutes, 60);
  assert.equal(a1.actual_minutes, 90);            // time_logs 90 分钟
  assert.equal(a1.biasRatio, 1.5);                // 90/60
  assert.deepEqual(a1.goal_ids, ['g1']);          // 经 plan_ids → goal
  assert.equal(a1.ledgerAttach.debit, 0);          // 收入 5 被冲正 → 净 0
  assert.equal(a1.ledgerAttach.credit, 13);        // 支出 10(value元) + 3(精力)
  assert.equal(a1.ledgerAttach.n, 3);              // 归因原始流水 t1/t2/t3
  assert.equal(a1.outputCount, 1);                 // o1
  assert.equal(a1.vfYield, 1);                     // v1
  assert.equal(a1.failed, false);

  const a2 = r.actDetail.find((x) => x.id === 'a2');
  assert.equal(a2.failed, true);
  assert.equal(a2.retryCount, 2);
  assert.equal(a2.biasRatio, null);               // 无实际分钟 → null
  assert.equal(a2.conflictCount, 1);               // conflicts:['ax']

  const a3 = r.actDetail.find((x) => x.id === 'a3');
  assert.equal(a3.biasRatio, null);               // 弹性活动（planned_minutes=0）不算
});

test('v2: timeBias 时间估计偏差——按计划聚合 actual/planned', () => {
  const r = buildReport(freshDB(), { period: 'week', offset: 0, now: NOW });
  assert.ok(r.timeBias.byPlan, 'timeBias.byPlan 存在');
  const p1 = r.timeBias.byPlan.find((x) => x.plan_id === 'p1');
  assert.ok(p1, 'p1 有聚合行');
  // a1: 60→90 (1.5)；a2 失败无实际不计：仅统计有 actual_minutes>0 的
  assert.equal(p1.actsWithActual, 1);
  assert.equal(p1.totalPlannedMin, 60);
  assert.equal(p1.totalActualMin, 90);
  assert.equal(p1.ratio, 1.5);
  // overall
  assert.equal(r.timeBias.overall.actsWithActual, 1);
  assert.equal(r.timeBias.overall.ratio, 1.5);
});

test('v2: valueYield 价值产出——按目标/计划聚合 产出/(投入) ', () => {
  const r = buildReport(freshDB(), { period: 'week', offset: 0, now: NOW });
  const g1 = r.valueYield.byGoal.find((x) => x.goal_id === 'g1');
  assert.ok(g1, 'g1 有产出行');
  assert.equal(g1.outputCount, 1);   // o1
  assert.equal(g1.vfCount, 1);       // v1
  assert.equal(g1.actsEnded, 2);     // a1 完成 + a2 失败（都已结束的投入）
  assert.equal(g1.spentMinutes, 90); // a1 实际 90 + a2 0
  // 计划维度
  const p1 = r.valueYield.byPlan.find((x) => x.plan_id === 'p1');
  assert.ok(p1, 'p1 有产出行');
  assert.equal(p1.outputCount, 1);
  assert.equal(p1.spentMinutes, 90);
});

test('v2: schedHealth 排程健康——冲突/顺延/守约', () => {
  const r = buildReport(freshDB(), { period: 'week', offset: 0, now: NOW });
  assert.equal(r.schedHealth.actsWithConflict, 1);   // a2 有 conflicts
  assert.equal(r.schedHealth.totalConflicts, 1);
  assert.equal(r.schedHealth.timedActs, 2);          // a1(09:00) + a2(09:00) 有计划开始
  assert.equal(r.schedHealth.flexibleActs, 1);       // a3 弹性
});

test('v2: budgetTrend 预算资源趋势——资源净变化 + 冲正处理 + 计划预算超支', () => {
  const r = buildReport(freshDB(), { period: 'week', offset: 0, now: NOW });
  assert.ok(r.budgetTrend.resources, 'resources 存在');
  const r1 = r.budgetTrend.resources.find((x) => x.id === 'r1');
  // 期初 100（a4 无挂账）；期内 t2 收入 debit5 + 冲正 t4 debit5 - t1 支出 credit10 → net 0
  assert.equal(r1.before, 100);
  assert.equal(r1.after, 100);
  assert.equal(r1.net, 0);
  assert.equal(r1.debit, 10);   // 5(income) + 5(冲正 debit)
  assert.equal(r1.credit, 10);  // 支出
  assert.equal(r1.rechargeRatio, 0.5); // debit/(debit+credit)
  // 计划预算：p1 spend = credit 13 - 冲正? plan spend 仅计活动 credit（10+3=13）
  const p1 = r.budgetTrend.plans.find((x) => x.plan_id === 'p1');
  assert.ok(p1, 'p1 预算行');
  assert.equal(p1.spend, 13);
  assert.equal(p1.budget, 100);
  assert.equal(p1.overspend, false);
});

test('v2: meta 特征种子——供 L2/L4 契约(完成率/时间偏差向量/轨迹签名占位)', () => {
  const r = buildReport(freshDB(), { period: 'week', offset: 0, now: NOW });
  assert.ok(r.meta, 'meta 存在');
  // planCompletion
  const pc = r.meta.planCompletion['p1'];
  assert.ok(pc, 'p1 完成率');
  assert.equal(pc.done, 1);    // a1
  assert.equal(pc.failed, 1);  // a2
  assert.equal(pc.total, 2);
  assert.equal(pc.rate, 0.5);
  // timeBiasVector（去身份：只有数字阵列）
  assert.ok(Array.isArray(r.meta.timeBiasVector));
  // trajectorySignatures 占位（L4 预埋）
  assert.ok(Array.isArray(r.meta.trajectorySignatures));
});

// ---------- L1: stripIdentity 去身份转换 ----------
// 递归扫描，找出任何仍是「身份泄漏面」的字段名：_id / id / title / name / before / after（余额绝对值）
function identityLeakKeys(obj, path = '') {
  const hits = [];
  if (obj === null || typeof obj !== 'object') return hits;
  if (Array.isArray(obj)) { obj.forEach((v, i) => hits.push(...identityLeakKeys(v, `${path}[${i}]`))); return hits; }
  for (const k of Object.keys(obj)) {
    if (/(^|_)(id|title|name)$/i.test(k) || /^id$/.test(k) || k === 'before' || k === 'after' || k === 'goal_id' || k === 'plan_id') {
      hits.push(`${path}.${k}`);
    }
    hits.push(...identityLeakKeys(obj[k], `${path}.${k}`));
  }
  return hits;
}

test('L1: stripIdentity 去身份 —— 导出面无任何 *_id / title / name / 余额绝对值泄漏', () => {
  const r = buildReport(freshDB(), { period: 'week', offset: 0, now: NOW });
  const s = stripIdentity(r);
  // 纯 JSON 幂等 + 无 undefined
  assert.doesNotThrow(() => JSON.stringify(s));
  const leaks = identityLeakKeys(s);
  assert.deepEqual(leaks, [], `发现身份泄漏: ${leaks.join(', ')}`);
  // label 是可读周期文本（如"8月24日 ~ 8月30日"），不算身份
  // 关键数值保持：净变动保留、绝对值(before/after)删除
  assert.ok(Array.isArray(s.balance) && s.balance.every((b) => !('before' in b)));
  assert.ok(Array.isArray(s.actDetail) && s.actDetail[0].actual_minutes === 90);
  assert.ok(Array.isArray(s.valueYield.byPlan) && Array.isArray(s.valueYield.byGoal));
  assert.ok(Array.isArray(s.meta.planCompletion) && !('p1' in s.meta));
  // ledger rows 保留单位与净变动，去掉资源名
  assert.ok(s.ledger.rows.every((x) => !('name' in x) && !('id' in x)));
});

test('L1: stripIdentity keepIdentity=true 原样返回（本地在设备用，不去身份）', () => {
  const r = buildReport(freshDB(), { period: 'week', offset: 0, now: NOW });
  const s = stripIdentity(r, { keepIdentity: true });
  assert.strictEqual(s, r, 'keepIdentity=true 应返回同一引用');
  assert.ok(s.actDetail[0].id, '本地仍保留 id');
});
