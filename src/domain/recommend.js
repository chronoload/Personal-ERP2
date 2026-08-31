// ============================================================
// domain/recommend.js
// L3 推荐机：消费 L2 FeatureSet，把「下一步做什么」排成 0~100 分，
// 并把任务插入空闲时段；反馈回 L1 作「教练」表面。
// 纯函数、零依赖、无副作用，可进 node 测试。
// 关键设计（对抗评审 #2 blocker）：纯贪婪会饿死低完成率/新计划，
// 故加入 UCB 探索加成 + 最低推荐保证。
// ============================================================

// ---- 常量：评分权重（可调，纯数字）----
export const W = {
  completion: 0.20,   // 完成率高的候选加分
  yieldDensity: 0.20, // 价值产出密度
  urgency: 0.25,      // 临近截止日
  biasCorr: 0.10,     // biasK 校正后的预计投入合理性
  conflict: 0.15,     // 冲突惩罚
};

// ---- 工具 -------------------------------------------------

function clamp01(x) {
  if (x == null || Number.isNaN(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

function round2(x) { return Math.round(x * 100) / 100; }

// UCB 探索加成（Blocker 修复 #2）：低试验次数候选获得探索提升，
// 防止「总推荐完成率高任务」饿死新计划。c 为探索系数。
export function ucbBonus(n, totalTrials, c = 0.6) {
  if (n == null) n = 0;
  if (totalTrials <= 0) return 1; // 完全没有试验史 → 全探索
  // base：n=0 时给满探索；n 越大探索越小
  return c * Math.sqrt(Math.log(totalTrials + 1) / (n + 1));
}

// ---- 评分 ---------------------------------------------------

/**
 * 对单个候选活动打分（0~100）。
 * @param {object} cand 候选：{ activityId, planId, plannedStart(ms|null), deadline(ms|null),
 *   plannedMinutes, actualMinutes, n(trials), conflictsCount, over(0~1 超预算/超时), done(0~1 完成度) }
 * @param {object} feats L2 FeatureSet（用于 biasK/yieldDensity/completion 的跨期稳定值）
 * @param {object} opts { now(ms), explorationC } —— now 必须传入，供截止紧迫度与探索总次数
 * @returns {{ score, reasons[] }}
 */
export function scheduleScore(cand, feats, { now = Date.now(), explorationC = 0.6, totalTrials = null } = {}) {
  const reasons = [];

  // 完成率组件：计划级完成率（若 feats 有按 planId 的 completion）
  let completionRate = 0;
  const pc = feats?.completion?.byPlan?.find((e) => e.planId === cand.planId);
  if (pc?.total > 0) completionRate = pc.done / pc.total;
  // 兜底：候选自带完成度
  if (cand.done != null) completionRate = Math.max(completionRate, cand.done);
  const cScore = clamp01(completionRate) * W.completion;
  if (completionRate > 0.75) reasons.push(`完成率高(${round2(completionRate)})`);
  else if (completionRate > 0 && completionRate < 0.4) reasons.push('待推进（完成率低）');

  // 价值产出密度：用浮点全精度（L2 精度红线），不消费 ×1000 展示值
  let yieldD = 0;
  const ye = feats?.yield?.byPlan?.find((e) => e.planId === cand.planId);
  if (ye) yieldD = clamp01(ye.yieldDensityFull / 0.05); // 归一化：0.05 vf/min = 高分
  if (cand.extraYield != null) yieldD = Math.max(yieldD, clamp01(cand.extraYield));
  const yScore = yieldD * W.yieldDensity;
  if (yieldD > 0.6) reasons.push('价值产出密度高');

  // 紧迫度：截止日越近分越高
  let urgency = 0;
  if (cand.deadline != null) {
    const remain = cand.deadline - now;
    const day = 86400000;
    if (remain <= 0) urgency = 1;                 // 已逾期
    else if (remain <= day) urgency = 0.9;        // ≤1 天
    else if (remain <= 3 * day) urgency = 0.6;    // ≤3 天
    else urgency = clamp01(1 - remain / (14 * day)); // 14 天后趋近 0
    reasons.push(`截止紧迫(${Math.round(remain / day)}天)`);
  }
  const uScore = urgency * W.urgency;

  // biasK 校正：用学习到的偏差把计划分钟校正成「预计实际分钟」
  let estMinutes = cand.plannedMinutes || 0;
  let biasK = 1;
  if (cand.planId) biasK = feats?.biasModel?.find((e) => e.planId === cand.planId)?.biasK ?? 1;
  const corrEst = Math.round((estMinutes || 0) * biasK);
  if (corrEst > 0) reasons.push(`预计投入≈${corrEst}min(biasK ${round2(biasK)})`);
  const bScore = clamp01(1 - Math.min(1, (cand.biasWaste || 0))) * W.biasCorr; // 预留：可叠加超预算信号
  void corrEst; void biasK;

  // 冲突惩罚：已有冲突越多分越低
  const conflictCount = cand.conflictsCount || 0;
  const cfScore = clamp01(1 - conflictCount * 0.4) * W.conflict;
  if (conflictCount > 0) reasons.push(`${conflictCount}处冲突`);

  // UCB 探索（Blocker #2）：低试验次数候选加分，防饿死新计划
  const n = cand.n ?? 0;
  const tTrials = totalTrials ?? (feats?.biasModel?.length || 1);
  const exploration = ucbBonus(n, tTrials, explorationC) * 0.12; // 探索加成上限约 12 分
  if (n === 0) reasons.push('新任务（探索机会）');
  else if (n <= 2) reasons.push(`少试(${n})，给予探索`);

  const score = round2(clamp01(cScore + yScore + uScore + bScore + cfScore + exploration) * 100);

  return {
    score,
    reasons,
    parts: { completion: cScore, yield: yScore, urgency: uScore, bias: bScore, conflict: cfScore, exploration },
    estMinutes: corrEst,
    n,
  };
}

// ---- 最低推荐保证（Blocker #2）----
/**
 * 保证至少 k 个「低试验/新」候选被含入排名（否则纯高完成率会把新任务永远压下去）。
 * @param {Array} scored 已评分候选（含 .n 字段）
 * @param {number} k 期望浮现的新任务数
 * @returns {Array} 前 k 个（按 n 升序）被标记 withGuarantee
 */
export function minRecommendGuarantee(scored, k = 2) {
  if (!Array.isArray(scored) || scored.length <= k) return scored;
  const lowN = scored
    .filter((s) => (s.n ?? 0) <= 2)
    .sort((a, b) => (a.n ?? 0) - (b.n ?? 0))
    .slice(0, k);
  for (const s of lowN) {
    if (!s.reasons.includes('保底浮现')) {
      s.score = Math.max(s.score, 60); // 保底给 60 分，确保浮出水面
      s.reasons.push('保底浮现');
      s.guaranteed = true;
    }
  }
  return scored;
}

// ---- 空间时段建议 -------------------------------------------------

/**
 * 把候选排进空闲时段（贪心 + 冲突避让）。
 * @param {Array} slots 空闲时段 [{ start(ms), end(ms), label }]
 * @param {Array} candidates 候选活动（含 activityId, duration(分钟), deadline, conflicts)
 * @param {object} opts { now }
 * @returns {Array} [{ activityId, slotStart(ms), score }] 已分配；若无合适槽位则省略
 */
export function slotIntoFreeTime(slots, candidates, { now = Date.now() } = {}) {
  if (!Array.isArray(slots) || !Array.isArray(candidates)) return [];
  const taken = []; // { start, end }
  const out = [];
  for (const c of candidates) {
    const durMs = (c.duration || 0) * 60000;
    if (durMs <= 0 || !slots.length) continue;
    let placed = null;
    for (const s of slots) {
      const fit = s.end - s.start >= durMs;
      // 冲突避让：槽位区间不得与已分配重叠
      const clash = taken.some((t) => Math.max(s.start, t.start) < Math.min(s.end, t.end));
      if (fit && !clash) { placed = { slotStart: s.start }; taken.push({ start: s.start, end: s.start + durMs }); break; }
    }
    if (placed) out.push({ activityId: c.activityId, slotStart: placed.slotStart, score: c.score ?? 0 });
  }
  // 按时段顺序输出
  return out.sort((a, b) => a.slotStart - b.slotStart);
}

// ---- 顶层推荐 next（MCP 形状 recommend.next）-----------------

/**
 * 推荐「下一步做什么」：对所有候选评分、加 UCB 探索、保底浮现、按分降序前 N。
 * @param {Array} candidates 候选 { activityId, planId, plannedStart, deadline, plannedMinutes, n, conflictsCount, ... }
 * @param {object} feats L2 FeatureSet
 * @param {object} opts { now, limit, k(保底数), explorationC }
 * @returns {Array} [{ activityId, score, reasons[], estMinutes, guaranteed }] 降序
 */
export function recommendNext(candidates, feats, opts = {}) {
  const { now = Date.now(), limit = 5, k = 2, explorationC = 0.6 } = opts;
  if (!Array.isArray(candidates) || !candidates.length) return [];
  const totalTrials = feats?.biasModel?.reduce((s, e) => s + e.n, 0) || 1;
  const scored = candidates.map((c) => {
    const r = scheduleScore(c, feats, { now, explorationC, totalTrials });
    return { activityId: c.activityId, score: r.score, reasons: r.reasons, estMinutes: r.estMinutes, n: r.n, guaranteed: false, ...r.parts };
  });
  minRecommendGuarantee(scored, k);
  return scored.sort((a, b) => b.score - a.score).slice(0, limit);
}

// ---- 顺序推荐（L3 教练面 · 按完成计划的时间顺序 + 历史关联性）----
// 语义：不是「习惯」（重复性的一般已设成循环活动，不重复推），而是从「已完成活动的时间序列」里
// 学出计划间的转移关联（做了 A 之后通常接着做 B），推荐「下一个该新建」的计划。
// 连续相邻相同计划（= 循环连做）不构成转移，自动跳过。

function startHourOf(a) {
  // 兼容时间戳与 'YYYY-M-DTHH:MM' 字符串，取开始时段 "HH:MM"
  const v = a.actual_start ?? a.planned_start;
  if (v == null) return null;
  if (typeof v === 'number') {
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return null;
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }
  const m = String(v).match(/T(\d{1,2}):(\d{1,2})/);
  return m ? `${String(Number(m[1])).padStart(2, '0')}:${m[2]}` : null;
}

function aggStats(acts) {
  // 给定某计划的历史完成活动，聚合平均时长（分钟）+ 最常开始时段 "HH:MM"
  let totalMin = 0, n = 0;
  const sc = {};
  for (const x of acts) {
    totalMin += x.a.planned_minutes || 0; n++;
    const hm = startHourOf(x.a);
    if (hm) sc[hm] = (sc[hm] || 0) + 1;
  }
  const mode = Object.entries(sc).sort((a, b) => b[1] - a[1])[0];
  return {
    minutes: n ? Math.max(5, Math.round(totalMin / n / 5) * 5) : 0,
    at: mode ? mode[0] : null,
  };
}

/**
 * 从历史「已完成活动」按完成时间排序得到的计划序列中，学转移关联（prevPlan→nextPlan 计数），
 * 取「最近完成计划」的最强后继，作为「现在该新建的活动」建议（top 1）。
 * 连续相邻相同计划跳过（循环连做不构成转移）；转移数 < minTransitions 不强推。
 * 纯函数、仅本地消费、可 node 测试。
 * @param {object} db { plans, activities }
 * @param {object} opts { now(ms), minTransitions }
 * @returns {{ planId, title, fromPlan, transCount, minutes, at, lastDone, daysSince } | null}
 */
export function suggestNextPlanActivity(db, { now = Date.now(), minTransitions = 2 } = {}) {
  const plans = db.plans || [];
  const planTitle = new Map(plans.map((p) => [p.id, p.title]));
  const acts = (db.activities || [])
    .filter((a) => (a.status === 'Completed' || a.status === 'Reviewed') && Array.isArray(a.plan_ids) && a.plan_ids.length)
    .map((a) => ({ t: a.actual_end ?? a.created ?? 0, pid: a.plan_ids[0], a }))
    .filter((x) => x.t > 0)
    .sort((a, b) => a.t - b.t); // 完成时间升序 → 时间顺序
  if (acts.length < 2) return null;

  const trans = new Map(); // "prev->next" -> count
  const lastDoneByPlan = new Map();
  for (let i = 0; i < acts.length; i++) {
    const cur = acts[i];
    lastDoneByPlan.set(cur.pid, Math.max(lastDoneByPlan.get(cur.pid) || 0, cur.t));
    if (i === 0) continue;
    const prev = acts[i - 1];
    if (prev.pid === cur.pid) continue; // 相邻相同（循环连做）不构成转移
    const key = prev.pid + '->' + cur.pid;
    trans.set(key, (trans.get(key) || 0) + 1);
  }
  const lastPlan = acts[acts.length - 1].pid; // 最近完成的计划
  const nextCands = [];
  for (const [key, count] of trans) {
    const [from, to] = key.split('->');
    if (from === lastPlan) nextCands.push({ to, count });
  }
  if (!nextCands.length) return null;
  nextCands.sort((a, b) => b.count - a.count);
  const top = nextCands[0];
  if (top.count < minTransitions) return null; // 转移关联太弱不强推

  const hist = acts.filter((x) => x.pid === top.to);
  const { minutes, at } = aggStats(hist);
  const lastDone = lastDoneByPlan.get(top.to) || 0;
  return {
    planId: top.to,
    title: planTitle.get(top.to) || '',
    fromPlan: planTitle.get(lastPlan) || '',
    transCount: top.count,
    minutes,
    at,
    lastDone,
    daysSince: lastDone ? Math.max(0, Math.floor((now - lastDone) / 86400000)) : 0,
  };
}
