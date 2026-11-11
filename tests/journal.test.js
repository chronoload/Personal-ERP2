// tests/journal.test.js —— 日记页纯函数层（SPEC_diary.md v2）
// 核心命题：只有代码块是命令来源；幂等靠外部快照；注入是一次性单向门。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  extractBlocks, diffBlocks, splitCommands, injectJournal, makeParseRecord, fingerprint,
} from '../src/domain/journal.js';

const NOW = new Date(2026, 8, 27, 12, 0, 0).getTime(); // 2026-9-27
const DATE = '2026-9-27';

function mkDb() {
  return {
    resources: [
      { id: 'r1', name: '价值元', unit: '元', status: 'Active', initial: 100 },
      { id: 'r2', name: '灵感', unit: '点', status: 'Active', initial: 10 },
    ],
    activities: [], txs: [],
  };
}

const engine = {
  createActivity(db, { title, note, planned_start, planned_minutes }) {
    db.activities.push({ id: 'a' + (db.activities.length + 1), title, note, planned_start, planned_minutes, status: 'Planned' });
    return { ok: true };
  },
  setActivityStatus(db, id, status) {
    const a = db.activities.find((x) => x.id === id);
    if (!a) return { ok: false, error: '活动不存在' };
    a.status = status;
    return { ok: true };
  },
  adjustResource(db, rid, { direction, amount, note }) {
    db.txs.push({
      id: 't' + (db.txs.length + 1), resource_id: rid,
      debit: direction === 'debit' ? amount : 0,
      credit: direction === 'credit' ? amount : 0, note,
    });
    return { ok: true };
  },
};

// ---------- 1. 块提取：只有代码块是命令来源 ----------

test('块提取：正文列表与行内代码都不产生命令来源', () => {
  const md = [
    '今天做了几件事：',
    '- 买菜',
    '- 洗衣',
    '',
    '```',
    '- [ ] 写周报',
    '```',
    '',
    '顺便记 `-8 早餐` 一笔。',
  ].join('\n');
  const blocks = extractBlocks(md);
  assert.equal(blocks.length, 1);
  assert.ok(blocks[0].body.includes('写周报'));
});

test('块提取：带语言标记与不带语言标记都能识别', () => {
  assert.equal(extractBlocks('```erp\n-8 早餐\n```').length, 1);
  assert.equal(extractBlocks('```\n-8 早餐\n```').length, 1);
});

test('块提取：多个块各自成条，序号连续', () => {
  const md = '```\n-8 早餐\n```\n\n叙述\n\n```\n+100 工资\n```';
  const blocks = extractBlocks(md);
  assert.equal(blocks.length, 2);
  assert.deepEqual(blocks.map((b) => b.index), [0, 1]);
});

test('块提取：无块 / 空文本 / 未闭合围栏都不报错', () => {
  assert.equal(extractBlocks('').length, 0);
  assert.equal(extractBlocks('只有叙述，没有代码块。').length, 0);
  assert.equal(extractBlocks('```\n未闭合').length, 0);
  assert.equal(extractBlocks('```\n```').length, 1);
});

// ---------- 2. 叙述零丢失 ----------

test('叙述零丢失：块外文本在提取范围之外，字节级不受影响', () => {
  const md = '前言部分\n\n```\n-8 早餐\n```\n\n后记部分';
  const [b] = extractBlocks(md);
  const prose = md.slice(0, b.start) + md.slice(b.end);
  assert.ok(prose.includes('前言部分'));
  assert.ok(prose.includes('后记部分'));
  assert.ok(!prose.includes('-8'));
});

// ---------- 3. 快照 diff：位置匹配 ----------

test('diff：已解析块不重复收集，新块才收集（幂等）', () => {
  const md = '```\n-8 早餐\n```\n\n```\n+100 工资\n```';
  const blocks = extractBlocks(md);
  const lastParse = makeParseRecord(blocks.slice(0, 1), { activities: [], txs: ['t1'] });
  const d = diffBlocks(blocks, lastParse);
  assert.equal(d.parsedCount, 1);
  assert.equal(d.fresh.length, 1);
  assert.ok(d.fresh[0].body.includes('工资'));
});

