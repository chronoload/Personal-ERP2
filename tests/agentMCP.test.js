// tests/agentMCP.test.js
// L4 agent MCP 适配器：结果信封、输入校验、边界去身份、授权门槛（TDD）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAgentMCP } from '../src/services/agentMCP.js';
import { encodeTrajectory } from '../src/domain/signature.js';

// 能编码出 g,p,o,v 各一条轨迹的账本（用于触发本地签名 = 谱中签名）
function mkSigDB() {
  return {
    schemaVersion: 3, resources: [], rules: [],
    goals: [{ id: 'g1', title: '目标', desc: '', status: 'Active', created: 0 }],
    plans: [{ id: 'p1', goal_id: 'g1', title: '写论文', budget: 100, status: 'Active', created: 2000 }],
    activities: [{ id: 'a1', title: '写', plan_ids: ['p1'], status: 'Completed', planned_minutes: 60, planned_start: null, actual_start: 1000, conflicts: [], retryCount: 0, created: 0 }],
    outputs: [{ id: 'o1', title: '稿', activity_id: 'a1', tags: ['x'], created: 3000, status: 'Closed' }],
    valueflows: [{ id: 'v1', output_id: 'o1', status: 'Closed', created: 4000, closedAt: 4000 }],
    txs: [], goods: [], seq: {},
  };
}

function mkDB() {
  return {
    schemaVersion: 3, resources: [], rules: [], goals: [],
    plans: [{ id: 'p1', goal_id: 'g1', title: '写论文', budget: 100, status: 'Active', created: 0 }],
    activities: [
      { id: 'a1', title: '写', plan_ids: ['p1'], status: 'Planned', planned_minutes: 60, planned_start: null, conflicts: [], retryCount: 0, created: 0 },
      { id: 'a2', title: '跑', plan_ids: ['p1'], status: 'Started', planned_minutes: 30, planned_start: '2026-8-26T09:00', time_logs: [{ start: 0, end: 1800000 }], conflicts: ['ax'], retryCount: 1, created: 0 },
    ],
    outputs: [], valueflows: [], txs: [], goods: [], seq: {},
  };
}
function mkCtx(opts = {}) {
  return {
    loadDb: () => opts.db ?? mkDB(),
    loadPrefs: () => ({ communityAuth: opts.communityAuth ?? false, reportRemind: true }),
    loadAnonSpectrum: opts.loadAnonSpectrum ?? (() => []), // 契约 §3.6 接缝名
    now: opts.now ?? 1700000000000,
  };
}
function envelope(t) {
  return { ok: t.ok, tool: t.tool, version: t.version };
}

test('agentMCP: 结果信封 — 工具返回 {ok, tool, version, data|error, warnings?}', () => {
  const { call } = createAgentMCP(mkCtx());
  const r = call('report.weekly', { offset: 0 });
  assert.equal(r.ok, true);
  assert.equal(r.tool, 'report.weekly');
  assert.equal(r.version, '1.0');
  assert.ok(r.data, '应有 report-v2 data');
  assert.ok(Array.isArray(r.warnings) || r.warnings === undefined);
  // 信封稳定：JSON.stringify 幂等，无 undefined
  const s = JSON.stringify(r);
  assert.ok(!s.includes('undefined'), '信封不应含 undefined');
});

test('agentMCP: 身份剥离在边界生效 — 导出面无 *_id/title/planId', () => {
  const { call } = createAgentMCP(mkCtx());
  const r = call('report.weekly', { offset: 0 });
  const s = JSON.stringify(r.data);
  assert.ok(!/id|title|planId|goal_id|before|after/.test(s), `导出面含身份字段: ${s.slice(0, 200)}`);
});

test('agentMCP: 输入校验 — 非法 offset 返回 ERR_VALIDATION', () => {
  const { call } = createAgentMCP(mkCtx());
  const r = call('report.weekly', { offset: 'abc' });
  assert.equal(r.ok, false);
  assert.equal(r.error?.code, 'ERR_VALIDATION');
});

test('agentMCP: 未知工具返回 ERR_VALIDATION', () => {
  const { call } = createAgentMCP(mkCtx());
  const r = call('unknown.tool', {});
  assert.equal(r.ok, false);
  assert.equal(r.error?.code, 'ERR_VALIDATION');
  assert.ok(r.error.message.includes('未知工具'));
});

test('agentMCP: learn.features 导出去身份（stripFeatureIdentity）', () => {
  const { call } = createAgentMCP(mkCtx());
  const r = call('learn.features', {});
  assert.equal(r.ok, true);
  const s = JSON.stringify(r.data);
  assert.ok(!/planId|goalId/.test(s), 'feature-set 不应含 planId/goalId');
});

test('agentMCP: recommend.next 返回排名（UCB 探索 + 保底）', () => {
  const { call } = createAgentMCP(mkCtx());
  const r = call('recommend.next', { limit: 3, k: 1 });
  assert.equal(r.ok, true);
  assert.ok(Array.isArray(r.data));
  assert.ok(r.data.length <= 3);
  // 降序
  for (let i = 1; i < r.data.length; i++) assert.ok(r.data[i - 1].score >= r.data[i].score);
});

