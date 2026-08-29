// ============================================================
// domain/report.js
// 周报 / 月报：纯函数生成器（无 DOM、无系统时钟——时间由 now 注入）
// 报告内容（模块可配置）：
//   activity 活动汇总（完成/开始/新增/每日完成分布）
//   ledger   收支流水汇总（各资源净变动 + 支出/收入总额）
//   plan     计划本期投入（活动来源 credit − 冲正，仅计本期）
//   balance  资源余额期初 → 期末净变化
//   vf       价值流（本期新增 / 待反馈 / 已闭环）
// ============================================================

// 周期边界：返回 { start, end, label }，[start, end) 毫秒
// week = 周一 00:00 起 7 天；month = 当月 1 日 00:00 起整月；offset=0 当前期，负数为往前
export function periodRange(period, offset = 0, now = new Date()) {
  const d = new Date(now);
  if (period === 'week') {
    const dow = (d.getDay() + 6) % 7; // 0=周一
    d.setDate(d.getDate() - dow + offset * 7); // 负 offset = 往前
    d.setHours(0, 0, 0, 0);
    const start = d.getTime();
    const end = start + 7 * 864e5;
    return { start, end, label: `${fmtMD(start)} ~ ${fmtMD(end - 1)}` };
  }
  d.setDate(1);
  d.setMonth(d.getMonth() + offset); // 负 offset = 往前
  d.setHours(0, 0, 0, 0);
  const start = d.getTime();
  const end = new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime();
  return { start, end, label: `${d.getFullYear()}年${d.getMonth() + 1}月` };
}

function fmtMD(ms) {
  const d = new Date(ms);
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}
function dayKeyOf(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

// 某时刻之前的资源余额（含 initial 与 created < ts 的全部流水）
function balanceAt(db, rid, ts) {
  const r = db.resources.find((x) => x.id === rid);
  if (!r) return 0;
  let d = 0, c = 0;
  for (const t of db.txs) {
    if (t.resource_id !== rid || t.created >= ts) continue;
    d += t.debit || 0; c += t.credit || 0;
  }
  return r.initial + d - c;
}

export const REPORT_MODULES = ['activity', 'ledger', 'plan', 'balance', 'vf'];
export const REPORT_MODULE_LABEL = {
  activity: '活动汇总',
  ledger: '收支流水',
  plan: '计划投入',
  balance: '余额变化',
  vf: '价值流',
};

export function buildReport(db, { period = 'week', offset = 0, now = Date.now() } = {}) {
  const { start, end, label } = periodRange(period, offset, new Date(now));
  const inRange = (ts) => Number.isFinite(ts) && ts >= start && ts < end;
  const acts = db.activities || [];

  // ---- 活动 ----
  const completed = acts.filter((a) => a.status === 'Completed' && inRange(a.actual_end)).length;
  const started = acts.filter((a) => inRange(a.actual_start)).length;
  const created = acts.filter((a) => inRange(a.created)).length;
  const failed = acts.filter((a) => a.status === 'Failed' && inRange(a.actual_end)).length;
  const daily = {};
  for (const a of acts) {
    if (a.actual_end && inRange(a.actual_end)) {
      const k = dayKeyOf(a.actual_end);
      daily[k] = (daily[k] || 0) + 1;
    }
  }

  // ---- 收支流水（本期 created）----
  const txs = (db.txs || []).filter((t) => inRange(t.created));
  const resNet = {};
  for (const r of db.resources || []) resNet[r.id] = { id: r.id, name: r.name, unit: r.unit, debit: 0, credit: 0, n: 0 };
  let incomeTotal = 0, expenseTotal = 0, revCount = 0;
  for (const t of txs) {
    const e = resNet[t.resource_id];
    if (e) { e.debit += t.debit || 0; e.credit += t.credit || 0; e.n++; }
    if ((t.debit || 0) > 0) incomeTotal += t.debit;
    if ((t.credit || 0) > 0) expenseTotal += t.credit;
    if (t.source_type === 'reversal') revCount++;
  }
  const ledgerRows = Object.values(resNet)
    .filter((e) => e.n > 0)
    .map((e) => ({ ...e, net: e.debit - e.credit }))
    .sort((a, b) => Math.abs(b.net) - Math.abs(a.net));

  // ---- 计划本期投入 ----
  const planRows = (db.plans || []).map((p) => {
    const actIds = new Set(acts.filter((a) => a.plan_ids.includes(p.id)).map((a) => a.id));
    let spend = 0;
    for (const t of txs) {
      if (t.source_type === 'activity' && actIds.has(t.source_id)) spend += t.credit || 0;
      else if (t.source_type === 'reversal' && actIds.has(t.source_id)) spend -= t.debit || 0;
    }
    return { id: p.id, title: p.title, spend: Math.max(0, spend), budget: p.budget };
  }).filter((r) => r.spend > 0).sort((a, b) => b.spend - a.spend);

  // ---- 余额期初 → 期末 ----
  const balRows = (db.resources || []).map((r) => {
    const before = balanceAt(db, r.id, start);
    const after = balanceAt(db, r.id, end);
    return { id: r.id, name: r.name, unit: r.unit, before, after, net: after - before };
  }).filter((r) => r.net !== 0 || r.before !== 0);

  // ---- 价值流 ----
  const vf = db.valueflows || [];
  const vfRows = {
    created: vf.filter((v) => inRange(v.created)).length,
    pending: vf.filter((v) => v.status !== 'Closed').length,
    closed: vf.filter((v) => v.status === 'Closed').length,
  };

  return {
    period, offset, start, end, label,
    activity: { completed, started, failed, created, daily },
    ledger: { rows: ledgerRows, incomeTotal, expenseTotal, revCount, n: txs.length },
    plan: planRows,
    balance: balRows,
    vf: vfRows,
  };
}
