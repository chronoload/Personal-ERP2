// ============================================================
// domain/signature.js
// L4 轨迹签名：把用户努力轨迹编码为「事件序列」（非周期聚合——只有事件顺序
// 才保有 L4 要的真时序信号，对抗评审 #3 修复），用于社区模式匹配（pattern-matching，
// 非 people-matching）。全程去身份 + k-匿名（对抗评审 #4 修复）。
// 纯函数、零依赖、无副作用，可进 node 测试。
// ============================================================

// ---- 事件类型枚举（只存符号 + 数字，绝无 *_id / title）----
export const EV = {
  goal: 'g',        // 目标事件：{ k:'g', actions, vf }
  plan: 'p',        // 计划事件：{ k:'p', biasK, n }
  output: 'o',      // 产出事件：{ k:'o', n, tagsN }
  vfClosed: 'v',    // 价值流闭环事件：{ k:'v', closed:true }
};

// ---- 事件序列编码 -------------------------------------------------

/**
 * 把 db 中「有开始时间」的事件按发生顺序排成序列。
 * 周期平移：t0 取全局最早事件，各事件只记录相对周期序号（消除绝对时间指纹）。
 * @param {object} db { activities, plans, goals, outputs, valueflows }
 * @returns {object} signature
 *   {
 *     v: 1,
 *     t0Week: 相对起点（周序号，绝对值指纹已移除）,
 *     len: 事件数,
 *     events: [{k, wk, ...数字载荷}],   // 按时间序
 *     counts: { g, p, o, v }            // 各类型计数（供 k-匿名）
 *   }
 */
export function encodeTrajectory(db, _opts = {}) {
  const acts = db.activities || [];
  const plans = db.plans || [];
  const outputs = db.outputs || [];
  const vfAll = db.valueflows || [];

  const raws = []; // { t, kind, payload }

  for (const a of acts) {
    const t = a.actual_start ?? a.created;
    if (!t) continue;
    const outIds = outputs.filter((o) => o.activity_id === a.id).map((o) => o.id);
    const vfClosed = vfAll.filter((v) => outIds.includes(v.output_id) && v.status === 'Closed').length;
    raws.push({ t, kind: EV.goal, payload: { actions: a.status === 'Completed' || a.status === 'Reviewed' ? 1 : 0, vf: vfClosed } });
  }
  for (const p of plans) {
    const t = p.created;
    if (!t) continue;
    raws.push({ t, kind: EV.plan, payload: { biasK: null, n: 0 } }); // biasK 由上层 L2 填；此处仅结构
  }
  for (const o of outputs) {
    const t = o.created;
    if (!t) continue;
    raws.push({ t, kind: EV.output, payload: { n: 1, tagsN: Array.isArray(o.tags) ? o.tags.length : 0 } });
  }
  for (const v of vfAll) {
    const t = v.closedAt ?? v.created;
    if (!t) continue;
    raws.push({ t, kind: EV.vfClosed, payload: { closed: v.status === 'Closed' ? 1 : 0 } });
  }

  if (!raws.length) return { v: 1, t0Week: 0, len: 0, events: [], counts: { g: 0, p: 0, o: 0, v: 0 } };

  // 时间平移：全局最早 → 相对周序号
  const minT = Math.min(...raws.map((r) => r.t));
  raws.sort((a, b) => a.t - b.t || (a.kind < b.kind ? -1 : 1));
  const week = 7 * 24 * 3600 * 1000;

  const events = raws.map((r) => {
    const wk = Math.floor((r.t - minT) / week);
    return { k: r.kind, wk, ...r.payload };
  });

  const counts = { g: 0, p: 0, o: 0, v: 0 };
  for (const e of events) counts[e.k]++;

  return { v: 1, t0Week: 0, len: events.length, events, counts };
}

// ---- 序列相似度（编辑距离 on 事件类型符号 + 数值加权）--------

export function editDistance(a, b) {
  const la = a.length, lb = b.length;
  if (!la) return lb;
  if (!lb) return la;
  const dp = Array.from({ length: la + 1 }, () => new Array(lb + 1).fill(0));
  for (let i = 0; i <= la; i++) dp[i][0] = i;
  for (let j = 0; j <= lb; j++) dp[0][j] = j;
  for (let i = 1; i <= la; i++) {
    for (let j = 1; j <= lb; j++) {
      const cost = a[i - 1].k === b[j - 1].k ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[la][lb];
}

/** 相似度 0~1：1 = 完全相同，0 = 完全无关（长度归一）。 */
export function similarity(sigA, sigB) {
  const A = sigA?.events || [];
  const B = sigB?.events || [];
  if (!A.length && !B.length) return 1;
  const dist = editDistance(A, B);
  return Math.max(0, 1 - dist / Math.max(A.length, B.length));
}

// ---- k-匿名抑制（对抗评审 #4）----------------------------------

/**
 * 把签名谱中样本数 < k 的「独特轨迹」抑制为 null/剔除，防止低 n 轨迹被当作指纹反指认。
 * @param {Array} profiles 匿名签名列表（可带 {sig, groupKey} 以按组聚合）
 * @param {number} k 匿名阈值（默认 5）
 * @returns {{共享: Array, 抑制: number}} 保留样本数≥k 的，其余剔除
 */
export function kAnonymitySuppress(profiles, k = 5) {
  if (!Array.isArray(profiles)) return { shared: [], suppressed: 0 };
  const cnt = new Map();
  for (const p of profiles) {
    const key = p.groupKey ?? JSON.stringify(p.sig?.events?.map((e) => e.k) ?? []);
    cnt.set(key, (cnt.get(key) || 0) + 1);
  }
  const shared = [];
  let suppressed = 0;
  for (const p of profiles) {
    const key = p.groupKey ?? JSON.stringify(p.sig?.events?.map((e) => e.k) ?? []);
    if (cnt.get(key) >= k) shared.push(p);
    else suppressed++;
  }
  return { shared, suppressed };
}
