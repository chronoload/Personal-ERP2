// ============================================================
// services/ics.js
// iCalendar 互通：
//   导出：全部活动（循环系列展开 occurrences[]）→ .ics，可导入系统日历/Google 日历查看。
//   导入：解析 .ics（系统日历/Google 日历导出）→ 活动候选（RRULE 展开成循环活动），
//         走引擎 createActivity 落库；仅日历字段互通，账本字段（预设收支/资源绑定）不回导。
// ============================================================
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { toast } from '../ui/helpers.js';
import { saveDB } from '../store/db.js';
import { createActivity, nextOccurrenceDate } from '../domain/engine.js';

const NATIVE = () => Capacitor.isNativePlatform();

function pad(n) { return String(n).padStart(2, '0'); }
// 本地浮时（无 Z 后缀 = 按导入方本地时区显示，单机 App 语义最贴合）
function dtFrom(d, t) {
  const [y, m, dd] = String(d).split('-').map(Number);
  const mm = String(t || '').match(/(\d{1,2}):(\d{1,2})/);
  const hh = mm ? Number(mm[1]) : 0, mi = mm ? Number(mm[2]) : 0;
  return `${y}${pad(m)}${pad(dd)}T${pad(hh)}${pad(mi)}00`;
}
function dtEnd(d, t, mins) {
  const [y, m, dd] = String(d).split('-').map(Number);
  const mt = String(t || '').match(/(\d{1,2}):(\d{1,2})/);
  const s = new Date(y, m - 1, dd, mt ? Number(mt[1]) : 0, mt ? Number(mt[2]) : 0);
  const e = new Date(s.getTime() + (Number(mins) || 0) * 60000);
  return `${e.getFullYear()}${pad(e.getMonth() + 1)}${pad(e.getDate())}T${pad(e.getHours())}${pad(e.getMinutes())}00`;
}
// 全天事件：DTSTART=日期，DTEND=次日
function icsAllDay(d) { return String(d).split('-').map((x) => pad(Number(x))).join(''); }
function icsNextDay(d) {
  const [y, m, dd] = String(d).split('-').map(Number);
  const e = new Date(y, m - 1, dd + 1);
  return `${e.getFullYear()}${pad(e.getMonth() + 1)}${pad(e.getDate())}`;
}
// ICS 文本转义：\ ; , 换行
function escText(s) {
  return String(s ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}
// ICS 行折叠（>75 字节换行，续行以空格开头）——内容安全，跨行可读
function foldLine(line) {
  if (line.length <= 75) return line;
  const out = [];
  for (let i = 0; i < line.length; i += 74) out.push(line.slice(i, i + 74));
  return out.join('\r\n ');
}
function nowStamp() {
  const d = new Date();
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}
function planTitles(db, ids) {
  return (ids || []).map((pid) => { const p = db.plans.find((x) => x.id === pid); return p ? p.title : ''; }).filter(Boolean).join(',');
}

// 补零日期 'YYYY-M-D' → 'YYYYMMDD'
function padDateKey(s) {
  return String(s).split('-').map((n) => pad(Number(n))).join('');
}
// 循环 repeat → RRULE 频率主体（weekday → 工作日 BYDAY）
const FREQ_OF = { daily: 'DAILY', weekday: 'WEEKLY', weekly: 'WEEKLY', monthly: 'MONTHLY' };
function rrruleFor(a) {
  const f = FREQ_OF[a.repeat];
  if (!f) return null;
  let r = `FREQ=${f}`;
  if (a.repeat === 'weekday') r += ';BYDAY=MO,TU,WE,TH,FR';
  if (a.repeat_until) r += `;UNTIL=${padDateKey(a.repeat_until)}T235959`; // 本地浮时，覆盖直至当日结束
  return r;
}

// 生成 ICS 文本 → { text, count }。
// 循环活动 → 单条 RRULE 重复事件（与「循环活动类」对齐，系统日历显示为整洁重复事件），
// 已完成/已跳过的期次用 EXDATE 从该循环排除；非循环 → 单条事件。
export function buildICS(db) {
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Personal ERP//CN',
    'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:Personal ERP',
  ];
  const stamp = nowStamp();
  let count = 0;
  for (const a of db.activities) {
    const title = escText(a.title);
    const desc = escText(a.note || '');
    const cats = escText(planTitles(db, a.plan_ids));
    const time = a.planned_start ? a.planned_start.slice(a.planned_start.indexOf('T') + 1) : null;
    const mins = Number(a.planned_minutes) || 0;
    // 活动级状态 → 未开始 TENTATIVE / 终态 CANCELLED / 其余 CONFIRMED
    let status = a.status === 'Planned' ? 'TENTATIVE' : (a.status === 'Failed' ? 'CANCELLED' : 'CONFIRMED');
    const hasTime = !!time && mins > 0;

    const recur = a.repeat && FREQ_OF[a.repeat] && Array.isArray(a.occurrences) && a.occurrences.length;
    const stamps = recur
      ? a.occurrences.map((o) => ({ date: o.date, occ: o }))
      : (a.planned_date ? [{ date: a.planned_date, occ: null }] : []);

    if (recur) {
      // 循环：单事件 + RRULE；DTSTART 取首个 pending 期（历史 done/skipped 不再重排）
      const first = a.occurrences.find((o) => o.status === 'pending') || a.occurrences[0];
      const date = first.date;
      const dtstart = hasTime ? dtFrom(date, time) : icsAllDay(date);
      const dtend = hasTime ? dtEnd(date, time, mins) : icsNextDay(date);
      const rrule = rrruleFor(a);
      const vevent = [
        'BEGIN:VEVENT',
        `UID:perp-${a.id}@personal-erp`,
        `DTSTAMP:${stamp}`,
        `DTSTART:${dtstart}`,
        `DTEND:${dtend}`,
        `RRULE:${foldLine(rrule)}`,
        `SUMMARY:${title}`,
      ];
      // 已完成/已跳过的期次：从循环里排除（不再作为待办重复出现）
      const excDates = a.occurrences
        .filter((o) => o.status === 'done' || o.status === 'skipped')
        .map((o) => (hasTime ? `${padDateKey(o.date)}T${String(time).replace(':', '')}00` : padDateKey(o.date)));
      if (excDates.length) vevent.push((hasTime ? 'EXDATE:' : 'EXDATE;VALUE=DATE:') + excDates.join(','));
      if (desc) vevent.push(`DESCRIPTION:${desc}`);
      if (cats) vevent.push(`CATEGORIES:${cats}`);
      vevent.push(`STATUS:${status}`, 'END:VEVENT');
      lines.push(...vevent.map(foldLine));
      count++; // 一条重复事件
      continue;
    }

    for (const { date, occ } of stamps) {
      const st = occ ? (occ.status === 'done' ? 'CONFIRMED' : occ.status === 'skipped' ? 'CANCELLED' : status) : status;
      const dtstart = hasTime ? dtFrom(date, time) : icsAllDay(date);
      const dtend = hasTime ? dtEnd(date, time, mins) : icsNextDay(date);
      const vevent = [
        'BEGIN:VEVENT',
        `UID:perp-${a.id}-${String(date).split('-').map((x) => pad(Number(x))).join('')}@personal-erp`,
        `DTSTAMP:${stamp}`,
        `DTSTART:${dtstart}`,
        `DTEND:${dtend}`,
        `SUMMARY:${title}`,
      ];
      if (desc) vevent.push(`DESCRIPTION:${desc}`);
      if (cats) vevent.push(`CATEGORIES:${cats}`);
      vevent.push(`STATUS:${st}`, 'END:VEVENT');
      lines.push(...vevent.map(foldLine));
      count++;
    }
  }
  lines.push('END:VCALENDAR');
  return { text: lines.join('\r\n'), count };
}