test('diff：同一 md 连续解析两次，第二次收集为空', () => {
  const blocks = extractBlocks('```\n-8 早餐\n```');
  const first = makeParseRecord(blocks, { activities: [], txs: ['t1'] });
  const d = diffBlocks(blocks, first);
  assert.equal(d.fresh.length, 0);
  assert.equal(d.rewritten.length, 0);
});

test('diff：位置相同内容已变 → 报改写，但不收集', () => {
  const lastParse = makeParseRecord(extractBlocks('```\n-8 早餐\n```'), { activities: [], txs: ['t1'] });
  const d = diffBlocks(extractBlocks('```\n-10 早餐\n```'), lastParse);
  assert.equal(d.fresh.length, 0);
  assert.equal(d.rewritten.length, 1);
  assert.equal(d.rewritten[0].index, 0);
});

test('diff：删除已解析块 → 不回滚也不报错', () => {
  const lastParse = makeParseRecord(extractBlocks('```\n-8 早餐\n```\n\n```\n+1 工资\n```'), { activities: [], txs: ['t1', 't2'] });
  const d = diffBlocks(extractBlocks('```\n-8 早餐\n```'), lastParse);
  assert.equal(d.parsedCount, 1);
  assert.equal(d.fresh.length, 0);
  assert.equal(d.rewritten.length, 0);
});

test('diff：无快照（首次解析）→ 全部为待注入', () => {
  const blocks = extractBlocks('```\n-8 早餐\n```');
  const d = diffBlocks(blocks, null);
  assert.equal(d.parsedCount, 0);
  assert.equal(d.fresh.length, 1);
});

test('fingerprint：空白尾差异不改变指纹', () => {
  assert.equal(fingerprint('-8 早餐\n'), fingerprint('-8 早餐'));
  assert.notEqual(fingerprint('-8 早餐'), fingerprint('-10 早餐'));
});

// ---------- 4. 命令切分 ----------

test('切分：块内 checkbox → 活动，[+-]数字 → 流水', () => {
  const db = mkDb();
  const { activities, txs, warnings } = splitCommands(db, '- [ ] 写周报\n-8 早餐 @灵感', { now: NOW, dateKey: DATE });
  assert.equal(warnings.length, 0);
  assert.equal(activities.length, 1);
  assert.equal(activities[0].title, '写周报');
  assert.equal(activities[0].status, 'Planned');
  assert.equal(txs.length, 1);
  assert.equal(txs[0].amount, 8);
  assert.equal(txs[0].resource_id, 'r2'); // @灵感
  assert.equal(txs[0].direction, 'credit');
});

test('切分：只有钟点的活动用日记日期补全排程', () => {
  const db = mkDb();
  const { activities } = splitCommands(db, '- [ ] 写周报 @ 9:00 60分钟', { now: NOW, dateKey: DATE });
  // engine.validPlannedStart 要求补零格式，否则活动会被拒绝创建
  assert.equal(activities[0].planned_start, '2026-09-27T09:00');
  assert.equal(activities[0].planned_minutes, 60);
});

test('切分：[x] 映射为 Completed；状态词映射 Started/Failed', () => {
  const db = mkDb();
  const a = splitCommands(db, '- [x] 已完成的事', { now: NOW, dateKey: DATE }).activities[0];
  assert.equal(a.status, 'Completed');
  const b = splitCommands(db, '- [ ] 进行中的事 (进行中)', { now: NOW, dateKey: DATE }).activities[0];
  assert.equal(b.status, 'Started');
  const c = splitCommands(db, '- [ ] 失败的事 (失败)', { now: NOW, dateKey: DATE }).activities[0];
  assert.equal(c.status, 'Failed');
});

