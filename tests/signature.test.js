// tests/signature.test.js
// L4 轨迹签名：事件序列编码 + 编辑距离相似度 + k-匿名抑制（TDD）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  encodeTrajectory, similarity, kAnonymitySuppress, EV,
} from '../src/domain/signature.js';

function ms(s) {
  const [d, t] = s.split('T');
  const [y, m, dd] = d.split('-').map(Number);
  const [hh, mi] = t.split(':').map(Number);
  return new Date(y, m - 1, dd, hh, mi).getTime();
}

function sampleDB() {
  const t0 = ms('2026-8-24T09:00');
  return {
    plans: [
      { id: 'p1', goal_id: 'g1', title: '写论文', budget: 100, status: 'Active', created: t0 },
      { id: 'p2', goal_id: null, title: '锻炼', budget: null, status: 'Active', created: t0 + 86400000 },
    ],
    goals: [{ id: 'g1', title: '毕业论文', desc: '', status: 'Active', created: t0 }],
    activities: [
      { id: 'a1', title: '写', plan_ids: ['p1'], status: 'Completed', created: t0, actual_start: t0, time_logs: [{ start: t0, end: t0 + 3600000 }] },
      { id: 'a2', title: '写2', plan_ids: ['p1'], status: 'Failed', created: t0 + 86400000, actual_start: t0 + 86400000, time_logs: [{ start: t0 + 86400000, end: t0 + 86400000 + 1800000 }] },
    ],
    outputs: [
      { id: 'o1', activity_id: 'a1', title: '草稿', tags: ['论文'], status: 'Published', created: t0 + 3600000 },
    ],
    valueflows: [
      { id: 'v1', output_id: 'o1', status: 'Closed', created: t0 + 3600000, closedAt: t0 + 2 * 3600000 },
    ],
  };
}

test('L4: 事件序列编码 —— 保真时序符号、周期平移去绝对指纹、无任何 *_id/title', () => {
  const sig = encodeTrajectory(sampleDB());
  assert.ok(sig.len >= 4, `应有 g/p/o/v 事件，实际 ${sig.len}`);
  assert.ok(sig.events.every((e) => Object.values(EV).includes(e.k)), '事件类型必须是枚举符号');
  // 序列按 wk 非降序（时间序）
  for (let i = 1; i < sig.events.length; i++) assert.ok(sig.events[i].wk >= sig.events[i - 1].wk);
  // 去身份：无 id / title / goal_id
  const str = JSON.stringify(sig);
  assert.ok(!/id|title|goal|_id/.test(str), '签名不含 id/title/goal_id 等身份字段');
  // 数字载荷在
  assert.ok(sig.events.some((e) => e.k === EV.goal && typeof e.actions === 'number'));
  assert.ok(sig.events.some((e) => e.k === EV.vfClosed));
  assert.ok(sig.counts.g >= 1 && sig.counts.v >= 1);
});

test('L4: 序列相似度 —— 相同=1，完全不同<1', () => {
  const db = sampleDB();
  const s1 = encodeTrajectory(db);
  const s2 = encodeTrajectory(db); // 同一 db → 相同签名
  assert.equal(similarity(s1, s2), 1);
  // 不同长度/符号序列 → 相似度 < 1
  const other = { v: 1, t0Week: 0, len: 1, events: [{ k: 'z', wk: 0 }], counts: { g: 0, p: 0, o: 0, v: 0 } };
  assert.ok(similarity(s1, other) < 1, '不同序列相似度应 < 1');
});

test('L4: k-匿名抑制 —— 样本数 < k 的独特签名被剔除，不进共享谱', () => {
  const db = sampleDB();
  const unique = { sig: encodeTrajectory(db) };
  // 5 个相同签名（含 unique 共见 5 次达到 k=5）
  const profiles = [unique, unique, unique, unique, unique];
  const res5 = kAnonymitySuppress(profiles, 5);
  assert.equal(res5.suppressed, 0, 'n=5 达到阈值不抑制');
  // 构造反指认情形：1 条独特(n=1 被抑制) + 6 条常见(n=6 达阈共享)
  const other = { sig: { v: 1, t0Week: 0, len: 1, events: [{ k: 'z', wk: 0 }], counts: { g: 0, p: 0, o: 0, v: 0 } } };
  const mixed = [unique, other, other, other, other, other, other];
  const resM = kAnonymitySuppress(mixed, 5);
  assert.equal(resM.suppressed, 1, '独特签名 n=1 < k=5 应被抑制');
  assert.equal(resM.shared.length, 6, '常见签名 n=6 ≥ k 应被共享');
});

test('L4: 空输入幂等 —— 返回空结构与相似度 1（双空）', () => {
  const e = encodeTrajectory({});
  assert.equal(e.len, 0);
  assert.deepEqual(e.counts, { g: 0, p: 0, o: 0, v: 0 });
  assert.equal(similarity(e, e), 1);
  assert.deepEqual(kAnonymitySuppress([], 5), { shared: [], suppressed: 0 });
});
