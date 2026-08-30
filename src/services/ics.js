// ============================================================
// services/ics.js
// iCalendar 导出（仅导出，只读互通）：
//   把全部活动（循环系列展开 occurrences[]）导出为 .ics，可导入系统日历/Google 日历查看。
//   单机闭环不回导——往返会丢账本字段（预设收支、资源绑定），故只做导出。
// ============================================================
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { toast } from '../ui/helpers.js';

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

// 生成 ICS 文本 → { text, count }（count = 导出的事件实例数）
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
    // 实例：非循环=活动自身；循环=展开 occurrences[]（每期一条，保留可见历史）
    const dates = (a.repeat && Array.isArray(a.occurrences) && a.occurrences.length)
      ? a.occurrences.map((o) => ({ date: o.date, occ: o }))
      : (a.planned_date ? [{ date: a.planned_date, occ: null }] : []);
    for (const { date, occ } of dates) {
      const st = occ ? (occ.status === 'done' ? 'CONFIRMED' : occ.status === 'skipped' ? 'CANCELLED' : status) : status;
      const hasTime = !!time && mins > 0;
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
};
