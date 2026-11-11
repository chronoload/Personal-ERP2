// ============================================================
// domain/ledger.js
// 记账命令语言（Command DSL）· 纯函数层
//   一条命令 = 一笔流水：`-8 早餐` / `+100 工资` / `-5.5 咖啡 @灵感`
//   语法：<方向> <金额> [备注] [@资源名]
//         -  支出(credit)    +  收入(debit)
//         金额 = 数字(可小数)；备注 = 行内其余文本；@资源名 = 指定资源(缺省默认资源)
//   文本账单 = 手动流水(manual) 的 md 镜像（仿活动工作台）：
//     每行 `- 早餐 -8 @灵感 <!--id:t123-->`，id 绑定流水身份。
//   镜像语义遵循「不变量5：禁止 UPDATE/DELETE，更正=冲正」：
//     新增行 → 新流水；删行/改行 → reverseTx 冲正原单(+ 新流水)。
// 依赖 engine.adjustResource / engine.reverseTx / engine.balanceOf。
// 纯函数、零依赖、可 node 测试。
// ============================================================

// 默认资源：名为「价值元」的 Active 资源优先，否则第一个 Active
export function defaultResourceId(db) {
  const act = (db.resources || []).filter((r) => r.status === 'Active');
  return (act.find((r) => r.name === '价值元') || act[0] || {}).id || null;
}

// 按名称匹配 Active 资源：精确 > 前缀 > 包含（返回第一个命中；无则 null）
export function resolveResource(db, name) {
  if (!name) return defaultResourceId(db);
  const q = String(name).trim();
  if (!q) return defaultResourceId(db);
  const act = (db.resources || []).filter((r) => r.status === 'Active');
  return (act.find((r) => r.name === q)
    || act.find((r) => r.name && r.name.startsWith(q))
    || act.find((r) => r.name && r.name.includes(q)) || {}).id || null;
}

// 解析一行记账命令 → 操作
// @returns { ok, resource_id, direction:'debit'|'credit', amount:number, note:string } 或 { ok:false, error }
export function parseCommandLine(db, raw) {
  const line = String(raw ?? '').trim();
  if (!line) return { ok: false, error: '空命令' };
  if (line.startsWith('#') || line.startsWith('//')) return { ok: false, error: '注释行' };
  const m = line.match(/^([+-])(\d+(?:\.\d+)?)\s*(.*)$/);
  if (!m) return { ok: false, error: `无法解析命令：${line}` };
  const direction = m[1] === '-' ? 'credit' : 'debit';
  const amount = Number(m[2]);
  if (!(amount > 0)) return { ok: false, error: '金额必须 > 0' };
  // 提取 @资源名（行内任意位置，取第一个；可含中文/字母/数字/下划线）
  let rest = m[3].trim();
  const at = rest.match(/@([^\s@，,；;]+)/);
  let resource_id = null;
  if (at) { resource_id = resolveResource(db, at[1]); rest = rest.slice(0, at.index).trim(); }
  else resource_id = defaultResourceId(db);
  if (!resource_id) return { ok: false, error: `未找到可用资源（@${at ? at[1] : ''}）` };
  return { ok: true, resource_id, direction, amount, note: rest };
}

// 把一行拆成多个命令段：按 [+-]数字 边界切分（如 '-8 早餐 +10 工资' → 两条）。
// 备注中若含独立的 [+-]数字 会被误判为新命令 —— 记账备注应避免裸数字带符号。
function splitCommands(line) {
  const re = /[+-]\d+(?:\.\d+)?/g;
  const marks = [];
  let m;
  while ((m = re.exec(line))) marks.push({ start: m.index, head: m[0] });
  const segs = [];
  for (let i = 0; i < marks.length; i++) {
    const start = marks[i].start;
    const end = i + 1 < marks.length ? marks[i + 1].start : line.length;
    segs.push(line.slice(start, end).trim());
  }
  return segs;
}

