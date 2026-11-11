// ============================================================
// domain/plangen.js —— 战术表：空闲窗派生 + 日表贪心生成
//
// 只产出「建议」，不写库、不创建活动；真正写入仍由 engine 的状态机与
// 资源不变量把关（方案只建议，不自动执行）。
//
// 两个语义在这里汇合：
//   注意力（attention.js）决定「一天长什么样」：工作窗、深度预算；
//   地点（places.js）决定「换地方要付多少时间」：通勤。
//
// 日锚定启发式：
//   - 起手就在当前地点（如已在工位）→ 当天视为「锚定日」，不再跨地点改道；
//   - 起手需要先通勤（如从家去工位）→ 当天视为「移动日」，允许跨地点，
//     但换地点必须发生在同一个工作窗内，否则宁可放弃（不把一天切碎）。
// ============================================================
import { FOCUS_PROFILES, classifyDepth, rhoReport } from './attention.js';
import { commuteMinutes } from './places.js';

const MIN = 60000;

function dayBounds(dateLike) {
  const d = new Date(dateLike == null ? Date.now() : dateLike);
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  return { start, end: start + 24 * 60 * MIN };
}

// 兼容毫秒与 'YYYY-MM-DDTHH:MM'（本地时区）
export function msOf(v) {
  if (v == null || v === '') return 0;
  if (typeof v === 'number') return v;
  const s = String(v);
  const m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:T(\d{1,2}):(\d{2}))?/);
  if (!m) return 0;
  return new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0)).getTime();
}

function sameDay(ms, dayStartMs) {
  if (!ms) return false;
  const d = new Date(ms);
  const s = new Date(dayStartMs);
  return d.getFullYear() === s.getFullYear()
    && d.getMonth() === s.getMonth()
    && d.getDate() === s.getDate();
}

/**
 * 默认工作窗：上午 9:00–12:00，下午 14:00–18:00。
 * 保持纯函数，不读配置；用户偏好由调用方覆盖。
 */
export function defaultWorkWindows(dateLike) {
  const { start } = dayBounds(dateLike);
  const d = new Date(start);
  const at = (h, m = 0) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m).getTime();
  return [
    { start: at(9), end: at(12) },
    { start: at(14), end: at(18) },
  ];
}

/**
 * 从工作窗中扣除当天已排定（有 planned_start）的固定活动。
 * @returns {Array<{start:number,end:number}>} 升序、互不重叠的空闲窗
 */
export function deriveAvailWindows(db, dateLike, windows) {
  const { start: dayStart, end: dayEnd } = dayBounds(dateLike);
  const fixed = ((db && db.activities) || [])
    .filter((a) => a && a.planned_start && a.status !== 'Failed' && a.status !== 'Archived')
    .map((a) => {
      const s = msOf(a.planned_start);
      const m = Number(a.planned_minutes) || 0;
      return { start: s, end: s + m * MIN };
    })
    .filter((x) => x.start > 0 && x.end > x.start && x.start < dayEnd && x.end > dayStart)
    .sort((a, b) => a.start - b.start);

  const base = (Array.isArray(windows) && windows.length ? windows : defaultWorkWindows(dayStart))
    .map((w) => ({
      start: Math.max(w.start, dayStart),
      end: Math.min(w.end, dayEnd),
    }))
    .filter((w) => w.end > w.start)
    .sort((a, b) => a.start - b.start);

  const out = [];
  for (const w of base) {
    let cursor = w.start;
    for (const f of fixed) {
      if (f.end <= cursor) continue;
      if (f.start >= w.end) break;
      if (f.start > cursor) out.push({ start: cursor, end: Math.min(f.start, w.end) });
      cursor = Math.max(cursor, Math.min(f.end, w.end));
      if (cursor >= w.end) break;
    }
    if (cursor < w.end) out.push({ start: cursor, end: w.end });
  }
  return out.filter((w) => w.end > w.start).sort((a, b) => a.start - b.start);
}

function toPeaks(p) {
  const arr = Array.isArray(p) ? p : (p && Array.isArray(p.peaks) ? p.peaks : []);
  return arr.map(([a, b]) => ({ a: a * 60, b: b * 60 }));
}

// 区间落在高能时段的比例（0~1）
function peakFactor(startMs, endMs, peaks) {
  if (!(endMs > startMs)) return 0;
  const d = new Date(startMs);
  const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const s = (startMs - dayStart) / MIN;
  const e = (endMs - dayStart) / MIN;
  let overlap = 0;
  for (const p of peaks) overlap += Math.max(0, Math.min(e, p.b) - Math.max(s, p.a));
  return Math.min(1, overlap / (e - s));
}