function icsFilename() {
  const d = new Date();
  return `PersonalERP_calendar_${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}.ics`;
}

export const ICS = {
  // 导出全部活动为 .ics：native 存 Documents/exports；web 触发下载
  async export(db) {
    const { text, count } = buildICS(db);
    const filename = icsFilename();
    if (NATIVE()) {
      try {
        await Filesystem.writeFile({
          path: `exports/${filename}`, data: text, directory: Directory.Documents, recursive: true, encoding: Encoding.UTF8,
        });
        toast(`已导出 ${count} 个活动 → Documents/exports/${filename}（可用系统日历打开）`);
      } catch (e) {
        toast(`导出失败：${e.message || '未知错误'}`, 'err');
      }
      return;
    }
    const blob = new Blob([text], { type: 'text/calendar;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    toast(`已导出 ${count} 个活动（.ics）`);
  },

  // 导入 .ics 文件（file input 跨平台）：解析 → 落库 → 刷新
  import(onDone) {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = '.ics,text/calendar';
    inp.onchange = () => {
      const f = inp.files && inp.files[0];
      if (!f) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const { candidates, warnings } = parseICS(reader.result);
          if (!candidates.length) { toast('未解析到可用活动', 'warn'); return; }
          const { created, deduped } = importActivities(App.db, candidates);
          saveDB(App.db);
          App.refresh();
          const parts = [];
          if (created) parts.push(`导入 ${created}`);
          if (deduped) parts.push(`对齐去重 ${deduped}`);
          if (warnings.length) parts.push(`跳过 ${warnings.length}`);
          toast(parts.length ? parts.join(' · ') : '无新增', created ? 'ok' : 'warn');
          if (onDone) onDone({ created, deduped, warnings });
        } catch (e) {
          toast(`导入失败：${e.message || '文件格式异常'}`, 'err');
        }
      };
      reader.readAsText(f);
    };
    inp.click();
  },
};