// 批量命令：多行文本 → 操作列表（每行可含多条命令，按 [+-]数字 边界切分）
// @returns { ok, ops:[{resource_id,direction,amount,note}], errors:[{line,error}] }
export function parseLedgerCommand(db, text) {
  const ops = [], errors = [];
  const lines = String(text ?? '').split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith('//')) continue;
    for (const seg of splitCommands(line)) {
      const r = parseCommandLine(db, seg);
      if (r.ok) ops.push({ resource_id: r.resource_id, direction: r.direction, amount: r.amount, note: r.note });
      else errors.push({ line: seg, error: r.error });
    }
  }
  return { ok: ops.length > 0, ops, errors };
}

// 执行操作：逐笔经 engine.adjustResource 入账（失败入 errors）
// @returns { done, errors:[{note,error}] }
export function applyOps(db, engine, ops) {
  let done = 0; const errors = [];
  for (const op of ops) {
    const r = engine.adjustResource(db, op.resource_id, {
      direction: op.direction, amount: op.amount, note: op.note || (op.direction === 'debit' ? '记账收入' : '记账支出'),
    });
    if (r.ok) done++;
    else errors.push({ note: op.note, error: r.error });
  }
  return { done, errors };
}

// ---------------- 文本账单镜像 ----------------

// md 行内 id 标记：`<!--id:t123-->` 或 lute 链接式 `[!--id:t123--](!--id:t123--)` 或裸残余 `!--id:t123--`
const ID_RE = /(?:<!--id:([\w-]+)-->|\[!--id:([\w-]+)--\]\(!--id:\2--\)|!--id:([\w-]+)--)/;
function lineId(l) { const m = l.match(ID_RE); return (m && (m[1] || m[2] || m[3])) || null; }
export function stripIdMarker(l) { return String(l).replace(ID_RE, '').trim(); }

// 单流水 → 账单行：`- -8 早餐 @资源名 <!--id:t123-->`（金额在前，与命令语法同构）
function txToLine(db, t) {
  const r = (db.resources || []).find((x) => x.id === t.resource_id);
  const dir = (t.debit > 0 ? '+' : '-') + fmtAmt(t.debit > 0 ? t.debit : t.credit);
  const at = r ? ` @${r.name}` : '';
  const note = t.note || '';
  return `- ${dir} ${note}${at} <!--id:${t.id}-->`;
}
function fmtAmt(n) { return Number(n) === Math.floor(n) ? String(Number(n)) : String(Number(n)); }

// db → 文本账单 md（镜像全部 manual 流水，按时间倒序；reversal 流水也列示但标注冲正）
// @returns { md, count }
export function serializeLedger(db) {
  const txs = (db.txs || [])
    .filter((t) => t.source_type === 'manual' || t.source_type === 'reversal')
    .slice()
    .sort((a, b) => (b.created || 0) - (a.created || 0));
  const lines = [];
  lines.push('# 📒 文本账单 · 手动流水');
  lines.push('');
  lines.push('> 一行一笔：`- 备注 -8 @资源名`。删行/改行 = 冲正原单；`+` 收入、`-` 支出。');
  lines.push('');
  for (const t of txs) {
    if (t.source_type === 'reversal') {
      const orig = (db.txs || []).find((x) => x.id === t.source_id);
      lines.push(`- ⤺ 冲正 ${orig ? (orig.note || orig.id) : t.source_id} ${t.debit > 0 ? '+' : '-'}${fmtAmt(t.debit > 0 ? t.debit : t.credit)} <!--id:${t.id}-->`);
    } else {
      lines.push(txToLine(db, t));
    }
  }
  return { md: lines.join('\n') + '\n', count: txs.length };
}