function minutesOf(a) {
  const n = Number(a && a.planned_minutes);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function placeOf(a) {
  return (a && a.place_id) || null;
}

function isFlexible(a, dayStart) {
  if (!a || a.status !== 'Planned') return false;
  if (a.planned_start) return false;
  if (a.planned_date) {
    const pd = msOf(a.planned_date);
    if (pd && !sameDay(pd, dayStart)) return false;
  }
  return minutesOf(a) > 0;
}

// 从 fromIndex 起找一段能放 minutes 的连续空位（可顺延到后续窗）
function findSlot(windows, fromIndex, earliest, minutes) {
  for (let i = fromIndex; i < windows.length; i++) {
    const w = windows[i];
    const start = Math.max(w.start, i === fromIndex ? earliest : w.start);
    if (start + minutes * MIN <= w.end) {
      return { start, end: start + minutes * MIN, windowIndex: i };
    }
  }
  return null;
}

/**
 * 生成一天的活动排布建议。
 * @param {object} db { activities, plans, places, commutes }
 * @param {object} opts { date, now, currentPlaceId, profile, peaks }
 * @returns {{
 *   assignments: Array<{activityId,start,end,windowIndex,depth}>,
 *   unplaced: Array<{activityId,reason}>,
 *   rho: object,
 *   windows: Array<{start:number,end:number}>,
 *   commuteMin: number
 * }}
 */
export function generateDayPlan(db, {
  date = Date.now(),
  now = Date.now(),
  currentPlaceId = null,
  profile = 'deep',
  peaks = null,
} = {}) {
  const { start: dayStart } = dayBounds(date);
  const nowMs = typeof now === 'number' ? now : new Date(now).getTime();
  const prof = FOCUS_PROFILES[profile] || FOCUS_PROFILES.deep;
  const budgetMin = prof.dailyBudgetMin;

  const windows = deriveAvailWindows(db, dayStart, defaultWorkWindows(dayStart));
  const availMin = windows.reduce((s, w) => s + (w.end - w.start) / MIN, 0);

  const candidates = ((db && db.activities) || []).filter((a) => isFlexible(a, dayStart));
  const pk = toPeaks(peaks);

  const assignments = [];
  const unplaced = [];

  let lastEnd = 0;
  let lastWindow = -1;
  let currentPlace = currentPlaceId || null;
  let anchored = false;
  let anchorDecided = false;
  let usedDepth = 0;
  let scheduledMin = 0;
  let commuteMin = 0;

  for (const a of candidates) {
    const minutes = minutesOf(a);
    const depth = classifyDepth(a);
    const target = placeOf(a);

    // 深度预算：超出即不排，避免把超量深度塞进浅层时段
    if (depth && usedDepth + minutes > budgetMin) {
      unplaced.push({ activityId: a.id, reason: 'budget' });
      continue;
    }

    let slot = null;

    if (!anchorDecided) {
      // 当天第一个落位：允许从当前位置通勤过去
      let commute = 0;
      if (currentPlace && target && target !== currentPlace) {
        commute = commuteMinutes(db, currentPlace, target);
        if (commute == null) {
          unplaced.push({ activityId: a.id, reason: 'place' });
          continue;
        }
      }
      const from = Math.max(nowMs, dayStart);
      if (depth) {
        // 深度活动优先高能窗
        const order = windows.map((w, i) => {
          const start = Math.max(w.start, from);
          return { i, w, pf: peakFactor(start, start + minutes * MIN, pk) };
        }).sort((x, y) => (y.pf - x.pf) || (x.i - y.i));
        for (const o of order) {
          const arrival = Math.max(o.w.start, from) + commute * MIN;
          if (arrival + minutes * MIN <= o.w.end) {
            slot = { start: arrival, end: arrival + minutes * MIN, windowIndex: o.i, commute };
            break;
          }
        }
      } else {
        for (let i = 0; i < windows.length; i++) {
          const w = windows[i];
          const arrival = Math.max(w.start, from) + commute * MIN;
          if (arrival + minutes * MIN <= w.end) {
            slot = { start: arrival, end: arrival + minutes * MIN, windowIndex: i, commute };
            break;
          }
        }
      }
      if (!slot) {
        unplaced.push({ activityId: a.id, reason: 'time' });
        continue;
      }

      anchored = !!currentPlace && target === currentPlace;
      anchorDecided = true;
    } else if (target && target !== currentPlace) {
      // 跨地点：锚定日不改道；移动日必须落在当前工作窗内
      if (anchored) {
        unplaced.push({ activityId: a.id, reason: 'place' });
        continue;
      }
      const commute = commuteMinutes(db, currentPlace, target);
      if (commute == null) {
        unplaced.push({ activityId: a.id, reason: 'place' });
        continue;
      }
      const w = windows[lastWindow];
      const start = w ? Math.max(w.start, lastEnd) + commute * MIN : 0;
      if (w && start + minutes * MIN <= w.end) {
        slot = { start, end: start + minutes * MIN, windowIndex: lastWindow, commute };
      } else {
        unplaced.push({ activityId: a.id, reason: 'commute-gap' });
        continue;
      }
    } else {
      // 同地点（或无地点约束）：从上一段之后继续，可顺延到后续窗
      const from = lastWindow >= 0 ? lastEnd : Math.max(nowMs, dayStart);
      slot = windows.length ? findSlot(windows, Math.max(0, lastWindow), from, minutes) : null;
      if (!slot) {
        unplaced.push({ activityId: a.id, reason: 'time' });
        continue;
      }
      slot.commute = 0;
    }

    assignments.push({
      activityId: a.id,
      start: slot.start,
      end: slot.end,
      windowIndex: slot.windowIndex,
      depth,
    });
    scheduledMin += minutes + (slot.commute || 0);
    commuteMin += slot.commute || 0;
    if (depth) usedDepth += minutes;
    lastEnd = slot.end;
    lastWindow = slot.windowIndex;
    if (target) currentPlace = target;
  }

  // 深度需求（用于 ρF，不因预算裁剪而失真）
  const depthDemandMin = candidates
    .filter((a) => classifyDepth(a))
    .reduce((s, a) => s + minutesOf(a), 0);

  const rho = rhoReport({ scheduledMin, availMin, depthDemandMin, budgetMin });

  return { assignments, unplaced, rho, windows, commuteMin };
}