test('agentMCP: recommend.slot 返回时段插入', () => {
  const { call } = createAgentMCP(mkCtx());
  const r = call('recommend.slot', { freeMinutes: 30 });
  assert.equal(r.ok, true);
  assert.ok(Array.isArray(r.data));
  // 契约 §3.5：输出形状 { activityId, slotStart(ms), score }
  for (const s of r.data) {
    assert.ok(s.activityId != null);
    assert.equal(typeof s.slotStart, 'number');
    assert.equal(typeof s.score, 'number');
  }
});

test('agentMCP: recommend.slot — 缺 freeMinutes（必填）返回 ERR_VALIDATION', () => {
  const { call } = createAgentMCP(mkCtx());
  const r = call('recommend.slot', {});
  assert.equal(r.ok, false);
  assert.equal(r.error?.code, 'ERR_VALIDATION');
});

test('agentMCP: recommend.next — limit/k 越界返回 ERR_VALIDATION（契约范围）', () => {
  const { call } = createAgentMCP(mkCtx());
  assert.equal(call('recommend.next', { limit: 0 }).error?.code, 'ERR_VALIDATION');
  assert.equal(call('recommend.next', { limit: 21 }).error?.code, 'ERR_VALIDATION');
  assert.equal(call('recommend.next', { k: 11 }).error?.code, 'ERR_VALIDATION');
});

test('agentMCP: 授权门槛 — 未授权 community.matchPatterns 返回 ERR_AUTH_DENIED', () => {
  const ctx = mkCtx({ communityAuth: false });
  const { call } = createAgentMCP(ctx);
  const r = call('community.matchPatterns', {});
  assert.equal(r.ok, false);
  assert.equal(r.error?.code, 'ERR_AUTH_DENIED');
});

test('agentMCP: 授权门槛 — 已授权 community.matchPatterns 返回 PatternList(契约 §3.6)', () => {
  // 用能编码出签名（g,p,o,v）的账本：本机签名与谱中签名一致 → similarity=1，触发匹配
  const db = mkSigDB();
  const localSig = encodeTrajectory(db);
  const spectrum = Array.from({ length: 6 }, () => ({ sig: localSig, groupKey: 'sim' }));
  const ctx = mkCtx({ communityAuth: true, db, loadAnonSpectrum: () => spectrum });
  const { call } = createAgentMCP(ctx);
  const r = call('community.matchPatterns', {});
  assert.equal(r.ok, true);
  // 契约 §3.6 PatternList：patterns/localSignature/groupProposal/suppressed
  assert.ok(Array.isArray(r.data.patterns) && r.data.patterns.length > 0, '相似谱应产出 ≥1 条样板');
  const p0 = r.data.patterns[0];
  assert.equal(typeof p0.similarity, 'number');
  assert.equal(p0.eventSequence, 'gpov'); // 事件类型序（k 拼接）
  assert.equal(p0.groupKey, 'sim');
  assert.equal(p0.sampleCount, 6); // k-匿名保留组 n=6≥5
  // localSignature：v/len/counts/eventSequence
  assert.equal(r.data.localSignature.v, 1);
  assert.equal(r.data.localSignature.len, localSig.len);
  assert.deepEqual(r.data.localSignature.counts, { g: 1, p: 1, o: 1, v: 1 });
  assert.equal(r.data.localSignature.eventSequence, 'gpov');
  // 组群提议：候选 ≥ 阈值 → 出现，且 consentRequired 永远为 true
  assert.ok(r.data.groupProposal != null);
  assert.equal(r.data.groupProposal.consentRequired, true);
  assert.equal(typeof r.data.groupProposal.candidatePatterns, 'number');
  assert.equal(typeof r.data.groupProposal.threshold, 'number');
  assert.equal(typeof r.data.suppressed, 'number');
});

test('agentMCP: 授权已开启但无相似谱时不应出现组群提议', () => {
  const ctx = mkCtx({ communityAuth: true, loadAnonSpectrum: () => [] });
  const { call } = createAgentMCP(ctx);
  const r = call('community.matchPatterns', {});
  assert.equal(r.ok, true);
  assert.deepEqual(r.data.patterns, []);
  assert.equal(r.data.groupProposal, null, '无相似谱时不应出现组群提议');
  assert.equal(r.data.suppressed, 0);
});

test('agentMCP: 授权开启 + k-匿名触发 → 添加抑制 warning（契约 §6c）', () => {
  // 2 个独一无二的轨迹（n=2 < k=5）→ 全部抑制，patterns 空，warning 提示
  const unique1 = { v: 1, len: 1, events: [{ k: 'g' }], counts: { g: 1, p: 0, o: 0, v: 0 } };
  const unique2 = { v: 1, len: 1, events: [{ k: 'p' }], counts: { g: 0, p: 1, o: 0, v: 0 } };
  const ctx = mkCtx({ communityAuth: true, loadAnonSpectrum: () => [
    { sig: unique1, groupKey: 'u1' }, { sig: unique2, groupKey: 'u2' },
  ] });
  const { call } = createAgentMCP(ctx);
  const r = call('community.matchPatterns', { k: 5 });
  assert.equal(r.ok, true);
  assert.deepEqual(r.data.patterns, []);
  assert.equal(r.data.suppressed, 2);
  assert.ok(r.warnings.some((w) => w.includes('k-匿名')), '应有 k-匿名抑制警告');
});
