// ============================================================
// domain/attention.js —— 注意力窗口（硬约束）
// 参数依据：单次深度专注 60–90 分钟，间隔休息 15–20，日深度总量 4–6 小时；
// 连续 2–3 个深度窗后长休 30–60；高能时段 lark ≈ 9–11 / 16–18，owl 后移 2h。
// 这里只做「骨架 / 预算 / 负载 / 提前量」，不做任何 UI。
// ============================================================
import { actTemplateOf } from './activitygraph.js';

export const FOCUS_PROFILES = {
  deep: { focus: [60, 90], rest: [15, 20], dailyBudgetMin: 300, longRestAfter: 2, longRestMin: 30 },
  normal: { focus: [45, 45], rest: [10, 10], dailyBudgetMin: 360, longRestAfter: 3, longRestMin: 30 },
  pomo: { focus: [25, 25], rest: [5, 5], dailyBudgetMin: 300, longRestAfter: 4, longRestMin: 30 },
};

export const CHRONOTYPES = {
  lark: { peaks: [[9, 11], [16, 18]] },
  owl: { peaks: [[11, 13], [18, 20]] },
};

function toPeaks(p) {
  const arr = Array.isArray(p) ? p : (p && Array.isArray(p.peaks) ? p.peaks : []);
  return arr.map(([a, b]) => ({ a: a * 60, b: b * 60 }));
}

// 区间落在高能时段的比例（0~1），用于给窗口标 energy
function peakFactor(startMs, endMs, peaks) {
  if (!(endMs > startMs)) return 0;
  const d = new Date(startMs);
  const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const s = (startMs - dayStart) / 60000;
  const e = (endMs - dayStart) / 60000;
  let overlap = 0;
  for (const p of peaks) overlap += Math.max(0, Math.min(e, p.b) - Math.max(s, p.a));
  return Math.min(1, overlap / (e - s));
}

/**
 * 把可用时间切成交替的 focus / rest / shallow 骨架。
 * 预算用完后剩余时间降级为 shallow，不再开深度窗。
 * @param {Array<{start:number,end:number}>} windows
 * @param {string} profileName deep|normal|pomo
 * @param {object} opts { peaks }
 * @returns {Array<{kind:'focus'|'rest'|'shallow', start:number, end:number, peakFactor?:number}>}
 */
export function buildFocusSkeleton(windows, profileName = 'deep', { peaks = CHRONOTYPES.lark } = {}) {
  const prof = FOCUS_PROFILES[profileName] || FOCUS_PROFILES.deep;
  const pks = toPeaks(peaks);
  const focusMin = prof.focus[0];
  const focusMax = prof.focus[1];
  const restNormal = prof.rest[1];
  const restMax = prof.rest[1];
  const items = [];
  let used = 0;

  for (const w of windows || []) {
    let cursor = w.start;
    let focusCount = 0;
    for (;;) {
      const remain = w.end - cursor;
      // 紧窗（放不下上限专注 + 休息）退到下限，给休息后的浅层残段留空间
      const focusLen = remain >= (focusMax + restMax) * 60000 ? focusMax : focusMin;
      if (remain < focusLen * 60000) break;
      if (used + focusLen > prof.dailyBudgetMin) break;

      const end = cursor + focusLen * 60000;
      items.push({ kind: 'focus', start: cursor, end, peakFactor: peakFactor(cursor, end, pks) });
      cursor = end;
      used += focusLen;
      focusCount += 1;

      // 每 longRestAfter 个普通专注窗之后安排一次长休
      const restLen = (focusCount % (prof.longRestAfter + 1) === 0) ? prof.longRestMin : restNormal;
      if (w.end - cursor >= restLen * 60000) {
        items.push({ kind: 'rest', start: cursor, end: cursor + restLen * 60000 });
        cursor += restLen * 60000;
      } else {
        break; // 残段留给 shallow
      }
    }
    if (cursor < w.end) items.push({ kind: 'shallow', start: cursor, end: w.end });
  }
  return items.sort((a, b) => a.start - b.start);
}

// 深度活动判定：≥45 分钟；可显式 depth 覆盖（true/false）
export function classifyDepth(a) {
  if (a && a.depth === true) return true;
  if (a && a.depth === false) return false;
  return Number(a && a.planned_minutes) >= 45;
}

/**
 * 负载诊断 ρ。
 * rhoTime = 已排分钟 / 可用分钟；rhoDepth = 深度需求 / 日深度预算。
 * ≤0.85 ok / ≤1 tight / >1 over。
 */
export function rhoReport({ scheduledMin = 0, availMin = 0, depthDemandMin = 0, budgetMin = 0 } = {}) {
  const rhoTime = availMin > 0 ? scheduledMin / availMin : 0;
  const rhoDepth = budgetMin > 0 ? depthDemandMin / budgetMin : 0;
  const worst = Math.max(rhoTime, rhoDepth);
  const level = worst > 1 ? 'over' : (worst > 0.85 ? 'tight' : 'ok');
  return {
    rhoTime: Math.round(rhoTime * 100) / 100,
    rhoDepth: Math.round(rhoDepth * 100) / 100,
    level,
    depthOverMin: Math.max(0, Math.round(depthDemandMin - budgetMin)),
  };
}

// 中位数
function median(arr) {
  const s = arr.slice().sort((a, b) => a - b);
  if (!s.length) return 0;
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * 自适应提前量：样本 ≥3 时按迟到中位数上调，避免「固定 15 分钟」对总迟到的活动太晚。
 * @param {Array<{lateMin:number}>} samples
 * @param {number} base 默认提前量
 */
export function adaptiveLeadMinutes(samples, base = 15) {
  const arr = (samples || []).map((x) => Number(x && x.lateMin)).filter(Number.isFinite);
  if (arr.length < 3) return base;
  return base + Math.max(0, Math.round(median(arr)));
}

// 兼容毫秒与 'YYYY-MM-DDTHH:MM'
function msOf(v) {
  if (v == null) return 0;
  if (typeof v === 'number') return v;
  const m = String(v).match(/^(\d{4})-(\d{1,2})-(\d{1,2})T(\d{1,2}):(\d{2})/);
  if (!m) return 0;
  return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]).getTime();
}

/**
 * 按活动模板（尾随数字归一）聚合历史迟到，给该模板的提前量。
 * @param {object} db { activities }
 * @param {string} title 当前活动标题
 * @param {number} base
 */
export function templateLeadMinutes(db, title, base = 15) {
  const tmpl = actTemplateOf(title);
  const samples = [];
  for (const a of (db && db.activities) || []) {
    if (a.status !== 'Completed' && a.status !== 'Reviewed') continue;
    if (actTemplateOf(a.title) !== tmpl) continue;
    const ps = msOf(a.planned_start);
    const as = msOf(a.actual_start);
    if (!ps || !as) continue;
    samples.push({ lateMin: Math.round((as - ps) / 60000) });
  }
  return adaptiveLeadMinutes(samples, base);
}
