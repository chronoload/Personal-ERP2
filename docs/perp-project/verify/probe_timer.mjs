// ============================================================
// verify/probe_timer.mjs — TIMER & NATIVE-BRIDGE 域只读探针（report-only）
// 以可执行证据验证/证伪以下疑点（源码级推理见战报正文）：
//   P0 (C7) close() 在 build() 之前调用是否抛 TypeError（el 无守卫）
//   P1 (C1/C3) localStorage 丢失 + 原生备份完好时，restore() 是否先于
//              restoreNative() 抹掉原生 SharedPreferences 备份
//   P2 (C4) record() 记账后不清理状态 → 重开可二次入账；TKEY 残留跨重启
//       (C5) overlay 元素 close 后仍驻留 DOM → autoPilot 的
//            document.querySelector('.timer-overlay') 永久命中 → 巡检静默
// 方法：读取 src/views/timer.js 源码，剥 import/摘 export，注入桩后 new Function 执行。
// 不修改任何被测文件。运行：node docs/perp-project/verify/probe_timer.mjs
// ============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SRC = join(ROOT, 'src', 'views', 'timer.js');

// ---------- 源码变换 ----------
let code = readFileSync(SRC, 'utf8');
code = code.replace(/^import .*$/gm, '');
const EXPORTED = ['open', 'openForActivity', 'close', 'restore', 'restoreNative'];
for (const fn of EXPORTED) {
  code = code
    .replace(`export async function ${fn}(`, `async function ${fn}(`)
    .replace(`export function ${fn}(`, `function ${fn}(`);
}
code += `\nreturn { ${EXPORTED.join(', ')} };`;

// ---------- 时间旅行 Date ----------
const RealDate = Date;
let timeOffset = 0;
class FakeDate extends RealDate {
  constructor(...a) { a.length === 0 ? super(RealDate.now() + timeOffset) : super(...a); }
  static now() { return RealDate.now() + timeOffset; }
}

// ---------- mini-DOM ----------
function makeEl(tag = 'div') {
  const memo = new Map();
  const cls = new Set();
  const el = {
    tagName: tag, id: '', children: [], parent: null,
    style: {}, value: '', textContent: '', innerHTML: '', onclick: null,
    get className() { return [...cls].join(' '); },
    set className(v) { cls.clear(); for (const c of String(v).split(/\s+/)) if (c) cls.add(c); },
    classList: {
      add: (c) => { cls.add(c); }, remove: (c) => { cls.delete(c); },
      contains: (c) => cls.has(c),
      toggle: (c, on) => { on ? cls.add(c) : cls.delete(c); },
    },
    appendChild(c) { c.parent = el; el.children.push(c); ALL_ELS.push(c); return c; },
    querySelector(sel) { if (!memo.has(sel)) memo.set(sel, makeEl()); return memo.get(sel); },
    querySelectorAll() { return []; },
    focus() {},
    remove() { if (el.parent) { const i = el.parent.children.indexOf(el); if (i >= 0) el.parent.children.splice(i, 1); } },
  };
  return el;
}
let ALL_ELS = [];
function freshDom() {
  ALL_ELS = [];
  const body = makeEl('body');
  return {
    body,
    createElement: (t) => makeEl(t),
    querySelector(sel) {
      for (const e of ALL_ELS) {
        if (sel.startsWith('.') && e.classList.contains(sel.slice(1))) return e;
        if (sel.startsWith('#') && e.id === sel.slice(1)) return e;
      }
      return null;
    },
    getElementById: () => null,
    addEventListener: () => {},
    hidden: false,
  };
}
const walkByClass = (c) => ALL_ELS.find((e) => e.classList.contains(c)) || null;

// ---------- 场景桩 ----------
function makeStubs({ native }) {
  const LS = makeLS();
  const dom = freshDom();
  const nativeStore = { timer: '' }; // SharedPreferences KEY_TIMER 模拟
  const pluginCalls = [];
  const mockPlugin = {
    setTimerState({ json }) { pluginCalls.push(['setTimerState', json]); nativeStore.timer = json; return Promise.resolve({ ok: true }); },
    async getTimerState() { pluginCalls.push(['getTimerState']); return { json: nativeStore.timer }; },
  };
  const Capacitor = { isNativePlatform: () => native, registerPlugin: () => mockPlugin };
  const notifCalls = [];
  const env = {};
  const Notifications = {
    isNative: () => native,
    requestPermission: async () => {},
    schedule: async (o) => { notifCalls.push(['schedule', o]); },
    cancel: async (id) => { notifCalls.push(['cancel', id]); },
    onReceived(cb) { env.receivedCb = cb; },
  };
  const System = {
    keepAwake: () => {}, vibrate: () => {}, success: () => {},
    onResume(cb) { env.resumeCb = cb; },
  };
  const toasts = [];
  const toast = (msg) => toasts.push(msg);
  const engineCalls = { create: 0, start: 0, quickComplete: 0 };
  const App = {
    refresh: () => {},
    db: { resources: [{ id: 'r1', name: '时间' }], activities: [] },
    engine: {
      createActivity(db, o) { engineCalls.create++; db.activities.push({ id: 'a' + engineCalls.create, ...o }); return { ok: true }; },
      startActivity() { engineCalls.start++; return { ok: true }; },
      quickComplete() { engineCalls.quickComplete++; return { ok: true }; },
    },
  };
  return { Capacitor, Notifications, System, toast, App, document: dom, localStorage: LS, Date: FakeDate, LS, dom, nativeStore, pluginCalls, notifCalls, toasts, engineCalls, env, TKEY: 'personal_erp_timer' };

  function makeLS() {
    const m = new Map();
    return {
      getItem: (k) => (m.has(k) ? m.get(k) : null),
      setItem: (k, v) => m.set(k, String(v)),
      removeItem: (k) => m.delete(k),
    };
  }
}

