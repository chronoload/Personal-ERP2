// tests/erpMCP.test.js
// 外部 MCP 工具面：开关封闭、只读投影、只追加写入、协议往返（TDD）
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { callTool, createContext } from '../mcp/tools.mjs';
import { readDb, writeDb } from '../mcp/db-file.mjs';
import { handleLine } from '../mcp/server.mjs';

function tmpFile(name = 'erp-db.json') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-mcp-'));
  return path.join(dir, name);
}

function baseDb({ mcpEnabled = true } = {}) {
  return {
    schemaVersion: 6,
    seq: {},
    resources: [{ id: 'r1', name: '价值元', unit: '价值元', initial: 1000, status: 'Active', created: 1 }],
    rules: [],
    goals: [],
    plans: [],
    activities: [],
    txs: [],
    outputs: [],
    valueflows: [],
    goods: [],
    journals: [],
    places: [],
    commutes: [],
    templates: [],
    capitalLock: false,
    mcp: { enabled: mcpEnabled, updatedAt: Date.now() },
  };
}

function setup(dbOpts) {
  const file = tmpFile();
  writeDb(baseDb(dbOpts), file);
  const ctx = createContext({ file, read: () => readDb(file), append: (db) => writeDb(db, file) });
  return { file, ctx };
}

test('erpMCP 开关：未开启时一切工具被拒绝（ERR_AUTH_DENIED）', () => {
  const { ctx } = setup({ mcpEnabled: false });
  for (const tool of ['erp.status', 'erp.goals', 'erp.add_goal']) {
    const r = callTool(tool, {}, ctx);
    assert.equal(r.ok, false);
    assert.equal(r.error.code, 'ERR_AUTH_DENIED');
  }
});

test('erpMCP 开关：文件不存在 → ERR_NO_DATA，不抛异常', () => {
  const file = tmpFile('missing.json');
  const ctx = createContext({ file, read: () => readDb(file), append: (db) => writeDb(db, file) });
  const r = callTool('erp.status', {}, ctx);
  assert.equal(r.ok, false);
  assert.equal(r.error.code, 'ERR_NO_DATA');
});

test('erpMCP 开关：库结构里没有 mcp 字段时，归一化后默认关闭', () => {
  const file = tmpFile();
  const db = baseDb();
  delete db.mcp; // 模拟旧库 / 手工库
  writeDb(db, file);
  assert.equal(readDb(file).mcp.enabled, false);
  const ctx = createContext({ file, read: () => readDb(file), append: (db2) => writeDb(db2, file) });
  assert.equal(callTool('erp.status', {}, ctx).error.code, 'ERR_AUTH_DENIED');
});

test('erp.status：返回计数、余额与预算口径', () => {
  const { ctx } = setup();
  const r = callTool('erp.status', {}, ctx);
  assert.equal(r.ok, true);
  assert.equal(r.tool, 'erp.status');
  assert.equal(r.version, '1.0');
  assert.equal(r.data.counts.goals, 0);
  assert.equal(r.data.resources[0].name, '价值元');
  assert.equal(typeof r.data.budget.recommended, 'number');
  assert.equal(r.data.budget.addLocked, false);
});

test('erp.add_goal / erp.add_plan / erp.add_activity：只追加并落盘', () => {
  const { file, ctx } = setup();
  const g = callTool('erp.add_goal', { title: '学业主线' }, ctx);
  assert.equal(g.ok, true);
  assert.equal(g.data.id, 'g1');

  const p = callTool('erp.add_plan', { goalId: 'g1', title: '课程闭环', budget: 900 }, ctx);
  assert.equal(p.ok, true);
  assert.equal(p.data.id, 'p1');
  assert.equal(p.data.status, 'Incubating');

  const a = callTool('erp.add_activity', { title: '写周报', planId: 'p1', start: '09:00', minutes: 45 }, ctx);
  assert.equal(a.ok, true);
  assert.equal(a.data.id, 'a1');
  assert.match(a.data.planned_start, /^\d{4}-\d{2}-\d{2}T09:00$/);

  const back = readDb(file);
  assert.equal(back.goals.length, 1);
  assert.equal(back.plans.length, 1);
  assert.equal(back.activities.length, 1);
  assert.equal(back.seq.g, 1);
  assert.equal(back.seq.a, 1);
  assert.equal(back.mcp.enabled, true, '写回后开关状态保留');
});