// md → 行候选（只取普通流水行；冲正行与标题行忽略）
// 解析只提取资源「名」（不解析 id，保持纯文本函数）；apply 阶段再按名匹配资源。
// @returns { rows:[{id,resource_name,direction,amount,note}], warnings }
export function parseLedger(md) {
  const rows = []; const warnings = [];
  for (const raw of String(md ?? '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith('>')) continue;
    if (!/^[-*]\s/.test(line)) continue; // 只认列表项
    const id = lineId(line);
    const body = stripIdMarker(line).replace(/^[-*]\s+/, '');
    if (body.startsWith('⤺')) { warnings.push('冲正行不参与镜像（由删/改自动生成）'); continue; }
    // 再按命令语法解析正文（此时无 @ 也会命中默认资源；但镜像要按行内 @ 显式绑定资源）
    const m = body.match(/^([+-])(\d+(?:\.\d+)?)\s*(.*)$/);
    if (!m) { warnings.push(`忽略无法解析的行：${body}`); continue; }
    const direction = m[1] === '-' ? 'credit' : 'debit';
    const amount = Number(m[2]);
    let rest = m[3].trim();
    let resource_name = null;
    const at = rest.match(/@([^\s@，,；;]+)/);
    if (at) { resource_name = at[1]; rest = rest.slice(0, at.index).trim(); }
    rows.push({ id: id || null, resource_name, direction, amount, note: rest });
  }
  return { rows, warnings };
}

// 镜像应用：新增行 → 新流水；带 id 行 → 与 db 对账：
//   缺失(原单在 db 但账单无) → 冲正；内容差异(金额/方向/资源/备注变) → 冲正原单 + 新流水；一致 → 跳过
// @returns { created, reversed, warnings }
export function applyLedger(db, engine, rows, { keepIds = new Set() } = {}) {
  const stat = { created: 0, reversed: 0, warnings: [] };
  const touched = new Set();
  const resolveRowResource = (row) => {
    if (row.resource_name) { const id = resolveResource(db, row.resource_name); if (id) return id; }
    return defaultResourceId(db);
  };
  for (const row of rows) {
    if (row.id) touched.add(row.id);
    if (!row.id) {
      // 新行 → 新建流水（资源按行内 @ 名解析，缺省默认资源）
      const rid = resolveRowResource(row);
      if (!rid) { stat.warnings.push(`新行「${row.note}」无可用资源，跳过`); continue; }
      const r = engine.adjustResource(db, rid, {
        direction: row.direction, amount: row.amount, note: row.note || (row.direction === 'debit' ? '记账收入' : '记账支出'),
      });
      if (r.ok) {
        stat.created++;
        // 新流水 id 记入 touched：防本轮「缺失即冲正」误删刚建的新流水
        touched.add(db.txs[db.txs.length - 1].id);
      } else stat.warnings.push(`新建「${row.note}」：${r.error}`);
      continue;
    }
    const orig = (db.txs || []).find((x) => x.id === row.id);
    if (!orig) { stat.warnings.push(`流水 ${row.id} 不存在，跳过`); continue; }
    // 校验资源（仅当行内显式 @ 指定）
    const rid = row.resource_name ? (resolveResource(db, row.resource_name) || orig.resource_id) : orig.resource_id;
    const amountSame = Math.abs((orig.debit || orig.credit) - row.amount) < 1e-9;
    const dirSame = (orig.debit > 0) === (row.direction === 'debit');
    const noteSame = (orig.note || '') === (row.note || '');
    if (rid === orig.resource_id && amountSame && dirSame && noteSame) continue; // 一致
    // 差异 → 冲正原单 + 新流水
    const amt = orig.debit || orig.credit;
    const rev = engine.reverseTx(db, orig.id, { amount: amt, reason: '账单更正' });
    if (!rev.ok) { stat.warnings.push(`冲正 ${orig.note || orig.id} 失败：${rev.error}`); continue; }
    stat.reversed++;
    const nr = engine.adjustResource(db, rid, {
      direction: row.direction, amount: row.amount, note: row.note || (row.direction === 'debit' ? '记账收入' : '记账支出'),
    });
    if (nr.ok) { stat.created++; touched.add(db.txs[db.txs.length - 1].id); }
    else stat.warnings.push(`更正后新建「${row.note}」：${nr.error}`);
  }
  // 缺失即冲正：db 中 manual 流水未被账单触及且未被调用方 keepIds 保护 → 全额冲正
  for (const t of (db.txs || [])) {
    if (t.source_type !== 'manual' || touched.has(t.id) || keepIds.has(t.id)) continue;
    if (t.reversal_of) continue;
    const rev = engine.reverseTx(db, t.id, { amount: t.debit || t.credit, reason: '账单删除' });
    if (rev.ok) stat.reversed++;
    else stat.warnings.push(`删除「${t.note || t.id}」冲正失败：${rev.error}`);
  }
  return stat;
}
