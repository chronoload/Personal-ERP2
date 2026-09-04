// ============================================================
// domain/learn.js
// L2 学习引擎：从账本 + 活动历史提取跨期特征信号，作为 L3 推荐机输入；
// 产出 biasModel（biasK 时间偏差 + n 置信权重）与纯数字 de-id 特征。
// 纯函数、零依赖、无副作用，可进 node 测试（不 import 任何浏览器模块）。
// ============================================================

// ---- 内部工具 -------------------------------------------------

function actualMinutesOf(a) {
  const logs = Array.isArray(a.time_logs) ? a.time_logs : [];
  if (logs.length) {
    return logs.reduce((s, l) => s + ((l.end ?? Date.now()) - (l.start ?? 0)) / 60000, 0);
  }
  if (a.actual_start && a.actual_end) return (a.actual_end - a.actual_start) / 60000;
  return 0;
}

function goalIdsOf(act, plans) {
  const ids = new Set();
  for (const pid of act.plan_ids || []) {
    const p = plans.find((x) => x.id === pid);
    if (p?.goal_id) ids.add(p.goal_id);
  }
  return [...ids];
}

// ---- 主入口 ---------------------------------------------------

/**
 * 提取特征集（学习窗口 = 传入 db 的整个账本快照；biasModel 为 L3 主输入）。
 * @param {object} db { plans, goals, activities, outputs, valueflows, ... }
 * @returns {FeatureSet}
 *   {
 *     biasModel: [{ planId, biasK, n }],   // biasK=Σactual/Σplanned（浮点全精度）；n=置信权重；冷启动 biasK=1,n=0；孤儿计划已清理
 *     completion: { byPlan:[{planId,done,failed,total,rate}], byGoal:[{goalId,rate}] },
 *     yield:      { byPlan:[{planId,actsEnded,spentMinutes,vfCount,yieldDensityFull}], byGoal:[...] },
 *     sched:      { actsWithConflict, totalConflicts, timedActs, flexibleActs, adheredActs, total },
 *     budget:     { byPlan:[{planId,budget,spend,remaining,overspend}] },
 *   }
 * 注意：biasModel/completion/yield/budget 的 byPlan/byGoal 键是「本地内部 id」，
 * 仅供 L3 同进程消费；任何导出必须经 stripFeatureIdentity（见下）。
 */
