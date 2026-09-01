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

// ---------- v2 辅助（活动级明细 / 时间偏差 / 价值产出 / 排程健康 / 预算趋势）----------

// 活动实际投入分钟：优先 time_logs（start&end 齐全求和），否则回退 actual_end-actual_start
function actualMinutesOf(a) {
  const logs = Array.isArray(a?.time_logs) ? a.time_logs : [];
  let acc = 0, hasLog = false;
  for (const lg of logs) {
    if (Number.isFinite(lg?.start) && Number.isFinite(lg?.end) && lg.end > lg.start) {
      acc += (lg.end - lg.start) / 60000; hasLog = true;
    }
  }
  if (hasLog) return Math.round(acc);
  if (Number.isFinite(a?.actual_start) && Number.isFinite(a?.actual_end) && a.actual_end > a.actual_start) {
    return Math.round((a.actual_end - a.actual_start) / 60000);
  }
  return 0;
}

// 活动归因的目标 ids：plan_ids → plan.goal_id（去重、滤 null）
function goalIdsOf(a, plans) {
  const gs = new Set();
  for (const pid of a?.plan_ids || []) {
    const p = plans.find((x) => x.id === pid);
    if (p?.goal_id) gs.add(p.goal_id);
  }
  return [...gs];
}

// 活动挂账（净额）：source_type='activity' 的原始流水减去其冲正效应
// 返回 { debit(净得), credit(净耗), n(原始归因条数), revCount }
function ledgerAttachOf(db, a) {
  let debit = 0, credit = 0, n = 0;
  const origIds = new Set();
  for (const t of db.txs) {
    if (t.source_type === 'activity' && t.source_id === a.id) {
      debit += t.debit || 0; credit += t.credit || 0; n++;
      origIds.add(t.id);
    }
  }
  // 冲正：source_id 指向某原始流水 → 抵消该原始的方向
  for (const t of db.txs) {
    if (t.source_type === 'reversal' && origIds.has(t.source_id)) {
      // 找到被冲正的原始流水方向
      const orig = db.txs.find((x) => x.id === t.source_id);
      if (orig && (orig.debit || 0) > 0) debit -= t.debit || 0;
      else if (orig && (orig.credit || 0) > 0) credit -= t.credit || 0;
    }
  }
  return { debit, credit, n };
}

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

  // ================= v2 新统计量 =================
  const plans = db.plans || [];
  const goals = db.goals || [];
  const outputs = db.outputs || [];
  const vfAll = db.valueflows || [];

  // 本期「有信号」活动：本期完成/开始/创建/失败（actual_end、actual_start、created 任一在期）
  const periodActs = acts.filter((a) =>
    inRange(a.actual_end) || inRange(a.actual_start) || inRange(a.created));

  // ---- #1 活动级明细 ----
  const actDetail = periodActs.map((a) => {
    const actual_minutes = actualMinutesOf(a);
    const planIds = a.plan_ids || [];
    const biasRatio = (a.planned_minutes > 0 && actual_minutes > 0)
      ? Math.round((actual_minutes / a.planned_minutes) * 100) / 100 : null;
    const outIds = outputs.filter((o) => o.activity_id === a.id).map((o) => o.id);
    const la = ledgerAttachOf(db, a);
    return {
      id: a.id, title: a.title, plan_ids: planIds,
      status: a.status, planned_minutes: a.planned_minutes || 0,
      actual_minutes, biasRatio,
      goal_ids: goalIdsOf(a, plans), goal_count: goalIdsOf(a, plans).length,
      ledgerAttach: la,
      outputCount: outIds.length,
      vfYield: vfAll.filter((v) => outIds.includes(v.output_id)).length,
      failed: a.status === 'Failed', retryCount: a.retryCount || 0,
      conflictCount: Array.isArray(a.conflicts) ? a.conflicts.length : 0,
    };
  });

  // ---- #2 时间估计偏差（按计划聚合 + 全局）----
  const biasByPlan = new Map(); // plan_id -> {plan_id, actsWithActual, totalPlannedMin, totalActualMin}
  let ovActs = 0, ovPlan = 0, ovActual = 0;
  for (const ad of actDetail) {
    if (!(ad.planned_minutes > 0 && ad.actual_minutes > 0)) continue;
    for (const pid of ad.plan_ids) {
      if (!biasByPlan.has(pid)) biasByPlan.set(pid, { plan_id: pid, title: '', actsWithActual: 0, totalPlannedMin: 0, totalActualMin: 0 });
      const e = biasByPlan.get(pid);
      e.actsWithActual++; e.totalPlannedMin += ad.planned_minutes; e.totalActualMin += ad.actual_minutes;
    }
    ovActs++; ovPlan += ad.planned_minutes; ovActual += ad.actual_minutes;
  }
  const ratioOf = (p, aY) => (p > 0 && aY > 0) ? Math.round((aY / p) * 100) / 100 : null;
  const byPlan = [...biasByPlan.values()].map((e) => {
    const p = plans.find((x) => x.id === e.plan_id);
    return { ...e, title: p?.title || '', ratio: ratioOf(e.totalPlannedMin, e.totalActualMin) };
  }).sort((a, b) => (b.ratio ?? 0) - (a.ratio ?? 0));
  const timeBias = { byPlan, overall: { actsWithActual: ovActs, totalPlannedMin: ovPlan, totalActualMin: ovActual, ratio: ratioOf(ovPlan, ovActual) } };

  // ---- #3 价值产出（按目标 + 计划聚合）----
  const yieldByGoal = new Map();
  const yieldByPlan = new Map();
  for (const ad of actDetail) {
    if (ad.status !== 'Completed' && ad.status !== 'Failed') continue; // 只计已结束的投入
    const fetch = (m, k) => { if (!m.has(k)) m.set(k, { outputCount: 0, vfCount: 0, actsEnded: 0, spentMinutes: 0, goal_id: null }); return m.get(k); };
    for (const gid of ad.goal_ids) {
      const e = fetch(yieldByGoal, gid); e.goal_id = gid;
      e.outputCount += ad.outputCount; e.vfCount += ad.vfYield;
      e.actsEnded++; e.spentMinutes += ad.actual_minutes;
    }
    for (const pid of ad.plan_ids) {
      const e = fetch(yieldByPlan, pid); e.plan_id = pid;
      e.outputCount += ad.outputCount; e.vfCount += ad.vfYield;
      e.actsEnded++; e.spentMinutes += ad.actual_minutes;
    }
  }
  const enrichYield = (m) => [...m.values()].map((e) => ({
    ...e,
    // 价值产出密度：价值流数 / 投入分钟（×1000 便于阅读），无投入则 0
    yieldDensity: e.spentMinutes > 0 ? Math.round((e.vfCount / e.spentMinutes) * 1000) / 1000 : 0,
  }));
  const valueYield = { byGoal: enrichYield(yieldByGoal), byPlan: enrichYield(yieldByPlan) };

  // ---- #4 排程健康 ----
  let actsWithConflict = 0, totalConflicts = 0, timedActs = 0, flexibleActs = 0, adheredActs = 0;
  for (const a of periodActs) { // 用原始活动对象（含 planned_start/conflicts 等字段）
    const hasPlannedStart = !!(a.planned_start);
    const isFlex = !hasPlannedStart || !(a.planned_minutes > 0);
    if (isFlex) flexibleActs++; else timedActs++;
    const c = Array.isArray(a.conflicts) ? a.conflicts.length : 0;
    if (c > 0) { actsWithConflict++; totalConflicts += c; }
    // 守约：有计划开始且实际开始，且实际不晚于计划 5 分钟之外
    if (hasPlannedStart && Number.isFinite(a.actual_start)) {
      const planMin = new Date(a.planned_start).getTime();
      if (a.actual_start <= planMin + 5 * 60000) adheredActs++;
    }
  }
  const schedHealth = { actsWithConflict, totalConflicts, timedActs, flexibleActs, adheredActs };

  // ---- #5 预算资源趋势 + 计划预算超支 ----
  const resourceTrend = (db.resources || []).map((r) => {
    let debit = 0, credit = 0;
    for (const t of db.txs) {
      if (t.resource_id !== r.id || !inRange(t.created)) continue;
      debit += t.debit || 0; credit += t.credit || 0;
    }
    const denom = debit + credit;
    return {
      id: r.id, name: r.name, unit: r.unit,
      before: balanceAt(db, r.id, start), after: balanceAt(db, r.id, end),
      net: debit - credit, debit, credit,
      rechargeRatio: denom > 0 ? Math.round((debit / denom) * 100) / 100 : null,
    };
  }).filter((x) => x.debit > 0 || x.credit > 0 || x.before !== 0);
  const planBudget = (db.plans || []).map((p) => {
    const adIds = new Set(actDetail.filter((a) => (a.plan_ids || []).includes(p.id)).map((a) => a.id));
    let spend = 0;
    for (const t of db.txs) {
      if (t.source_type === 'activity' && adIds.has(t.source_id)) spend += t.credit || 0;
    }
    return { plan_id: p.id, title: p.title, budget: p.budget ?? null, spend, remaining: (p.budget ?? null) == null ? null : p.budget - spend, overspend: (p.budget ?? null) != null && spend > p.budget };
  }).filter((x) => x.spend > 0 || x.budget != null);
  const budgetTrend = { resources: resourceTrend, plans: planBudget, overspend: planBudget.filter((x) => x.overspend) };

  // ---- meta：L2/L4 特征种子（去身份契约）----
  const planCompletion = {};
  for (const p of db.plans || []) {
    const pActs = actDetail.filter((a) => (a.plan_ids || []).includes(p.id));
    if (!pActs.length) continue;
    const done = pActs.filter((a) => a.status === 'Completed').length;
    const failed = pActs.filter((a) => a.status === 'Failed').length;
    planCompletion[p.id] = {
      done, failed, total: pActs.length,
      rate: pActs.length ? Math.round((done / pActs.length) * 100) / 100 : 0,
    };
  }
  const meta = {
    planCompletion,
    // 归一化、去身份的时间偏差向量（供 L3 排程学习；只含数字，不含计划名/身份）
    timeBiasVector: byPlan.map((e) => [e.totalPlannedMin, e.totalActualMin, e.ratio ?? 0]),
    // L4 轨迹签名占位：本期每周目标序列（匿名）——先空数组，待 L4 接缝落地填充
    trajectorySignatures: valueYield.byGoal.map((g) => ({ gid: g.goal_id, actsEnded: g.actsEnded, vf: g.vfCount, yieldDensity: g.yieldDensity })),
  };

  return {
    period, offset, start, end, label,
    activity: { completed, started, failed, created, daily },
    ledger: { rows: ledgerRows, incomeTotal, expenseTotal, revCount, n: txs.length },
    plan: planRows,
    balance: balRows,
    vf: vfRows,
    actDetail, timeBias, valueYield, schedHealth, budgetTrend, meta,
  };
}

