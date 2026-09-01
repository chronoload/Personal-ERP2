// ============================================================
// domain/mdapply.js
// 把 mdimport 解析出的候选应用到 db（双向的「写回」半边）：
//   带 id（导出 round-trip）→ 更新已有实体（不复制）；
//   无 id（手打）→ 走 engine 工厂新建。
// 依赖 engine 的 create/update 工厂与状态机，纯逻辑可 node 测试。
// ============================================================
import {
  createGoal, updateGoal, createPlan, updatePlan,
  createActivity, updateActivity, setActivityStatus,
} from './engine.js';

function statusOf(act) {
  return act.status === 'Completed' || act.status === 'Reviewed' ? 'Completed' : 'Planned';
}

/**
 * 应用候选到 db（原地修改并返回统计）。
 * @param {object} db 现有 db（会被就地更新）
 * @param {object} r  parseMdImport 的候选 { goals, plans, activities, warnings }
 * @returns {{ created:number, updated:number, warnings:Array }}
 */
export function applyCandidates(db, r) {
  const stat = { created: 0, updated: 0, warnings: [...(r.warnings || [])] };
  const goalIdByKey = new Map();
  const planIdByKey = new Map();

  // ---- goals：带 id → 更新；无 id → 新建 ----
  for (const g of r.goals || []) {
    if (g.id && db.goals.some((x) => x.id === g.id)) {
      const res = updateGoal(db, g.id, { title: g.title, desc: g.desc });
      if (res.ok) { stat.updated++; goalIdByKey.set(g.key, g.id); }
      else stat.warnings.push(res.error);
    } else {
      const res = createGoal(db, { title: g.title, desc: g.desc });
      if (res.ok) {
        const id = db.goals[db.goals.length - 1].id;
        goalIdByKey.set(g.key, id);
        stat.created++;
      } else stat.warnings.push(res.error);
    }
  }

  // ---- plans：goal 用 key→id 映射（budget 显式传 null，防 undefined 触发校验）----
  for (const p of r.plans || []) {
    const goalId = goalIdByKey.get(p.goal_key) || null;
    if (p.id && db.plans.some((x) => x.id === p.id)) {
      const ex = db.plans.find((x) => x.id === p.id);
      const res = updatePlan(db, p.id, { title: p.title, budget: ex.budget ?? null });
      if (res.ok) {
        if (goalId && ex.goal_id !== goalId) ex.goal_id = goalId; // updatePlan 不含 goal_id，手动同步归属
        stat.updated++;
        planIdByKey.set(p.key, p.id);
      } else stat.warnings.push(res.error);
    } else {
      const res = createPlan(db, { goal_id: goalId, title: p.title, budget: null });
      if (res.ok) {
        const id = db.plans[db.plans.length - 1].id;
        planIdByKey.set(p.key, id);
        stat.created++;
      } else stat.warnings.push(res.error);
    }
  }

  // ---- activities ----
  for (const a of r.activities || []) {
    const planId = planIdByKey.get(a.plan_key) || null;
    const payload = {
      title: a.title,
      note: a.note || '',
      plan_ids: planId ? [planId] : [],
      planned_start: a.planned_start || null,
      planned_minutes: a.planned_minutes || 0,
    };
    const targetStatus = statusOf(a);
    const tryComplete = (id) => {
      // [x] 完成态：不绕过状态机（Completed 需经 Started+完成流程），合法流转则设，否则提示
      const ex = db.activities.find((x) => x.id === id);
      if (!ex || ex.status !== 'Planned') return;
      const sr = setActivityStatus(db, id, 'Completed');
      if (sr.ok) return;
      stat.warnings.push(`「${a.title}」标记完成未生效：${sr.error}（手打完成态需在 App 内走完成流程）`);
    };
    if (a.id && db.activities.some((x) => x.id === a.id)) {
      const res = updateActivity(db, a.id, payload);
      if (!res.ok) { stat.warnings.push(res.error); continue; }
      stat.updated++;
      if (targetStatus === 'Completed') tryComplete(a.id);
    } else {
      const res = createActivity(db, payload);
      if (!res.ok) { stat.warnings.push(res.error); continue; }
      stat.created++;
      const id = db.activities[db.activities.length - 1].id;
      if (targetStatus === 'Completed') tryComplete(id);
    }
  }
  return stat;
}
