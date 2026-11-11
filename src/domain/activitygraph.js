// ============================================================
// domain/activitygraph.js —— 战略图：活动模板/实例 → 目标 的最短路
// 节点：start / act:<id> / goal:<gid>
// 边权（全部非负，Dijkstra 安全）：
//   start→act  = 预计耗时 × biasK + 从当前地点的通勤
//   act→goal   = 0（该活动的计划归属此目标）
//   act→act    = 预计耗时 + 通勤 + 注意力切换成本 − 历史连续性奖励
// 说明：地点不是硬门控——能走过去就付通勤；没有任何通勤定义时才视为不可达。
// ============================================================
import { commuteMinutes, feasibleActivities } from './places.js';

// 标题 → 活动模板（尾随数字归一），与 recommend.js 同一判据
export function actTemplateOf(title) {
  const s = String(title || '').trim();
  return s.replace(/[\s_\-–—]*\d+[\s_\-–—]*$/g, '').trim() || s;
}

// 历史转移计数：只取已完成/已复盘且有完成时刻的，按时间顺序数相邻模板转移
export function transitionCounts(db) {
  const hist = (db && db.activities ? db.activities : [])
    .filter((a) => (a.status === 'Completed' || a.status === 'Reviewed')
      && Number(a.actual_end ?? a.created ?? 0) > 0)
    .map((a) => ({ t: Number(a.actual_end ?? a.created), tmpl: actTemplateOf(a.title) }))
    .filter((x) => x.tmpl)
    .sort((a, b) => a.t - b.t);
  const counts = new Map();
  for (let i = 1; i < hist.length; i++) {
    if (hist[i - 1].tmpl === hist[i].tmpl) continue; // 循环连做不算转移
    const key = hist[i - 1].tmpl + '\u0000' + hist[i].tmpl;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return counts;
}

/**
 * 构建图。
 * @param {object} db { goals, plans, activities, places, commutes }
 * @param {object} opts { currentPlaceId, biasKByPlan(Function), switchCost, continuityStep, continuityCap }
 * @returns {{ adj:Map, edgeCost(from,to):number|null, transitions:Map }}
 */
export function buildActivityGraph(db, {
  currentPlaceId = null,
  biasKByPlan = () => 1,
  switchCost = { sameTemplate: 0, samePlan: 5, other: 15 },
  continuityStep = 5,
  continuityCap = 10,
} = {}) {
  const adj = new Map();
  const add = (from, to, cost) => {
    if (!Number.isFinite(cost) || cost < 0) return; // 负边会破坏 Dijkstra 前提
    if (!adj.has(from)) adj.set(from, []);
    adj.get(from).push({ to, cost });
  };

  const acts = (db.activities || []).filter((a) => a.status === 'Planned');
  const plans = new Map((db.plans || []).map((p) => [p.id, p]));
  const transitions = transitionCounts(db);
  // 「现在从哪开始」必须是你此刻能直接做、或能直接通勤过去的；
  // 图中仍保留带通勤的假设边，但寻路时首跳只走 startable 节点。
  const startable = new Set(
    (currentPlaceId ? feasibleActivities(acts, currentPlaceId, db) : acts).map((a) => a.id),
  );

  const estOf = (a) => (Number(a.planned_minutes) || 0) * (Number(biasKByPlan(a.plan_ids?.[0])) || 1);

  // start → act
  for (const a of acts) {
    const est = estOf(a);
    let commute = 0;
    if (currentPlaceId && a.place_id && a.place_id !== currentPlaceId) {
      commute = commuteMinutes(db, currentPlaceId, a.place_id);
      if (commute == null) continue; // 没有通勤定义 → 不可达
    }
    add('start', `act:${a.id}`, est + commute);
  }

  // act → goal（计划归属）
  for (const a of acts) {
    for (const pid of a.plan_ids || []) {
      const plan = plans.get(pid);
      if (!plan || !plan.goal_id) continue;
      add(`act:${a.id}`, `goal:${plan.goal_id}`, 0);
    }
  }

  // act → act（转移）
  for (const a of acts) {
    for (const b of acts) {
      if (a.id === b.id) continue;
      let commute = 0;
      if (a.place_id && b.place_id && a.place_id !== b.place_id) {
        commute = commuteMinutes(db, a.place_id, b.place_id);
        if (commute == null) continue;
      }
      const tplA = actTemplateOf(a.title);
      const tplB = actTemplateOf(b.title);
      let sw = switchCost.other;
      if (tplA === tplB) sw = switchCost.sameTemplate;
      else if ((a.plan_ids || []).some((p) => (b.plan_ids || []).includes(p))) sw = switchCost.samePlan;

      const cnt = transitions.get(tplA + '\u0000' + tplB) || 0;
      const bonus = Math.min(continuityCap, cnt * continuityStep);
      add(`act:${a.id}`, `act:${b.id}`, Math.max(0, estOf(b) + commute + sw - bonus));
    }
  }

  return {
    adj,
    transitions,
    startable,
    edgeCost(from, to) {
      const e = (adj.get(from) || []).find((x) => x.to === to);
      return e ? e.cost : null;
    },
  };
}

/**
 * Dijkstra 最短路。节点数很小（一天几十个），O(V²) 足够且无需堆。
 * @param {object} g buildActivityGraph 产物
 * @param {string} from 起点（默认 'start'）
 * @param {string|null} goalId 目标 id；null = 在所有可达目标里取成本最小者
 * @returns {{path:string[], cost:number, goalId:string}|null}
 */
export function shortestPathToGoal(g, from = 'start', goalId = null) {
  const dist = new Map([[from, 0]]);
  const prev = new Map();
  const visited = new Set();

  for (;;) {
    let u = null, du = Infinity;
    for (const [k, v] of dist) if (!visited.has(k) && v < du) { u = k; du = v; }
    if (u === null) break;
    visited.add(u);
    for (const e of (g.adj.get(u) || [])) {
      // 首跳门控：起点只能落到此刻可行的活动
      if (u === from && e.to.startsWith('act:') && g.startable
        && !g.startable.has(e.to.slice('act:'.length))) continue;
      const nd = du + e.cost;
      if (nd < (dist.get(e.to) ?? Infinity)) { dist.set(e.to, nd); prev.set(e.to, u); }
    }
  }

  // GOAL 节点可能只有入边、没有出边，因此要同时在 dist 里找
  const targets = new Set();
  for (const k of g.adj.keys()) if (k.startsWith('goal:')) targets.add(k);
  for (const k of dist.keys()) if (k.startsWith('goal:')) targets.add(k);
  let target = goalId ? `goal:${goalId}` : null;
  if (!target) {
    for (const k of targets) {
      if (!dist.has(k)) continue;
      if (!target || dist.get(k) < dist.get(target)) target = k;
    }
  }
  if (!target || !dist.has(target)) return null;

  const path = [];
  for (let cur = target; cur != null; cur = prev.get(cur)) path.unshift(cur);
  if (path[0] !== from) return null;
  return { path, cost: dist.get(target), goalId: target.slice('goal:'.length) };
}
