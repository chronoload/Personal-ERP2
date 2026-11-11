// ============================================================
// domain/journal.js
// 日记页纯函数层：代码块提取 / 快照 diff / 命令切分 / 注入
//
// 设计依据 SPEC_diary.md v2：
//   · 命令段位于 Markdown 代码块（含无语言标记）；叙述段永不参与解析
//   · 幂等靠外部快照（parses[].blockCount + fingerprints），文本零标记
//   · 一次性单向注入：已解析块不再注入，删除不回滚
//
// 关于「位置匹配」：diffBlocks 以块序号为准。序号已在 lastParse.blockCount
// 内的块一律跳过（无论内容是否被改写）——因为纯 diff 无法区分「新写的行」与
// 「改写过的行」（git 会把改写呈现为「删一行 + 加一行」）。要追加就新开一块。
// ============================================================
import { parseActLine } from './mdimport.js';
import { parseCommandLine } from './ledger.js';

// 内容指纹（djb2）：仅用于「位置相同但内容已变」的改写检测
export function fingerprint(s) {
  const t = String(s ?? '').replace(/\s+$/, '');
  let h = 5381;
  for (let i = 0; i < t.length; i++) h = (((h << 5) + h) + t.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

// Markdown 围栏：行首三反引号（允许缩进）→ 行首三反引号闭合
// 语言标记可有可无（```erp 与 ``` 均可）
const FENCE_RE = /^[ \t]*```[^\n]*\n([\s\S]*?)^[ \t]*```[ \t]*$/gm;

/**
 * 提取全部代码块。
 * 只有代码块才是命令来源；正文列表、行内代码、裸数字一律是叙述。
 * @returns {Array<{index:number, body:string, fingerprint:string, start:number, end:number}>}
 */
export function extractBlocks(md) {
  const text = String(md ?? '');
  const spans = [];

  // 形态一：Markdown 围栏。闭合行放宽（允许行尾附带内容——Vditor 有时会附加标记）
  const FENCE = /^[ \t]*```[^\n]*\n([\s\S]*?)^[ \t]*```[^\n]*$/gm;
  let m;
  while ((m = FENCE.exec(text))) {
    spans.push({ start: m.index, end: m.index + m[0].length, body: m[1] });
  }

  // 形态二：HTML <pre><code>…</code></pre>（Vditor wysiwyg 在部分路径下输出此形态）
  const PRE = /<pre[^>]*>[\s\S]*?<code[^>]*>([\s\S]*?)<\/code>[\s\S]*?<\/pre>/gi;
  while ((m = PRE.exec(text))) {
    const body = m[1]
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
      .replace(/&amp;/g, '&');
    spans.push({ start: m.index, end: m.index + m[0].length, body });
  }

  // 按位置排序 + 去重（重叠只保留先出现的那个）
  spans.sort((a, b) => a.start - b.start);
  const blocks = [];
  let lastEnd = -1;
  for (const s of spans) {
    if (s.start < lastEnd) continue;
    lastEnd = s.end;
    blocks.push({
      index: blocks.length,
      body: s.body,
      fingerprint: fingerprint(s.body),
      start: s.start,
      end: s.end,
    });
  }
  return blocks;
}

/**
 * 快照 diff：按块序号位置匹配，裁决哪些块已解析、哪些是新块、哪些被改写过。
 * @param {Array} blocks extractBlocks 的结果
 * @param {{blockCount:number, fingerprints:string[]}|null} lastParse 上次解析记录
 * @returns {{parsedCount:number, parsed:Array, fresh:Array, rewritten:Array}}
 */
export function diffBlocks(blocks, lastParse) {
  const list = Array.isArray(blocks) ? blocks : [];
  const parsedCount = Math.max(0, Math.min(Number(lastParse && lastParse.blockCount) || 0, list.length));
  const prev = (lastParse && lastParse.fingerprints) || [];
  const parsed = list.slice(0, parsedCount);
  const fresh = list.slice(parsedCount);
  const rewritten = [];
  for (let i = 0; i < parsedCount; i++) {
    if (prev[i] && prev[i] !== list[i].fingerprint) {
      rewritten.push({ index: i, block: list[i] });
    }
  }
  return { parsedCount, parsed, fresh, rewritten };
}

/**
 * 块内切分：`- [ ] xxx` → 活动；`[+-]数字 ...` → 流水；其余行忽略并记 warning。
 * 语法与编辑器工作台（mdimport / ledger）保持一致，用户只需记一套规则。
 * @param {object} db 资源池（流水行解析资源名用）
 * @param {string} body 代码块正文
 * @param {{now?:number, dateKey?:string}} opts dateKey：日记日期，用于补全 `@ 9:00` 这类只有钟点的活动
 * @returns {{activities:Array, txs:Array, warnings:string[]}}
 */
export function splitCommands(db, body, { now = Date.now(), dateKey = null } = {}) {
  const activities = [], txs = [], warnings = [];
  for (const raw of String(body ?? '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('#') || line.startsWith('//')) continue; // 块内注释

    // 流水行：必须以 [+-]数字 开头（避免误伤 `- 买菜` 这类活动行）
    if (/^[+-]\d/.test(line)) {
      const r = parseCommandLine(db, line);
      if (r.ok) {
        txs.push({ resource_id: r.resource_id, direction: r.direction, amount: r.amount, note: r.note });
      } else {
        warnings.push(`流水行无法解析：${line}（${r.error}）`);
      }
      continue;
    }

    // 活动行：列表项。宽容匹配手写变体——『- [ ]』『-[]』『- []』『- [x]』都认（
    // 漏了无空格形态会让用户手写的 checkbox 整行落进「无法识别」而被丢掉）
    const cb = line.match(/^[-*]\s*\[([ xX]?)\]\s*(.*)$/);
    const li = cb ? null : line.match(/^[-*]\s+(.*)$/);
    if (cb || li) {
      const checked = cb ? (cb[1] === 'x' || cb[1] === 'X') : false;
      const text = cb ? cb[2] : li[1];
      const parsed = parseActLine(text || '', { defaultPlan: null, defaultMinutes: null, now });
      if (!parsed.title) { warnings.push('活动行标题为空，已忽略'); continue; }
      let status = checked ? 'Completed' : 'Planned';
      if (parsed.statusMark === '失败') status = 'Failed';
      else if (parsed.statusMark === '归档') status = 'Archived';
      else if (parsed.statusMark === '进行中') status = 'Started';
      // 只有钟点（`@ 9:00`）的活动：用日记日期补全为完整排程
      let planned_start = parsed.planned_start || null;
      const pk = padDateKey(dateKey);
      if (!planned_start && pk && parsed.clock) planned_start = `${pk}T${parsed.clock}`;
      // 无任何时间的清单项：日期落到日记当天，而不是留 null。
      // 日记是按天写的，写进某天日记的清单项天然属于那一天；留 null 会让它
      // 在日历 / 当天账本里彻底不可见（planned_date 为空 → 不参与任何按日分组），
      // 用户就会误以为「必须写时间点才能解析」。
      const planned_date = planned_start ? null : (pk || null);
      activities.push({
        title: parsed.title,
        note: parsed.note || '',
        planned_start,
        planned_date,
        planned_minutes: parsed.minutes || 0,
        status,
      });
      continue;
    }

    warnings.push(`忽略无法识别的行：${line}`);
  }
  return { activities, txs, warnings };
}

/**
 * 执行注入（唯一有副作用的一步）：活动经 createActivity、流水经 adjustResource。
 * 状态非 Planned 的活动走状态机；非法流转降级为 Planned 并记 warning（不中断注入）。
 * @returns {{created:{activities:string[], txs:string[]}, warnings:string[]}}
 */
export function injectJournal(db, engine, { activities = [], txs = [] } = {}) {
  const created = { activities: [], txs: [] };
  const warnings = [];

  for (const a of activities) {
    const r = engine.createActivity(db, {
      title: a.title,
      note: a.note || '',
      plan_ids: [],
      planned_start: a.planned_start || null,
      planned_date: a.planned_date || null,
      planned_minutes: a.planned_minutes || 0,
    });
    if (!r.ok) { warnings.push(`活动「${a.title}」创建失败：${r.error}`); continue; }
    const id = db.activities[db.activities.length - 1].id;
    created.activities.push(id);
    if (a.status && a.status !== 'Planned') {
      const sr = engine.setActivityStatus(db, id, a.status);
      if (!sr.ok) warnings.push(`「${a.title}」状态未设为 ${a.status}（${sr.error}），保持 Planned`);
    }
  }

  for (const t of txs) {
    const r = engine.adjustResource(db, t.resource_id, {
      direction: t.direction,
      amount: t.amount,
      note: t.note || (t.direction === 'debit' ? '日记记账收入' : '日记记账支出'),
    });
    if (!r.ok) { warnings.push(`流水「${t.note || ''}」入账失败：${r.error}`); continue; }
    created.txs.push(db.txs[db.txs.length - 1].id);
  }

  return { created, warnings };
}

/**
 * 构造一条新的解析记录（追加到 journals[].parses）。
 * @returns {{at:number, blockCount:number, fingerprints:string[], injected:object}}
 */
export function makeParseRecord(blocks, injected, at = Date.now()) {
  return {
    at,
    blockCount: Array.isArray(blocks) ? blocks.length : 0,
    fingerprints: (blocks || []).map((b) => b.fingerprint),
    injected: injected || { activities: [], txs: [] },
  };
}

// 日期补零：engine.validPlannedStart 要求 YYYY-MM-DDTHH:MM（日记键本身不补零）
export function padDateKey(k) {
  const [y, m, d] = String(k || '').split('T')[0].split('-').map(Number);
  if (!y || !m || !d) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

// ---- 日期工具（与 mdviews 同格式 YYYY-M-D）----
export function dayKeyOf(d) { return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; }
export function todayJournalKey(now = Date.now()) { return dayKeyOf(new Date(now)); }
export function parseJournalKey(k) { const [y, m, d] = String(k).split('-').map(Number); return new Date(y, m - 1, d); }
export function shiftJournalKey(k, n) {
  const d = parseJournalKey(k);
  return dayKeyOf(new Date(d.getTime() + n * 86400000));
}