test('erp.add_activity：不给钟点时归到当天日期', () => {
  const { ctx } = setup();
  const a = callTool('erp.add_activity', { title: '复盘', date: '2026-11-01', minutes: 30 }, ctx);
  assert.equal(a.ok, true);
  assert.equal(a.data.planned_date, '2026-11-1');
  assert.equal(a.data.planned_start, null);
});

test('erp.add_tx：记收入走 debit，记支出走 credit', () => {
  const { file, ctx } = setup();
  const inc = callTool('erp.add_tx', { direction: 'income', amount: 100, note: '稿费' }, ctx);
  assert.equal(inc.ok, true);
  assert.equal(inc.data.debit, 100);
  const exp = callTool('erp.add_tx', { direction: 'expense', amount: 30, note: '早餐' }, ctx);
  assert.equal(exp.ok, true);
  assert.equal(exp.data.credit, 30);
  assert.equal(readDb(file).txs.length, 2);

  const bad = callTool('erp.add_tx', { direction: 'topup', amount: 10 }, ctx);
  assert.equal(bad.ok, false);
  assert.equal(bad.error.code, 'ERR_VALIDATION');
});

test('erp.append_journal：只追加，不覆盖已有正文', () => {
  const file = tmpFile();
  const db = baseDb();
  db.journals.push({ id: 'j1', date: '2026-11-1', md: '原有一行\n', parses: [] });
  writeDb(db, file);
  const ctx = createContext({ file, read: () => readDb(file), append: (db2) => writeDb(db2, file) });

  const r = callTool('erp.append_journal', { date: '2026-11-1', text: '追加一行' }, ctx);
  assert.equal(r.ok, true);
  const md = readDb(file).journals[0].md;
  assert.ok(md.startsWith('原有一行'), '旧正文必须保留');
  assert.ok(md.includes('追加一行'));
});

test('erp.activities：按日期过滤', () => {
  const { ctx } = setup();
  callTool('erp.add_activity', { title: 'A', date: '2026-11-01', start: '09:00', minutes: 30 }, ctx);
  callTool('erp.add_activity', { title: 'B', date: '2026-11-02', start: '09:00', minutes: 30 }, ctx);
  const r = callTool('erp.activities', { date: '2026-11-01' }, ctx);
  assert.equal(r.ok, true);
  assert.equal(r.data.length, 1);
  assert.equal(r.data[0].title, 'A');
});

test('MCP 协议：initialize / tools/list / tools/call', () => {
  const { file } = setup();
  const ctx = createContext({ file, read: () => readDb(file), append: (db) => writeDb(db, file) });

  const init = JSON.parse(handleLine('{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18"}}', ctx));
  assert.equal(init.result.protocolVersion, '2025-06-18');
  assert.equal(init.result.serverInfo.name, 'personal-erp');

  const list = JSON.parse(handleLine('{"jsonrpc":"2.0","id":2,"method":"tools/list"}', ctx));
  assert.ok(list.result.tools.length >= 9);
  assert.ok(list.result.tools.every((t) => t.name && t.inputSchema));

  const call = JSON.parse(handleLine('{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"erp.status","arguments":{}}}', ctx));
  const envelope = JSON.parse(call.result.content[0].text);
  assert.equal(envelope.ok, true);
  assert.equal(call.result.isError, false);

  const denied = JSON.parse(handleLine('{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"erp.status","arguments":{}}}', {
    file: () => tmpFile('none.json'), read: () => null, append: () => {},
  }));
  assert.equal(JSON.parse(denied.result.content[0].text).error.code, 'ERR_NO_DATA');
  assert.equal(denied.result.isError, true);

  assert.equal(handleLine('not json', ctx), JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }));
  assert.equal(handleLine('{"jsonrpc":"2.0","method":"notifications/initialized"}', ctx), null);
  assert.equal(handleLine('{"jsonrpc":"2.0","id":5,"method":"nope"}', ctx).includes('-32601'), true);
});

test('写入是只追加：工具面里没有任何 update / delete 工具', () => {
  const names = ['erp.status', 'erp.goals', 'erp.activities', 'erp.transactions', 'erp.journal',
    'erp.add_goal', 'erp.add_plan', 'erp.add_activity', 'erp.add_tx', 'erp.append_journal'];
  assert.ok(names.every((n) => !/update|delete|remove|edit|set/i.test(n)));
});