function instantiate(stubs) {
  const factory = new Function(
    'Capacitor', 'Notifications', 'System', 'toast',
    'App', 'document', 'localStorage', 'Date', 'setInterval', 'clearInterval',
    code,
  );
  return factory(
    stubs.Capacitor, stubs.Notifications, stubs.System, stubs.toast,
    stubs.App, stubs.document, stubs.localStorage, stubs.Date,
    () => 0, () => {}, // 不产生真实定时器
  );
}

const results = [];
function report(id, ok, detail) {
  results.push({ id, verdict: ok ? 'CONFIRMED' : 'NOT-REPRODUCED', detail });
  console.log(`[${ok ? '✔' : '✘'}] ${id}: ${detail}`);
}

// ================= P0 (C7): close() 先于 build() =================
{
  timeOffset = 0;
  const s = makeStubs({ native: false });
  const api = instantiate(s);
  let threw = null;
  try { api.close(); } catch (e) { threw = e; }
  report('P0/close-before-build-el-unguarded',
    !!(threw && /classList/i.test(threw.message)),
    threw ? `${threw.message} @ timer.js:152（export 的 close() 对 el 无空守卫；当前仓库无外部调用者，潜在契约风险）`
          : 'no throw');
}

// ================= P1 (C1/C3): 本地丢失 + 原生完好 → 快路径抹掉原生备份 =================
{
  timeOffset = 0;
  const s = makeStubs({ native: true });
  const api = instantiate(s);
  const endTs = Date.now() + 10 * 60e3;
  s.nativeStore.timer = JSON.stringify({
    target: null, sec: 1500, sessionStart: Date.now() - 5 * 60e3,
    mode: 'run', endTs, remainingMs: null, ts: Date.now(),
  });
  api.restore();               // main.js:220 同步先跑（TKEY 缺失 → 走 clearState 分支）
  const wiped = s.nativeStore.timer === '';
  await api.restoreNative();   // main.js:221 异步兜底
  const deadFallback = !s.env.resumeCb && s.pluginCalls.some(([m]) => m === 'getTimerState');
  report('P1/native-backup-wiped-by-fastpath', wiped && deadFallback,
    `restore() 未命中本地即把原生 KEY_TIMER 清空=${wiped}; restoreNative() 随后读到空串放弃恢复=${deadFallback}. 完好的运行中计时器备份被自毁（双写恢复在目标场景失效）`);
}

// ================= P2 (C4+C5): 二次入账 + overlay 幽灵驻留 =================
{
  timeOffset = 0;
  const s = makeStubs({ native: false });
  const api = instantiate(s);
  api.open();                                  // build + show（ensureListeners 注册 onResume）
  const overlay = s.dom.body.children[0];
  const sel = (k) => overlay.querySelector(k);
  sel('[data-go]').onclick();                  // 开始计时
  timeOffset += 30 * 60e3;                     // 后台节流模拟：interval tick 全部未触发
  s.env.resumeCb();                            // 回前台校正路径 → 到期 stop+finish
  sel('[data-record]').onclick();              // 第一次「记录并闭环」
  const firstCount = s.engineCalls.quickComplete;
  const tkeyAfterFirst = s.LS.getItem(s.TKEY);
  api.open();                                  // 用户重开计时器（完成面板重现）
  sel('[data-record]').onclick();              // 再次点击记录
  const doubleBilled = s.engineCalls.quickComplete >= 2;
  let zombie = null;
  try { zombie = tkeyAfterFirst ? JSON.parse(tkeyAfterFirst) : null; } catch {}
  api.close();
  const ghost = walkByClass('timer-overlay') !== null;
  report('P2a/double-billing-on-reopen', doubleBilled,
    `quickComplete 次数=${s.engineCalls.quickComplete}（首次=${firstCount}）; record() 无 finished 守卫且不 abortSession/clearState @ timer.js:332-372`);
  report('P2b/timer-state-zombie-persistence', !!zombie,
    `记账完成后 localStorage[${s.TKEY}] 仍残留 → 重启后 restore() 再次呈现完成面板，可无限重复入账`);
  report('P2c/overlay-ghost-blocks-autopilot', ghost,
    `close() 后 document.querySelector('.timer-overlay') 仍命中=${ghost} → autoPilot.js:77 每轮巡检 early-return（本会话 F1/F2/F3/F4 全部静默）`);
}

console.log('\n---- probe summary ----');
for (const r of results) console.log(`${r.verdict.padEnd(15)} ${r.id}`);
console.log('\n(report-only probe; no source files modified)');
