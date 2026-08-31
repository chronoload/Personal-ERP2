// tests/agentMCP.test.js
// L4 agent MCP 适配器：结果信封、输入校验、边界去身份、授权门槛（TDD）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAgentMCP } from '../src/services/agentMCP.js';

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
    getAnonymousSpectrum: opts.getAnonymousSpectrum ?? (() => []),
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
});

test('agentMCP: 授权门槛 — 未授权 community.matchPatterns 返回 ERR_AUTH_DENIED', () => {
  const ctx = mkCtx({ communityAuth: false });
  const { call } = createAgentMCP(ctx);
  const r = call('community.matchPatterns', {});
  assert.equal(r.ok, false);
  assert.equal(r.error?.code, 'ERR_AUTH_DENIED');
});

test('agentMCP: 授权门槛 — 已授权 community.matchPatterns 返回 pattern-list + 保底提议', () => {
  // 构造一个匿名谱（与本地轨迹相似）以触发匹配
  const localSig = { v: 1, t0Week: 0, len: 4, events: [{ k: 'g' }, { k: 'p' }, { k: 'o' }, { k: 'v' }], counts: { g: 1, p: 1, o: 1, v: 1 } };
  const spectrum = Array.from({ length: 6 }, () => ({ sig: localSig, groupKey: 'sim' }));
  const ctx = mkCtx({ communityAuth: true, getAnonymousSpectrum: () => spectrum });
  const { call } = createAgentMCP(ctx);
  const r = call('community.matchPatterns', {});
  assert.equal(r.ok, true);
  assert.ok(r.data.authorized === true);
  assert.ok(r.data.suppressedProfiles >= 0);
  assert.ok(Array.isArray(r.data.patterns));
  // 相似谱 ≥ minGroup → 出现组群提议，且 consentRequired:true
  assert.ok(r.data.groupProposal != null, '已授权且有相似谱时应出现组群提议');
  assert.equal(r.data.groupProposal.consentRequired, true);
});

test('agentMCP: 授权已开启但无相似谱时不应出现组群提议', () => {
  const ctx = mkCtx({ communityAuth: true, getAnonymousSpectrum: () => [] });
  const { call } = createAgentMCP(ctx);
  const r = call('community.matchPatterns', {});
  assert.equal(r.ok, true);
  assert.equal(r.data.groupProposal, null, '无相似谱时不应出现组群提议');
});