export function extractFeatures(db, _opts = {}) {
  const plans = db.plans || [];
  const activities = db.activities || [];
  const outputs = db.outputs || [];
  const vfAll = db.valueflows || [];

  // kata: 孤儿清理 —— 只对「仍存在的计划」建 bias 键；被删除/归档的计划累计直接丢弃
  const livePlanIds = new Set(plans.map((p) => p.id));

  // ---- biasModel（时间偏差 + 置信）----
  const biasMap = new Map(); // planId -> {planId, totalPlannedMin, totalActualMin, n}
  for (const a of activities) {
    const pm = a.planned_minutes || 0;
    const am = actualMinutesOf(a);
    if (!(pm > 0 && am > 0)) continue;
    for (const pid of a.plan_ids || []) {
      if (!livePlanIds.has(pid)) continue; // 孤儿计划累计不进入
      const e = biasMap.get(pid) || { planId: pid, totalPlannedMin: 0, totalActualMin: 0, n: 0 };
      e.totalPlannedMin += pm;
      e.totalActualMin += am;
      e.n += 1;
      biasMap.set(pid, e);
    }
  }
  const biasModel = [];
  // 先出有数据的计划
  for (const e of biasMap.values()) {
    // 浮点全精度，不取整 —— 展示值(×1000)喂给 L3 会失真（精度红线）
    const biasK = e.totalPlannedMin > 0 ? e.totalActualMin / e.totalPlannedMin : 1;
    biasModel.push({ planId: e.planId, biasK, n: e.n });
  }
  // 冷启动：无实际数据的现存计划 biasK=1, n=0（L3 不信任低 n）
  for (const p of plans) {
    if (!biasMap.has(p.id)) biasModel.push({ planId: p.id, biasK: 1, n: 0 });
  }

  // ---- completion（完成率，跨期累计）----
  const planStat = new Map(); // planId -> {done,failed,total}
  const goalStat = new Map(); // goalId -> {done,failed,total}
  const statOf = (m, k, accum) => {
    if (!m.has(k)) m.set(k, { done: 0, failed: 0, total: 0 });
    m.get(k)[accum]++;
    if (!m.get(k).first) m.get(k).first = 0;
  };
  for (const a of activities) {
    const done = a.status === 'Completed' || a.status === 'Reviewed';
    const failed = a.status === 'Failed';
    if (!done && !failed) continue;
    for (const pid of a.plan_ids || []) {
      statOf(planStat, pid, done ? 'done' : 'failed');
      planStat.get(pid).total++;
    }
    for (const gid of goalIdsOf(a, plans)) {
      statOf(goalStat, gid, done ? 'done' : 'failed');
      goalStat.get(gid).total++;
    }
  }
  const completion = {
    byPlan: [...planStat.entries()]
      .filter(([pid]) => livePlanIds.has(pid))
      .map(([planId, s]) => ({ planId, done: s.done, failed: s.failed, total: s.total, rate: s.total ? s.done / s.total : 0 })),
    byGoal: [...goalStat.entries()]
      // goal 层同样只留现存目标（孤儿目标丢弃）
      .filter(([gid]) => (db.goals || []).some((g) => g.id === gid))
      .map(([goalId, s]) => ({ goalId, done: s.done, failed: s.failed, total: s.total, rate: s.total ? s.done / s.total : 0 })),
  };

  // ---- yield（价值产出密度，浮点全精度）----
  const yPlan = new Map();
  const yGoal = new Map();
  const yFetch = (m, k) => { if (!m.has(k)) m.set(k, { outputCount: 0, vfCount: 0, actsEnded: 0, spentMinutes: 0 }); return m.get(k); };
  for (const a of activities) {
    if (a.status !== 'Completed' && a.status !== 'Failed') continue;
    const outIds = outputs.filter((o) => o.activity_id === a.id).map((o) => o.id);
    const vfCount = vfAll.filter((v) => outIds.includes(v.output_id)).length;
    const am = actualMinutesOf(a);
    for (const pid of a.plan_ids || []) {
      if (!livePlanIds.has(pid)) continue;
      const e = yFetch(yPlan, pid); e.outputCount += outIds.length; e.vfCount += vfCount; e.actsEnded++; e.spentMinutes += am;
    }
    for (const gid of goalIdsOf(a, plans)) {
      if (!(db.goals || []).some((g) => g.id === gid)) continue;
      const e = yFetch(yGoal, gid); e.outputCount += outIds.length; e.vfCount += vfCount; e.actsEnded++; e.spentMinutes += am;
    }
  }
  const yieldSet = {
    byPlan: [...yPlan.entries()].map(([planId, e]) => ({ planId, ...e, yieldDensityFull: e.spentMinutes > 0 ? e.vfCount / e.spentMinutes : 0 })),
    byGoal: [...yGoal.entries()].map(([goalId, e]) => ({ goalId, ...e, yieldDensityFull: e.spentMinutes > 0 ? e.vfCount / e.spentMinutes : 0 })),
  };

  // ---- sched（排程健康）----
  let actsWithConflict = 0;
  let totalConflicts = 0;
  let timedActs = 0;
  let flexibleActs = 0;
  let adheredActs = 0;
  for (const a of activities) {
    const c = Array.isArray(a.conflicts) ? a.conflicts : [];
    if (c.length) { actsWithConflict++; totalConflicts += c.length; }
    if (a.planned_minutes > 0 && a.planned_start) timedActs++; else flexibleActs++;
    // 守约：有计划开始且实际开始落在同一天。实际开始优先 actual_start，回退首条 time_log 起点
    const agreeActStart = a.actual_start
      ?? ((Array.isArray(a.time_logs) && a.time_logs.length && a.time_logs[0].start) || null);
    if (a.planned_start && agreeActStart) {
      const pd = String(a.planned_start).split('T')[0];
      const adt = new Date(agreeActStart);
      const ad = `${adt.getFullYear()}-${adt.getMonth() + 1}-${adt.getDate()}`;
      if (pd === ad) adheredActs++;
    }
  }
  const sched = {
    actsWithConflict, totalConflicts, timedActs, flexibleActs, adheredActs,
    total: activities.length,
  };

  // ---- budget（预算消耗趋势）----
  const budget = {
    byPlan: plans.map((p) => {
      let spend = 0;
      for (const a of activities) {
        if (!(a.plan_ids || []).includes(p.id)) continue;
        if (Array.isArray(a.preset_expenses)) {
          const deets = a.preset_expenses.filter((x) => typeof x === 'object' && x.amount != null);
          spend += deets.reduce((s, x) => s + (x.amount || 0), 0);
        }
      }
      const budget = p.budget == null ? null : p.budget;
      const remaining = budget == null ? null : budget - spend;
      return {
        planId: p.id,
        budget: p.budget == null ? null : p.budget,
        spend,
        remaining,
        overspend: budget != null && spend > budget,
      };
    }),
  };

  return { biasModel, completion, yield: yieldSet, sched, budget };
}

/**
 * 把 FeatureSet 转成 de-id 导出面（去除 byPlan/byGoal 的 planId/goalId 内部 id，
 * 只留纯数字/比值/时长 —— 契约 `feature-set` 的默认形态）。
 * L3 同进程消费用 extractFeatures 原值（带 id）；导出/API/MCP/社区必须过本函数。
 */
export function stripFeatureIdentity(f) {
  if (!f) return f;
  const statShape = (e) => ({ done: e.done, failed: e.failed, total: e.total, rate: e.rate });
  const yieldShape = (e) => ({ actsEnded: e.actsEnded, spentMinutes: e.spentMinutes, vfCount: e.vfCount, outputCount: e.outputCount, yieldDensityFull: e.yieldDensityFull });
  const budgetShape = (e) => ({ budget: e.budget, spend: e.spend, remaining: e.remaining, overspend: e.overspend });
  return {
    // biasModel 去身份后只剩「偏差分布」，不暴露哪个计划
    biasRate: f.biasModel.map((e) => ({ biasK: e.biasK, n: e.n })),
    completion: {
      byPlan: f.completion.byPlan.map(statShape),
      byGoal: f.completion.byGoal.map(statShape),
    },
    yield: {
      byPlan: f.yield.byPlan.map(yieldShape),
      byGoal: f.yield.byGoal.map(yieldShape),
    },
    sched: f.sched,
    budget: {
      byPlan: f.budget.byPlan.map(budgetShape),
      overspendCount: f.budget.byPlan.filter((e) => e.overspend).length,
    },
  };
}
