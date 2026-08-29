// ============================================================
// domain/schedule.js
// 领域层：日程扫描纯函数模块（无 DOM、无系统时钟——时间一律由 now 参数注入）
// 职责：把「现在」投影为待办事件流：到期可开始 / 冲突或预算拦截 /
//       即将开始提醒 / 超时进行中 / 已过计划结束。UI 与服务层只消费结果。
// 复用：activityWindow / anyPlanBlocked 自引擎导入；
//       引擎内 parseDt/fmtDt 未导出，这里按等价字符串运算本地复刻（不改其定义）。
// ============================================================
import { activityWindow, anyPlanBlocked } from './engine.js';

// ---------- 本地时间助手（纯字符串/毫秒运算） ----------

// 'YYYY-MM-DDTHH:MM' → 本地毫秒时间戳
function parseDt(v) {
  const m = String(v || '').match(/^(\d{4})-(\d{1,2})-(\d{1,2})T(\d{1,2}):(\d{2})/);
  if (!m) return 0;
  return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]).getTime();
}

// 时间戳 → 'YYYY-MM-DDTHH:MM'（补零，与引擎 fmtDt 同款）
function fmtDt(ms) {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

// 本地日历日键（补零），用于「同一本地日」比较
function dateKeyOf(ms) {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function windowsOverlap(w1, w2) { return !!(w1 && w2) && w1.start < w2.end && w2.start < w1.end; }

// ---------- 表单预填 ----------

// 向上取整到下一个 5 分钟格点（恰在格点保持不变；≥23:56 数学进位到次日零点）
export function roundUp5(nowMs) {
  const STEP = 5 * 60000;
  return fmtDt(Math.ceil(nowMs / STEP) * STEP);
}

// 新建活动表单的默认开始时间预填（roundUp5 别名，语义化出口）
export function defaultStartPrefill(nowMs) {
  return roundUp5(nowMs);
}

// ---------- 日程扫描 ----------
// 把 now 投影为五类事件：
//   dueStarts  今日已到开始时刻、无阻碍、可直接开始的 Planned
//   skipped    到期但被拦截：reason='conflict'（捆绑对手仍在排）/ 'budget'（计划预算冻结）
//   preRemind  尚未到点但已进入提醒窗 [start-remindBeforeMin, start)
//   overtime   Started 且实际用时超出 计划时长（严格大于才算，整分钟数）
//   ended      Started 且计划结束时段已成过去
// 追办纪律：到期/提醒仅扫描与 now 同一本地日历日的活动（昨日逾期不补扫）
export function scanDueEvents(db, now, { remindBeforeMin = 15 } = {}) {
  const dueStarts = [], skipped = [], preRemind = [], overtime = [], ended = [];
  const todayKey = dateKeyOf(now);
  for (const a of db.activities) {
    const w = activityWindow(a); // null = 弹性活动，不占时段
    if (a.status === 'Started') {
      // 超时：实际开始 + 计划时长 < now（严格大于，边界恰好不计）
      if (Number(a.planned_minutes) > 0 && a.actual_start) {
        const overMs = now - (a.actual_start + Number(a.planned_minutes) * 60000);
        if (overMs > 0) overtime.push({ id: a.id, title: a.title, overMin: Math.floor(overMs / 60000) });
      }
      // 已结束：计划结束时段已成过去
      const pe = parseDt(a.planned_end);
      if (pe && pe < now) ended.push({ id: a.id, title: a.title });
      continue;
    }
    if (a.status !== 'Planned' || !w) continue;
    if (dateKeyOf(w.start) !== todayKey) continue; // 追办仅限同一本地日
    if (w.start <= now) {
      // 拦截校验顺序镜像 startActivity：先预算硬约束，后捆绑对手仲裁
      if (anyPlanBlocked(db, a.plan_ids)) {
        skipped.push({ id: a.id, title: a.title, reason: 'budget' });
        continue;
      }
      const rivals = (a.conflicts || [])
        .map((cid) => db.activities.find((x) => x.id === cid))
        .filter((x) => x && x.status === 'Planned' && windowsOverlap(w, activityWindow(x)));
      if (rivals.length) {
        skipped.push({ id: a.id, title: a.title, reason: 'conflict' });
        continue;
      }
      dueStarts.push({ id: a.id, title: a.title });
    } else {
      // 提醒窗：now ∈ [start-remind, start)，atMs 为提醒应触发的绝对时刻
      const atMs = w.start - remindBeforeMin * 60000;
      if (now >= atMs) preRemind.push({ id: a.id, title: a.title, atMs });
    }
  }
  return { dueStarts, skipped, preRemind, overtime, ended };
}