// ============================================================
// ---- ICS 解析（纯函数，可 node 测试）----
// 支持子集：单次 / 全天 / RRULE(FREQ=DAILY|WEEKLY|MONTHLY, UNTIL|COUNT)；
// 复杂规则（INTERVAL>1、BYMONTHDAY 等）降级为首期 + warning。
// ============================================================

// 还原 ICS 转义（\\ \, \; \n）
function unescText(s) {
  return String(s ?? '').replace(/\\([\\;,n])/g, (m, ch) => (ch === 'n' ? '\n' : ch));
}

// '20260907T090000' / '20260907T090000Z'(UTC) / '20260907'(全天)
function parseICSDate(s) {
  const t = String(s || '').trim();
  let m = t.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/);
  if (m) {
    const utc = !!m[7];
    const d = utc
      ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]))
      : new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
    return {
      date: `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`,
      time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
      allDay: false,
    };
  }
  m = t.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m) return { date: `${+m[1]}-${+m[2]}-${+m[3]}`, time: null, allDay: true };
  return null;
}

// 解析 RRULE → { freq, until, count }
function parseRRULE(s) {
  const out = { freq: null, until: null, count: null };
  for (const part of String(s || '').split(';')) {
    const i = part.indexOf('=');
    if (i <= 0) continue;
    const k = part.slice(0, i).toUpperCase();
    const v = part.slice(i + 1);
    if (k === 'FREQ') out.freq = v;
    else if (k === 'UNTIL') out.until = v;
    else if (k === 'COUNT') out.count = parseInt(v, 10) || null;
  }
  return out;
}

// UNTIL(带 Z = UTC) → 'YYYY-M-D'（本地）
function untilToDate(s) {
  const d = parseICSDate(s);
  return d ? d.date : null;
}