test('切分：块内注释行跳过，无法识别的行进 warnings', () => {
  const db = mkDb();
  const { activities, txs, warnings } = splitCommands(db, '# 注释\n-8 早餐\n这不是命令', { now: NOW, dateKey: DATE });
  assert.equal(activities.length, 0);
  assert.equal(txs.length, 1);
  assert.equal(warnings.length, 1);
});

// ---------- 5. 注入（唯一副作用） ----------

test('注入：创建活动与流水，返回 id 列表', () => {
  const db = mkDb();
  const cmds = splitCommands(db, '- [ ] 写周报\n-8 早餐 @灵感', { now: NOW, dateKey: DATE });
  const r = injectJournal(db, engine, cmds);
  assert.equal(r.created.activities.length, 1);
  assert.equal(r.created.txs.length, 1);
  assert.equal(db.activities[0].title, '写周报');
  assert.equal(db.txs[0].credit, 8);
  assert.equal(db.txs[0].resource_id, 'r2');
});

test('注入：非 Planned 状态走状态机', () => {
  const db = mkDb();
  const cmds = splitCommands(db, '- [ ] 进行中的事 (进行中)', { now: NOW, dateKey: DATE });
  const r = injectJournal(db, engine, cmds);
  assert.equal(r.created.activities.length, 1);
  assert.equal(db.activities[0].status, 'Started');
});

test('注入：空命令集不产生任何写入', () => {
  const db = mkDb();
  const r = injectJournal(db, engine, { activities: [], txs: [] });
  assert.equal(db.activities.length, 0);
  assert.equal(db.txs.length, 0);
  assert.deepEqual(r.created, { activities: [], txs: [] });
});
test('切分：手写变体 -[] / - [] / -[x] 都能识别为活动', () => {
  const db = mkDb();
  const a1 = splitCommands(db, '-[] 无空格待办', { now: NOW, dateKey: DATE }).activities[0];
  assert.equal(a1.title, '无空格待办');
  assert.equal(a1.status, 'Planned');
  const a2 = splitCommands(db, '- [] 中间空格', { now: NOW, dateKey: DATE }).activities[0];
  assert.equal(a2.title, '中间空格');
  const a3 = splitCommands(db, '-[x] 无空格已完成', { now: NOW, dateKey: DATE }).activities[0];
  assert.equal(a3.status, 'Completed');
  // 普通列表项仍是活动
  const a4 = splitCommands(db, '- 纯列表项', { now: NOW, dateKey: DATE }).activities[0];
  assert.equal(a4.title, '纯列表项');
});

test('切分：无时间清单项落到日记当天（否则日历/当天账本不可见）', () => {
  const db = mkDb();
  const r1 = splitCommands(db, '- [ ] 写周报', { now: NOW, dateKey: '2026-10-16' });
  assert.equal(r1.activities.length, 1);
  assert.equal(r1.activities[0].title, '写周报');
  assert.equal(r1.activities[0].planned_start, null, '无时间 → 无 planned_start');
  assert.equal(r1.activities[0].planned_date, '2026-10-16', '日期锚到日记当天');

  // 不补零的日记键（与 mdviews 同格式）也要补零
  const r2 = splitCommands(db, '- 买菜', { now: NOW, dateKey: '2026-10-6' });
  assert.equal(r2.activities[0].planned_date, '2026-10-06');

  // 带起始时间的活动：planned_date 由 engine 从 planned_start 推导，此处应为 null
  const r3 = splitCommands(db, '- [ ] 写周报 @ 9:00', { now: NOW, dateKey: '2026-10-16' });
  assert.equal(r3.activities[0].planned_start, '2026-10-16T09:00');
  assert.equal(r3.activities[0].planned_date, null);

  // 无 dateKey（例如裸用例）时不硬塞日期
  const r4 = splitCommands(db, '- 买菜', { now: NOW });
  assert.equal(r4.activities[0].planned_date, null);
});