// ============================================================
// stripIdentity(r[, opts]) —— 去身份转换（L1 核心契约）
// 默认：把 buildReport 输出转成「纯数字可序列化」导出面——
//   剥离全部 *_id / id / title / name / 余额绝对值(before/after) / meta 原始计划键，
//   只保留 计数 / 比值 / 时长 / 资源净变化(net) / 单位(unit，非身份)。
// 这是任何 导出 / API / MCP / 社区共享 表面的必经转换，防内部原始 id 泄漏（对抗评审 #1）。
// opts.keepIdentity = true 时原样返回（本地在设备上使用，不走去身份）。
// ============================================================
const pick = (o, keys) => {
  const out = {};
  for (const k of keys) if (k in o) out[k] = o[k];
  return out;
};

export function stripIdentity(r, { keepIdentity = false } = {}) {
  if (!r) return r;
  if (keepIdentity) return r;

  const ledger = {
    ...pick(r.ledger, ['incomeTotal', 'expenseTotal', 'revCount', 'n']),
    rows: (r.ledger?.rows || []).map((e) => pick(e, ['unit', 'debit', 'credit', 'net', 'n'])),
  };
  const plan = (r.plan || []).map((e) => pick(e, ['spend', 'budget']));
  const balance = (r.balance || []).map((e) => pick(e, ['unit', 'net']));

  const actDetail = (r.actDetail || []).map((a) =>
    pick(a, ['status', 'planned_minutes', 'actual_minutes', 'biasRatio', 'goal_count', 'ledgerAttach', 'outputCount', 'vfYield', 'failed', 'retryCount', 'conflictCount']));

  const timeBias = {
    byPlan: (r.timeBias?.byPlan || []).map((e) => pick(e, ['actsWithActual', 'totalPlannedMin', 'totalActualMin', 'ratio'])),
    overall: r.timeBias?.overall ? pick(r.timeBias.overall, ['actsWithActual', 'totalPlannedMin', 'totalActualMin', 'ratio']) : undefined,
  };

  const ydShape = (e) => pick(e, ['actsEnded', 'spentMinutes', 'vfCount', 'outputCount', 'yieldDensity']);
  const valueYield = {
    byGoal: (r.valueYield?.byGoal || []).map(ydShape),
    byPlan: (r.valueYield?.byPlan || []).map(ydShape),
  };

  const budgetTrend = {
    resources: (r.budgetTrend?.resources || []).map((e) => pick(e, ['unit', 'net', 'debit', 'credit', 'rechargeRatio'])),
    plans: (r.budgetTrend?.plans || []).map((e) => pick(e, ['budget', 'spend', 'remaining', 'overspend'])),
    // overspend 为 plan_id 判定，去身份后仅保留「超支计划数」这类纯计数
    overspendCount: (r.budgetTrend?.overspend || []).length,
  };

  const meta = {
    // planCompletion 原本以 plan_id 为键 → 去身份后改为纯计数数组（丢弃键本身即丢身份）
    planCompletion: Object.values(r.meta?.planCompletion || {}).map((e) => pick(e, ['done', 'failed', 'total', 'rate'])),
    timeBiasVector: r.meta?.timeBiasVector || [],
    // 轨迹签名去掉 gid（原始内部 id）
    trajectorySignatures: (r.meta?.trajectorySignatures || []).map((g) => pick(g, ['actsEnded', 'vf', 'yieldDensity'])),
  };

  return {
    period: r.period, offset: r.offset, start: r.start, end: r.end, label: r.label,
    activity: r.activity,
    ledger, plan, balance, vf: r.vf,
    actDetail, timeBias, valueYield, schedHealth: r.schedHealth, budgetTrend, meta,
  };
}
