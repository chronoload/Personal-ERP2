import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CAPITAL, analyze, sync, liquidValue, laborValue, activityHiddenByFreeze,
} from '../src/domain/capital.js';

const DAY = 86400000;

function mkDb(overrides = {}) {
  return {
    schemaVersion: 6,
    resources: [{ id: 'r1', name: '价值元', unit: '元', initial: 1000, status: 'Active' }],
    rules: [], txs: [], activities: [], goals: [{ id: 'g1', title: 'G', status: 'Active' }],
    plans: [], templates: [], capitalLock: undefined,
    ...overrides,
  };
}

function plan(id, budget, priority = 3, horizonMonths = 3, extra = {}) {
  return {
    id, goal_id: 'g1', title: id, status: 'Active', budget,
    priority, horizonMonths, budgetState: 'active', created: Date.now(), ...extra,
  };
}

test('liquidValue：按兑换规则换算到主计量单位', () => {
  const db = mkDb({
    resources: [
      { id: 'r1', name: '价值元', unit: '元', initial: 1000, status: 'Active' },
      { id: 'r2', name: '灵感', unit: '点', initial: 100, status: 'Active' },
    ],
    rules: [{ id: 'ru1', label: '灵感换元', from: 'r2', to: 'r1', rate: 2, status: 'Active' }],
  });
  const v = liquidValue(db);
  assert.equal(v.value, 1200);
  assert.equal(v.primary.id, 'r1');
  assert.deepEqual(v.unconvertible, []);
});

test('liquidValue：无换算路径的非主资源标记为不可换算，不虚增预算', () => {
  const db = mkDb({
    resources: [
      { id: 'r1', name: '价值元', unit: '元', initial: 500, status: 'Active' },
      { id: 'r2', name: '里程', unit: 'km', initial: 50, status: 'Active' },
    ],
  });
  const v = liquidValue(db);
  assert.equal(v.value, 500);
  assert.deepEqual(v.unconvertible, ['里程']);
});

test('laborValue + recommended：劳动产能按历史收入/计时折算，并受资本上限约束', () => {
  const now = Date.now();
  const db = mkDb({
    activities: [{ id: 'a1', title: 'A', plan_ids: ['p1'], time_logs: [{ start: now - 3600000, end: now }] }],
    txs: [{ source_type: 'activity', source_id: 'a1', resource_id: 'r1', debit: 600, credit: 0, created: now - 1000 }],
    plans: [plan('p1', 1000)],
  });
  const l = laborValue(db, now);
  assert.equal(l.productivity, 10);
  assert.ok(l.value > 0);
  const a = analyze(db, now);
  assert.equal(a.liquid, 1600, '初始 1000 + 收入 600');
  assert.equal(a.labor, 3200, '劳动贡献被 2×资本封顶');
  assert.equal(a.recommended, 1600 * CAPITAL.riskCoeff + 3200);
});

test('analyze：1.2× 提醒 / 1.6× 冻结；冻结按低优先级→长周期→大预算', () => {
  const now = Date.now();
  const db = mkDb({
    plans: [
      plan('p1', 500, 1, 3),
      plan('p2', 800, 5, 12),
      plan('p3', 1000, 5, 6),
      plan('p4', 700, 3, 3),
    ],
  });
  // 推荐预算 = 1000 × 0.6 = 600；承诺 3000 → 5× → freeze
  const a = analyze(db, now);
  assert.equal(a.recommended, 600);
  assert.equal(a.level, 'freeze');
  assert.deepEqual(a.toFreezeIds, ['p2', 'p3', 'p4'], '低优先级/长周期先冻，冻到活跃负荷 ≤1.4×');
  assert.equal(a.committedAfter, 500);
});

test('analyze：回到 1.2× 以内按逆序解冻，且加回后仍不超过 1.2×', () => {
  const now = Date.now();
  const db = mkDb({
    plans: [
      plan('p3', 1000, 5, 6, { budgetState: 'frozen' }),
      plan('p2', 800, 5, 12, { budgetState: 'frozen' }),
      plan('p1', 500, 1, 3),
    ],
  });
  // 推荐 2000.4，总组合 2300 → 1.15× ≤1.2×，冻结项可以全部放回
  db.resources = [{ id: 'r1', name: '价值元', unit: '元', initial: 3334, status: 'Active' }];
  const a = analyze(db, now);
  assert.ok(Math.abs(a.recommended - 2000.4) < 0.01);
  assert.deepEqual(a.toThawIds, ['p3', 'p2'], '短周期先放回');
});

test('死账：90 天无活动/流水才标红，归档完成不纳入', () => {
  const now = Date.now();
  const db = mkDb({
    plans: [
      plan('p1', 100, 3, 3, { created: now - 100 * DAY }),
      plan('p2', 100, 3, 3, { created: now - 100 * DAY }),
      plan('p3', 100, 3, 3, { created: now - 100 * DAY, status: 'Archived' }),
    ],
    activities: [{ id: 'a1', plan_ids: ['p2'], created: now - 5 * DAY, time_logs: [] }],
  });
  const a = analyze(db, now);
  assert.deepEqual(a.deadPlanIds, ['p1']);
  assert.deepEqual(a.deadGoalIds, [], '目标下还有活跃计划，不算死目标');
});

test('sync：自动冻结并加锁；幂等重跑不再改动', () => {
  const now = Date.now();
  const db = mkDb({
    plans: [plan('p2', 800, 5, 12), plan('p3', 1000, 5, 6), plan('p1', 500, 1, 3)],
  });
  const r1 = sync(db, now);
  assert.equal(r1.changed, true);
  assert.equal(db.plans.find((p) => p.id === 'p2').budgetState, 'frozen');
  assert.equal(db.plans.find((p) => p.id === 'p3').budgetState, 'frozen');
  assert.equal(db.capitalLock, true, '总组合仍 5×，锁新增');
  const r2 = sync(db, now);
  assert.equal(r2.changed, false);
});

test('activityHiddenByFreeze：所有关联计划冻结才隐藏', () => {
  const db = mkDb({
    plans: [plan('p1', 1, 3, 3, { budgetState: 'frozen' }), plan('p2', 1, 3, 3)],
  });
  assert.equal(activityHiddenByFreeze(db, { plan_ids: ['p1'] }), true);
  assert.equal(activityHiddenByFreeze(db, { plan_ids: ['p1', 'p2'] }), false);
  assert.equal(activityHiddenByFreeze(db, { plan_ids: [] }), false);
});