// 解析 ICS 文本 → { candidates, warnings }
export function parseICS(text) {
  const warnings = [];
  const candidates = [];
  const MAX_OCC = 365; // 展开上限（防失控；无 COUNT/UNTIL 的无限循环也截断）
  // 展开折叠行（续行以空格/制表开头）
  const unfolded = String(text || '').replace(/\r\n?/g, '\n').split('\n')
    .reduce((acc, line) => {
      if (/^[ \t]/.test(line) && acc.length) acc[acc.length - 1] += line.slice(1);
      else acc.push(line);
      return acc;
    }, []);
  // 按 VEVENT 分块（保留每块首个同名属性）
  const events = [];
  let ev = null;
  const flush = () => { if (ev) { events.push(ev); ev = null; } };
  for (const line of unfolded) {
    const t = line.trim();
    if (t === 'BEGIN:VEVENT') { flush(); ev = {}; continue; }
    if (t === 'END:VEVENT') { flush(); continue; }
    if (!ev) continue;
    const ci = t.indexOf(':');
    if (ci <= 0) continue;
    const key = t.slice(0, ci).split(';')[0].toUpperCase();
    const val = t.slice(ci + 1);
    if (!(key in ev)) ev[key] = val;
  }
  flush();

  for (const e of events) {
    const title = unescText(e.SUMMARY || '').trim() || '（未命名活动）';
    const note = unescText(e.DESCRIPTION || '');
    const start = parseICSDate(e.DTSTART);
    if (!start) { warnings.push(`「${title}」无法解析开始时间，已跳过`); continue; }
    // 时长（分钟）：DTEND-DTSTART 或 DURATION
    let minutes = 0;
    if (e.DTEND) {
      const end = parseICSDate(e.DTEND);
      if (end && !end.allDay && !start.allDay) {
        const toMs = (x) => new Date(...String(x.date).split('-').map(Number), ...x.time.split(':').map(Number)).getTime();
        minutes = Math.max(0, Math.round((toMs(end) - toMs(start)) / 60000));
      }
    } else if (e.DURATION) {
      const dm = String(e.DURATION).match(/PT(\d+)M/);
      const dh = String(e.DURATION).match(/PT(\d+)H/);
      if (dm) minutes = +dm[1];
      else if (dh) minutes = +dh[1] * 60;
    }
    // RRULE → 循环展开
    let repeat = null;
    let repeat_until = null;
    let dates = [start.date];
    if (e.RRULE) {
      const r = parseRRULE(e.RRULE);
      if (r.freq === 'DAILY') repeat = 'daily';
      else if (r.freq === 'WEEKLY') repeat = 'weekly';
      else if (r.freq === 'MONTHLY') repeat = 'monthly';
      else if (r.freq) warnings.push(`「${title}」的重复规则（${r.freq}）暂不支持，仅导入首期`);
      if (repeat) {
        if (r.until) repeat_until = untilToDate(r.until);
        const cap = r.count || MAX_OCC;
        dates = [];
        let d = start.date;
        // 补零字典序比较（'2026-9-7' 与 '2026-9-27' 需按日期语义比较）
        const cmpKey = (s) => String(s).split('-').map((n) => String(Number(n)).padStart(2, '0')).join('-');
        const untilKey = repeat_until ? cmpKey(repeat_until) : null;
        for (let i = 0; i < cap; i++) {
          if (untilKey && cmpKey(d) > untilKey) break;
          dates.push(d);
          d = nextOccurrenceDate(d, repeat);
        }
      }
    }
    candidates.push({
      title,
      note,
      planned_date: start.date,
      planned_start: start.time ? `${start.date}T${start.time}` : null,
      planned_minutes: minutes,
      repeat,
      repeat_until,
      dates,
    });
  }
  return { candidates, warnings };
}

// 候选 → db（纯引擎操作）：逐条 createActivity，循环候选覆盖精确 occurrences
// 与「循环活动类」对齐去重：标题 + 循环规律 + 起点一致 → 视为同一活动，合并期次而非重复新建；
// 保留已有 done/skipped 状态，只补入新增候选期次（幂等，重复导入同 ICS 不产生副本）。
export function importActivities(db, candidates) {
  const dateKey2 = (s) => String(s || '').split('-').map((n) => String(Number(n)).padStart(2, '0')).join('-');
  let created = 0, deduped = 0;
  for (const c of candidates || []) {
    const title = String(c.title || '').trim();
    const dup = db.activities.find((x) =>
      String(x.title || '').trim() === title
      && (x.repeat || null) === (c.repeat || null)
      && dateKey2(x.planned_date) === dateKey2(c.planned_date));
    if (dup) {
      if (dup.repeat && c.dates && c.dates.length) {
        const seen = new Set((dup.occurrences || []).map((o) => dateKey2(o.date)));
        for (const d of c.dates) {
          if (!seen.has(dateKey2(d))) { dup.occurrences.push({ date: d, status: 'pending' }); seen.add(dateKey2(d)); }
        }
        if (c.repeat_until) dup.repeat_until = c.repeat_until;
      } else if (!dup.repeat) {
        dup.note = c.note || dup.note;
        if (!dup.planned_start && c.planned_start) dup.planned_start = c.planned_start;
      }
      deduped++;
      continue;
    }
    const r = createActivity(db, {
      title: c.title,
      note: c.note || '',
      plan_ids: [],
      planned_date: c.planned_date,
      planned_start: c.planned_start || null,
      planned_minutes: c.planned_minutes || 0,
      repeat: c.repeat || null,
      repeat_until: c.repeat_until || null,
    });
    if (!r.ok) continue;
    const a = db.activities[db.activities.length - 1];
    if (c.dates && c.dates.length) {
      a.occurrences = c.dates.map((d) => ({ date: d, status: 'pending' }));
      a.planned_date = c.dates[0];
    }
    created++;
  }
  return { created, deduped };
}
