# 一期：卡片即对象交互语言 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 活动卡与资源卡改为「卡片即对象」交互（单击=状态主动词、右滑推进、左滑改约、长按=超集菜单），关键节点触觉反馈，修复产出链等 4 处流程断裂。

**Architecture:** 新增纯函数手势判定核心 + DOM 绑定层（ui/gestures.js）；视图层沿用现有「HTML 字符串渲染 + 渲染后绑定」模式；长按菜单复用现有 `.act-menu` 样式；触觉经 @capacitor/haptics（web 端无操作降级）。

**Tech Stack:** 原生 JS ESM / Vite 6 / Node 内置 test runner / @capacitor/haptics（已在 package.json）

## Global Constraints

- 测试底线：`npm test` 现有 53 条全绿，只增不减（每任务结束必须全绿）
- 可达性宪法：被移除的按钮功能必须迁入长按菜单；危险操作（删除）永不绑手势且保留 confirm
- 备份契约不变：不向 db 八集合加字段；新偏好只进 Prefs
- 同一文件多处修改：串行逐个确认落盘（项目纪律 #3）
- 打包三步曲验证：`npm run build` → `npx cap sync android` → `cd android && gradlew assembleRelease`
- 界面文案一律中文；性能纪律只动 transform/opacity

## 与 spec 的偏差声明（已论证）

spec 第一层的「双击=计时」取消：单击已绑定状态动词，双击检测要么延迟单击 250ms（违反响应性）要么动词双触发。计时可达性不受损——🍅按钮保留原位 + 长按菜单含「计时」。此为减法决策，非删功能。

---

### Task 1: 手势工具层 ui/gestures.js（纯函数核心 TDD）

**Files:**
- Create: `src/ui/gestures.js`
- Test: `tests/gestures.test.js`

**Interfaces:**
- Produces: `resolveGesture({dx,dy,durMs,longFired}, opts?) → 'tap'|'long'|'right'|'left'|null`；`attachCard(el, handlers, opts?) → detach()`，handlers=`{onTap,onLongPress,onSwipeRight,onSwipeLeft}`，回调签名 `(x,y)` 为触点坐标。

- [ ] **Step 1: 写失败测试**

```js
// tests/gestures.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveGesture } from '../src/ui/gestures.js';

test('小位移短按 → tap', () => {
  assert.equal(resolveGesture({ dx: 3, dy: 2, durMs: 80 }), 'tap');
});
test('长按未移动 → long', () => {
  assert.equal(resolveGesture({ dx: 0, dy: 0, durMs: 900, longFired: true }), 'long');
});
test('横移超阈值 → right/left', () => {
  assert.equal(resolveGesture({ dx: 80, dy: 5, durMs: 200 }), 'right');
  assert.equal(resolveGesture({ dx: -80, dy: 5, durMs: 200 }), 'left');
});
test('纵滑不产生手势（留给页面滚动）', () => {
  assert.equal(resolveGesture({ dx: 5, dy: 90, durMs: 200 }), null);
});
test('位移不足阈值 → tap 兜底', () => {
  assert.equal(resolveGesture({ dx: 30, dy: 4, durMs: 150 }), 'tap');
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test tests/gestures.test.js`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 gestures.js**

```js
// ============================================================
// ui/gestures.js
// 卡片手势工具层：纯函数判定核心（可单测）+ DOM 绑定。
// 安全边界：方向锁 12px、滑动触发阈值 64px、长按 500ms；
// 纵向滑动永远返回 null（不抢页面滚动）。
// ============================================================

const MOVE_LOCK = 12;   // 方向锁：超过此位移锁定轴向
const SWIPE_DIST = 64;  // 滑动触发距离
const LONG_MS = 500;    // 长按时长

export function resolveGesture({ dx, dy, durMs, longFired = false }, opts = {}) {
  const swipeDist = opts.swipeDist ?? SWIPE_DIST;
  const dist = Math.abs(dx);
  const vdist = Math.abs(dy);
  // 长按优先：计时器已触发且基本没挪动
  if (longFired && Math.hypot(dx, dy) < MOVE_LOCK) return 'long';
  // 轴向已锁横且距离够 → 滑动
  if (dist > vdist && dist >= swipeDist) return dx > 0 ? 'right' : 'left';
  // 未构成滑动的小动作按点击处理（长按由计时器负责，此处 dur 仅参考）
  if (Math.hypot(dx, dy) < MOVE_LOCK * 2) return 'tap';
  return null;
}

export function attachCard(el, handlers, opts = {}) {
  let sx = 0, sy = 0, st = 0, locked = false, longTimer = null, longFired = false, active = false;

  const clearLong = () => { if (longTimer) { clearTimeout(longTimer); longTimer = null; } };
  const fire = (g, x, y) => {
    if (g === 'tap' && handlers.onTap) handlers.onTap(x, y);
    else if (g === 'long' && handlers.onLongPress) handlers.onLongPress(x, y);
    else if (g === 'right' && handlers.onSwipeRight) handlers.onSwipeRight(x, y);
    else if (g === 'left' && handlers.onSwipeLeft) handlers.onSwipeLeft(x, y);
  };

  const onStart = (e) => {
    const t = e.touches[0];
    sx = t.clientX; sy = t.clientY; st = Date.now();
    active = true; locked = false; longFired = false;
    clearLong();
    longTimer = setTimeout(() => {
      if (!active) return;
      longFired = true;
      fire('long', sx, sy);
    }, opts.longMs ?? LONG_MS);
  };
  const onMove = (e) => {
    if (!active || locked) return;
    const t = e.touches[0];
    const dx = t.clientX - sx, dy = t.clientY - sy;
    if (Math.hypot(dx, dy) > MOVE_LOCK) {
      locked = true;          // 轴向锁定后取消长按意图
      clearLong();
      // 右滑跟手预览：露出底层 ✓ 层（CSS 类由调用方样式定义）
      if (handlers.onSwipePreview && dx > 0 && Math.abs(dx) > Math.abs(dy)) {
        handlers.onSwipePreview(Math.min(dx, SWIPE_DIST));
      }
    }
  };
  const onEnd = (e) => {
    if (!active) return;
    active = false; clearLong();
    const t = e.changedTouches[0];
    const g = resolveGesture({
      dx: t.clientX - sx, dy: t.clientY - sy,
      durMs: Date.now() - st, longFired,
    }, opts);
    if (handlers.onSwipePreviewEnd) handlers.onSwipePreviewEnd();
    if (g) fire(g, t.clientX, t.clientY);
  };

  el.addEventListener('touchstart', onStart, { passive: true });
  el.addEventListener('touchmove', onMove, { passive: true });
  el.addEventListener('touchend', onEnd);
  el.addEventListener('touchcancel', () => { active = false; clearLong(); });
  // 返回解绑函数（测试/重渲染时用）
  return () => {
    el.removeEventListener('touchstart', onStart);
    el.removeEventListener('touchmove', onMove);
    el.removeEventListener('touchend', onEnd);
    clearLong();
  };
}
```

- [ ] **Step 4: 运行测试通过**

Run: `node --test tests/gestures.test.js && npm test`
Expected: 全部 PASS（含既有 53 条）

- [ ] **Step 5: Commit**

```bash
git add src/ui/gestures.js tests/gestures.test.js
git commit -m "feat: 手势工具层（方向锁/阈值/长按纯函数核心+DOM绑定）"
```

---

### Task 2: 触觉与余额动画原语（helpers.js）

**Files:**
- Modify: `src/ui/helpers.js`（文件末尾追加导出）
- Modify: `src/css/app.css`（末尾追加动画类）

**Interfaces:**
- Consumes: `@capacitor/haptics`（package.json 已有依赖）
- Produces: `haptic(kind?: 'light'|'success') → Promise<void>`（web 端静默）；`animateBalance(resourceId: string, fromVal: number, toVal: number) → void`

- [ ] **Step 1: helpers.js 追加实现**

```js
// ---- 触觉反馈（仅关键节点调用；web 端 Capacitor 无操作，天然降级）----
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';
export async function haptic(kind = 'light') {
  try {
    if (kind === 'success') await Haptics.notification({ type: NotificationType.Success });
    else await Haptics.impact({ style: kind === 'heavy' ? ImpactStyle.Heavy : ImpactStyle.Light });
  } catch (e) { /* 不支持的平台静默 */ }
}

// ---- 余额数字滚动变色（账本心跳）----
export function animateBalance(resourceId, fromVal, toVal, digits = 0) {
  const el = document.querySelector(`[data-res-balance="${resourceId}"]`);
  if (!el) return;
  el.classList.add(toVal >= fromVal ? 'bal-up' : 'bal-down');
  const t0 = performance.now(), dur = 400;
  const tick = (t) => {
    const p = Math.min(1, (t - t0) / dur);
    const eased = 1 - Math.pow(1 - p, 3); // ease-out
    el.firstChild.nodeValue = fmtNum(fromVal + (toVal - fromVal) * eased, digits);
    if (p < 1) requestAnimationFrame(tick);
    else setTimeout(() => el.classList.remove('bal-up', 'bal-down'), 600);
  };
  requestAnimationFrame(tick);
}
```

注意：若 `helpers.js` 顶部已有其他 import，把两行 capacitor import 合并到 import 区，不要在文件中部出现 import（ESM 允许但风格统一）。

- [ ] **Step 2: app.css 追加**

```css
/* ---------------- 余额滚动反馈 ---------------- */
.res-balance { transition: color .25s; }
.res-balance.bal-up { color: var(--green); }
.res-balance.bal-down { color: var(--red); }
@media (prefers-reduced-motion: reduce) {
  .res-balance { transition: none; }
}
```

- [ ] **Step 3: 验证**

Run: `npm run build`
Expected: 构建成功（@capacitor/haptics 能被 Vite 打包）

- [ ] **Step 4: Commit**

```bash
git add src/ui/helpers.js src/css/app.css
git commit -m "feat: haptic 反馈原语与余额滚动动画"
```

---

### Task 3: 活动卡五态进度轨 + 状态主动词入口

**Files:**
- Modify: `src/views/overview.js`（activityCard 函数，约 :698-732）
- Modify: `src/css/app.css`（进度轨样式）

**Interfaces:**
- Consumes: 无新依赖
- Produces: `App.actVerb(id)`（挂到 main.js 的 App 上，Task 5 实现）；卡片根元素新增 class `kc-rail` 子元素供 Task 4 的手势绑定定位

- [ ] **Step 1: activityCard() 卡片头部加入五态轨**

在 `kc-head` 之前插入（保留原有全部内容）：

```js
const STATES = ['Planned', 'Started', 'Completed', 'Reviewed', 'Archived'];
const railIdx = STATES.indexOf(a.status);
```

模板中 `${th ? ...}` 行之前加：

```html
<div class="kc-rail" aria-hidden="true">${STATES.map((s, i) =>
  `<i class="${i < railIdx ? 'done' : i === railIdx ? 'on' : ''}"></i>`).join('')}</div>
```

- [ ] **Step 2: app.css 追加进度轨样式**

```css
/* 五态进度轨：形态即启示——显示位置并暗示可推进 */
.kc-rail { display: flex; gap: 4px; margin-bottom: 8px; }
.kc-rail i { height: 3px; flex: 1; border-radius: 2px; background: #e8ecf2; }
.kc-rail i.done { background: #b9c4d4; }
.kc-rail i.on { background: var(--ink); }
.kanban-card.tone-light .kc-rail i { background: rgba(255,255,255,.25); }
.kanban-card.tone-light .kc-rail i.on { background: #fff; }
```

- [ ] **Step 3: 移除底部状态按钮排（先迁入 Task 4 菜单前的过渡：本任务仅删除 `${stateActions}` 行，stateActions 定义暂留）**

overview.js:723 删除 `${stateActions}` 一行。此时按钮消失而菜单未建——**本任务不单独提交**，与 Task 4 合并提交以保证可达性宪法（中间态不可发布）。

- [ ] **Step 4: Commit（与 Task 4 合并）**

---

### Task 4: 活动卡手势绑定 + 长按超集菜单

**Files:**
- Modify: `src/views/overview.js`（activityCard 尾部、render 末尾、新增导出）
- Modify: `src/main.js`（App.actVerb）

**Interfaces:**
- Consumes: Task 1 `attachCard`；现有 `toggleActMenu/closeActMenus/.act-menu`
- Produces: `App.actVerb(id: string)`；`overview.bindCards()`（渲染后绑定）；`overview.openRescheduleModal(id)`（Task 6 实现，本任务先占位引用）

- [ ] **Step 1: activityCard() 改造动作区**

删除 `<div class="kc-actions">…</div>` 整块（含🍅按钮、stateActions、⋯按钮），替换为：

```html
<div class="kc-actions">
  <button class="btn sm timer-btn" onclick="event.stopPropagation();App.timer.openForActivity('${jsStr(a.id)}')">🍅 计时</button>
  <div class="act-menu-wrap">
    <button class="btn sm" title="更多操作" onclick="event.stopPropagation();App.overview.toggleActMenu('${jsStr(a.id)}')">⋯</button>
    <div class="act-menu hidden" id="am-${esc(a.id)}">
      ${verbMenuItem(a)}
      <button onclick="App.timer.openForActivity('${jsStr(a.id)}')">计时</button>
      <button onclick="App.overview.editActivityCard('${jsStr(a.id)}')">编辑</button>
      <button onclick="App.overview.openRescheduleModal('${jsStr(a.id)}')">改期</button>
      <button class="danger" onclick="App.overview.delAct('${jsStr(a.id)}')">删除</button>
    </div>
  </div>
</div>
```

新增局部函数（stateActions 定义旁）：

```js
const VERBS = {
  Planned: { label: '开始', fn: "App.startAct('${id}')", disabledIfBlocked: true },
  Started: { label: '完成', fn: "App.overview.openCompleteModal('${id}')", disabledIfBlocked: true },
  Completed: { label: '复盘', fn: "App.engine.setActivityStatus(App.db,'${id}','Reviewed');App.refresh()" },
  Reviewed: { label: '归档', fn: "App.engine.setActivityStatus(App.db,'${id}','Archived');App.refresh()" },
};
function verbMenuItem(a) {
  const v = VERBS[a.status];
  if (!v) return '';
  const fn = v.fn.replace('${id}', jsStr(a.id));
  return `<button onclick="event.stopPropagation();${fn}" ${blocked && v.disabledIfBlocked ? 'disabled' : ''}>${v.label}</button>`;
}
```

同时卡片根元素 `onclick` 由 `editActivityCard` 改为 `return false`（点击交给手势层）：删除根元素 onclick 属性。

- [ ] **Step 2: 渲染后绑定手势（overview.js 的 render 函数末尾、innerHTML 之后）**

```js
import { attachCard } from '../ui/gestures.js'; // 文件头

export function bindCards(root) {
  root.querySelectorAll('.kanban-card[data-id]').forEach((el) => {
    const id = el.dataset.id;
    attachCard(el, {
      onTap: () => App.startActOrVerb(id),
      onSwipeRight: () => App.startActOrVerb(id),
      onSwipeLeft: () => App.overview.openRescheduleModal(id),
      onLongPress: () => App.overview.toggleActMenu(id),
    });
  });
}
```

render 中调用：`bindCards(content);`

- [ ] **Step 3: main.js 增加 App.actVerb（状态主动词统一入口）**

```js
// 卡片主动词：状态决定下一步（可达性宪法：长按菜单含同名兜底项）
actVerb(id) {
  const a = this.db.activities.find((x) => x.id === id);
  if (!a) return;
  if (a.status === 'Planned') return this.startAct(id);
  if (a.status === 'Started') return this.overview.openCompleteModal(id);
  const next = { Completed: 'Reviewed', Reviewed: 'Archived' }[a.status];
  if (!next) return;
  const r = this.engine.setActivityStatus(this.db, id, next);
  if (r.ok) { haptic('light'); this.refresh(); }
},
```

main.js 文件头 import 处加 `haptic`（来自 './ui/helpers.js'，该行已有 openModal,toast,esc 导入，合并）。注意 Step 2 里 `App.startActOrVerb` 统一改为 `App.actVerb`。

- [ ] **Step 4: 验证 + 合并提交**

Run: `node --check src/views/overview.js && node --check src/main.js && npm run build`
手工冒烟（dev 页面触摸模拟）：单击 Planned 卡弹仲裁或开始；长按弹菜单五项齐全；🍅按钮可用。

```bash
git add src/views/overview.js src/main.js src/css/app.css
git commit -m "feat: 活动卡一卡一动词（五态轨+单击主动词+右滑推进+左滑改约占位+长按超集菜单）"
```

---

### Task 4b: 资源卡长按超集菜单

**Files:**
- Modify: `src/views/overview.js`（resourceCard 函数约 :148-171、render 末尾）

**Interfaces:**
- Consumes: Task 1 `attachCard`；现有 `openResModal/openAdjustModal/delResource/setResourceStatus`
- Produces: 资源卡单击补充不变；卡内 3 小按钮（编辑/停用/删除）迁入长按菜单；`data-res-balance` 属性（供 Task 2 animateBalance 定位）

- [ ] **Step 1: resourceCard() 改造**

余额数字 span 加定位属性：

```html
<div class="res-balance ${danger ? 'neg' : ''}" data-res-balance="${esc(r.id)}">
```

删除卡内按钮排 `<div class="row-gap" onclick="event.stopPropagation()">…</div>` 整块，卡片根元素保持 `onclick="App.overview.openAdjustModal('${jsStr(r.id)}')"` 不变（单击补充是主动词）。

- [ ] **Step 2: render 末尾绑定资源卡手势**

```js
root.querySelectorAll('.res-card').forEach((el, i) => {
  const r = db.resources[i];
  if (!r) return;
  attachCard(el, {
    onLongPress: () => App.overview.openResMenu(r.id, el),
  });
  // 单击走原有 onclick；tap 手势不绑，避免与 onclick 双触发
});
```

新增导出（复用 .act-menu 样式，动态定位到卡片上方）：

```js
export function openResMenu(id, anchorEl) {
  closeMenus();
  const r = App.db.resources.find((x) => x.id === id);
  if (!r) return;
  const menu = document.createElement('div');
  menu.className = 'act-menu';
  menu.style.position = 'fixed';
  const rect = anchorEl.getBoundingClientRect();
  menu.style.left = Math.min(rect.left + rect.width - 110, window.innerWidth - 120) + 'px';
  menu.style.top = (rect.top - 8) + 'px';
  menu.style.transform = 'translateY(-100%)';
  menu.innerHTML = `
    <button onclick="App.overview.openResModal('${jsStr(id)}');App.overview.closeMenus()">编辑</button>
    <button onclick="App.engine.setResourceStatus(App.db,'${jsStr(id)}','${r.status === 'Active' ? 'Inactive' : 'Active'}');App.overview.closeMenus();App.refresh()">${r.status === 'Active' ? '停用' : '启用'}</button>
    <button class="danger" onclick="App.overview.closeMenus();App.overview.delResource('${jsStr(id)}')">删除</button>`;
  document.body.appendChild(menu);
}
export function closeMenus() {
  document.querySelectorAll('body > .act-menu').forEach((m) => m.remove());
  document.querySelectorAll('.act-menu:not(.hidden)').forEach((m) => m.classList.add('hidden'));
}
```

（若 overview.js 已有全局点击关闭逻辑 closeActMenus，把 `body > .act-menu` 的清理并入其中而非新增并行函数。）

- [ ] **Step 3: 验证 + 提交**

Run: `node --check src/views/overview.js && npm run build`

```bash
git add src/views/overview.js
git commit -m "feat: 资源卡长按菜单（编辑/停用/删除收容），单击补充不变"
```

---

### Task 5: 左滑改约面板 openRescheduleModal

**Files:**
- Modify: `src/views/overview.js`（新导出函数）

**Interfaces:**
- Consumes: `engine.updateActivity`（已存在，支持 planned_start 更新与自动顺延）
- Produces: `overview.openRescheduleModal(id: string)`

- [ ] **Step 1: 实现**

```js
// 左滑改约：快捷偏移 + 自定义时刻（引擎侧仍走原子性顺延）
export function openRescheduleModal(id) {
  const a = App.db.activities.find((x) => x.id === id);
  if (!a || !a.planned_start) return toast('该活动无固定开始时间，可直接编辑设置', 'info');
  const base = new Date(a.planned_start.replace('T', ' ').replace(/-(\d)-/, '-0$1-0').replace(/-(\d)T/, '-0$1T'));
  if (isNaN(base.getTime())) return toast('时间格式异常', 'err');
  const shift = (mins) => new Date(base.getTime() + mins * 60000);
  const fmt = (d) => {
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
  };
  const m = openModal({
    title: `改期 · ${a.title}`,
    bodyHTML: `
      <div class="row-gap" style="justify-content:center">
        ${[['+15分钟', 15], ['+1小时', 60], ['明天同一时刻', 1440]].map(([l, v]) =>
          `<button class="btn" data-shift="${v}">${l}</button>`).join('')}
      </div>
      <div class="field" style="margin-top:12px"><label>或指定时刻</label>
        <input id="f-rs-time" type="datetime-local"></div>`,
    footerHTML: `<button class="btn" data-cancel>关闭</button>`,
  });
  const apply = (dt) => {
    const r = App.engine.updateActivity(App.db, id, { planned_start: fmt(dt) });
    m.close();
    if (!r.ok) return toast(r.error, 'err');
    haptic('light');
    toast(r.shifted ? `⏩ 目标时段冲突，已顺延至 ${(r.to || '').replace('T', ' ')}` : '已改期', 'ok');
    App.refresh();
  };
  m.qa('[data-shift]').forEach((b) => { b.onclick = () => apply(shift(Number(b.dataset.shift))); });
  m.q('[data-cancel]').onclick = () => m.close();
  m.q('#f-rs-time').addEventListener('change', (e) => {
    const d = new Date(e.target.value);
    if (!isNaN(d.getTime())) apply(d);
  });
}
```

注意：`updateActivity` 若不接受部分字段更新需先读其实现确认（engine.js:571 起）；如它要求完整 payload，则先展开 `const patch = { ...a, planned_start: fmt(dt) }` 再传入允许字段。

- [ ] **Step 2: 验证 + 提交**

Run: `node --check src/views/overview.js && npm test && npm run build`

```bash
git add src/views/overview.js
git commit -m "feat: 活动卡左滑改约面板（快捷偏移+自定义时刻）"
```

---

### Task 6: 断裂修复#1 —— 完成后的产出接续浮层

**Files:**
- Modify: `src/views/overview.js`（openCompleteModal 的保存成功分支，约 :549-571 区域之后）

**Interfaces:**
- Consumes: `engine.setOutputStatus`（Draft→Published→Archived，Archived 自动生成 ValueFlow）
- Produces: 两拍浮层：发布确认 → 归档确认

- [ ] **Step 1: 保存成功后弹出接续浮层**

找到 openCompleteModal 保存成功处（toast 之后、close 之前的位置语义），改为：

```js
// 断裂修复：完成 ≠ 结束，接续产出链（Draft → Published → Archived→价值流）
const drafts = App.db.outputs.filter((o) => o.activity_id === a?.id && o.status === 'Draft');
if (drafts.length) {
  showOutputFollowup(drafts[0]);
}
```

新增导出：

```js
function showOutputFollowup(o) {
  const m = openModal({
    title: '产出已诞生 📄',
    accent: 'info',
    bodyHTML: `<p>「${esc(o.title)}」目前是草稿。发布后才能进入价值流被世界回响。</p>`,
    footerHTML: `<button class="btn" data-later>留在草稿</button><button class="btn primary" data-publish>立即发布</button>`,
  });
  m.q('[data-later]').onclick = () => m.close();
  m.q('[data-publish]').onclick = () => {
    const r = App.engine.setOutputStatus(App.db, o.id, 'Published');
    m.close();
    if (!r.ok) return toast(r.error, 'err');
    haptic('success'); App.refresh();
    const m2 = openModal({
      title: '下一步：归档生成价值流',
      accent: 'ok',
      bodyHTML: `<p>归档「${esc(o.title)}」会自动生成一条价值流，等待反馈与回充。</p>`,
      footerHTML: `<button class="btn" data-later2>稍后</button><button class="btn primary" data-arch>归档</button>`,
    });
    m2.q('[data-later2]').onclick = () => m2.close();
    m2.q('[data-arch]').onclick = () => {
      const rr = App.engine.setOutputStatus(App.db, o.id, 'Archived');
      m2.close();
      if (!rr.ok) return toast(rr.error, 'err');
      haptic('success'); App.refresh();
      toast('价值流已创建，可在活动页查看', 'ok');
    };
  };
}
```

（实施者注：openCompleteModal 内部变量名以实际代码为准，核心是拿到刚完成的 activity id 并查其 Draft 产出。）

- [ ] **Step 2: 验证 + 提交**

Run: `node --check src/views/overview.js && npm run build`

```bash
git add src/views/overview.js
git commit -m "feat: 完成活动后产出链接续浮层（发布→归档两拍）"
```

---

### Task 7: 断裂修复#3 —— Done 列计数 chip 与批量推进

**Files:**
- Modify: `src/views/overview.js`（看板列头渲染处）

**Interfaces:**
- Consumes: `engine.setActivityStatus`
- Produces: Done 列头「n 条待处理」chip；点开批量菜单「全部复盘」「全部归档」

- [ ] **Step 1: 列头渲染处加计数**

在看板列头（kanban-head 的 cnt 计数旁）对 Done 列追加：

```js
const donePending = db.activities.filter((a) => a.status === 'Completed' || a.status === 'Reviewed').length;
```

Done 列 head 内：

```html
${donePending ? `<button class="badge b-blue" onclick="event.stopPropagation();App.overview.batchAdvance()">${donePending} 条待处理</button>` : ''}
```

- [ ] **Step 2: 批量推进函数**

```js
// 批量推进 Done 列：Completed→Reviewed→Archived 各一键到底
export function batchAdvance() {
  const m = openModal({
    title: '批量推进',
    bodyHTML: '<p class="muted">把已完成的任务推完闭环。</p>',
    footerHTML: `
      <button class="btn" data-cancel>取消</button>
      <button class="btn" data-review>全部复盘</button>
      <button class="btn primary" data-arch>全部归档</button>`,
  });
  m.q('[data-cancel]').onclick = () => m.close();
  const bulk = (from, to) => () => {
    let n = 0;
    for (const a of App.db.activities.filter((x) => x.status === from)) {
      if (App.engine.setActivityStatus(App.db, a.id, to).ok) n++;
    }
    m.close(); haptic('success'); App.refresh();
    toast(`已推进 ${n} 条`, 'ok');
  };
  m.q('[data-review]').onclick = bulk('Completed', 'Reviewed');
  m.q('[data-arch]').onclick = bulk('Reviewed', 'Archived');
}
```

- [ ] **Step 3: 验证 + 提交**

Run: `node --check src/views/overview.js && npm test && npm run build`

```bash
git add src/views/overview.js
git commit -m "feat: Done列待处理计数与批量复盘/归档"
```

---

### Task 8: 断裂修复#4 —— 冻结出路「调整预算」直达

**Files:**
- Modify: `src/views/overview.js`（activityCard 的 blocked 提示行，约 :714）
- Modify: `src/main.js` 或相应系统反馈卡渲染处（搜索「预算」文案所在反馈卡）

**Interfaces:**
- Consumes: `goals.openPlanModal(goalId, planId)`（goals.js 已有，签名以实际为准）
- Produces: blocked 卡与反馈卡上的直达按钮

- [ ] **Step 1: activityCard 的 blocked 行改造**

```js
${blocked ? `<div class="kc-meta warn">⛔ 关联计划预算已耗尽
  <button class="btn sm" onclick="event.stopPropagation();App.goals.openPlanModal(${planIdLiteral},'${jsStr(blockingPlanId)}')">调整预算</button></div>` : ''}
```

其中 `blockingPlanId` 取 `a.plan_ids.find((pid) => engine.isPlanBlocked(db, pid))`，`planIdLiteral` 为该计划所属 goal_id（从 `db.plans.find(p=>p.id===blockingPlanId)` 取 goal_id；openPlanModal 实际签名以 goals.js 为准，若为 `(goalId, planId)` 则照传）。

- [ ] **Step 2: 系统反馈卡同样追加同款按钮**（定位：overview.js 中渲染冻结条目的位置，grep「预算已耗尽」）

- [ ] **Step 3: 验证 + 提交**

Run: `node --check src/views/overview.js && npm run build`

```bash
git add src/views/overview.js
git commit -m "feat: 预算冻结卡直达调整预算入口"
```

---

### Task 9: 断裂修复#5 —— 仲裁「让对方先」后跳转改约结果

**Files:**
- Modify: `src/calendar.js` 对应文件 `src/views/calendar.js`（新导出）
- Modify: `src/main.js`（startAct 的 defer 分支）

**Interfaces:**
- Consumes: calendar 模块的选中日状态（实施者先读 calendar.js 找到 selected/calSelected 存储形式）
- Produces: `calendar.focusDate(key: string)`（key 格式 `YYYY-M-D` 非补零）；defer 后的确认弹层带「查看日程」按钮

- [ ] **Step 1: calendar.js 增加焦点函数**

读 calendar.js 找到选中日变量（形如 `let selKey` 或存于模块级），追加：

```js
// 外部聚焦某个日期（仲裁改约后跳转用）：设置选中并确保概览页可见
export function focusDate(key) {
  selKey = key; // 以实际变量名为准
  if (window.App && window.App.tab !== 'overview') window.App.setTab('overview');
}
```

并在其 render 中确认选中态会因 selKey 生效（现有选中逻辑通常已如此）。

- [ ] **Step 2: main.js defer 分支改造**

将 `toast(\`已改约至 ...\`, 'ok')` 替换为：

```js
const moved = rr.moved_to || '';
const mm = openModal({
  title: '已让对方先行',
  bodyHTML: `<p>你的活动已改约至 <b>${esc(String(moved).replace('T', ' '))}</b>。</p>`,
  footerHTML: `<button class="btn" data-ok>知道了</button><button class="btn primary" data-see>查看日程</button>`,
});
mm.q('[data-ok]').onclick = () => mm.close();
mm.q('[data-see]').onclick = () => {
  mm.close();
  const dk = String(moved).slice(0, 10).replace(/-0+(\d)/g, '-$1'); // 补零转非补零 key
  calendar.focusDate(dk);
};
this.refresh();
```

- [ ] **Step 3: 验证 + 提交**

Run: `node --check src/views/calendar.js src/main.js && npm run build`

```bash
git add src/views/calendar.js src/main.js
git commit -m "feat: 仲裁改约后可跳转查看新日程"
```

---

### Task 10: timer.record 收编进引擎

**Files:**
- Modify: `src/domain/engine.js`（新增 quickComplete）
- Modify: `src/views/timer.js`（record 函数约 :332-377，去除直写路径）
- Test: `tests/domain.test.js`

**Interfaces:**
- Produces: `engine.quickComplete(db, activityId, { expense?, income?, outputTitle? }) → {ok, error?}`，记账语义等同 completeActivity（不变量2 保证）

- [ ] **Step 1: 写失败测试**

```js
test('quickComplete：快速计时收编路径同样满足不变量2', () => {
  const db = freshDB();
  E.createActivity(db, { title: '通用计时', note: '', plan_ids: [] });
  E.startActivity(db, db.activities[0].id);
  const r = E.quickComplete(db, db.activities[0].id, { expense: { resource_id: 'r1', amount: 5 } , outputTitle: '专注段' });
  assert.equal(r.ok, true);
  assert.equal(db.activities[0].status, 'Completed');
  assert.ok(db.outputs.some((o) => o.title === '专注段'));
});
```

- [ ] **Step 2: 运行失败** `node --test tests/domain.test.js` → quickComplete 未定义

- [ ] **Step 3: engine.js 实现**

```js
// 快速完成（通用计时通道专用）：与 completeActivity 相同的入账契约，
// 产出标签固定标记来源，消除 UI 直写 db 的唯一旁路
export function quickComplete(db, activityId, { expense, income, outputTitle } = {}) {
  return completeActivity(db, activityId, {
    expense: expense || null,
    income: income || null,
    output_title: outputTitle || '快速计时',
    output_tags: ['快速计时'],
  });
}
```

- [ ] **Step 4: timer.record 改调引擎**

读 timer.js record() 实现，将其中的 `db.txs.push(...)` / outputs 构造 / seq 手工递增整段替换为：

```js
const r = window.App.engine.quickComplete(window.App.db, targetActivityId, {
  expense, income, outputTitle,
});
if (!r.ok) { /* 保留原有错误提示路径 */ }
```

（record() 的具体局部变量名以实际代码为准；关键是删光直写语句，不留双路径。）

- [ ] **Step 5: 全绿 + 提交**

Run: `npm test && node --check src/views/timer.js && npm run build`

```bash
git add src/domain/engine.js src/views/timer.js tests/domain.test.js
git commit -m "refactor: 通用计时入账收编进引擎 quickComplete，消除UI直写旁路"
```

---

### Task 11: 冒烟脚本扩展 + 打包验收

**Files:**
- Modify: `scripts/smoke_test.py`（或新建 `scripts/phase1_smoke.py`，参照现有 Playwright 脚本结构）

**Interfaces:**
- Produces: 自动断言「旧操作逐条可达」（宪法#1 执行证明）

- [ ] **Step 1: 新增断言（参照 scripts/smoke_test.py 既有写法，Playwright web 模式）**

```python
# 一期验收：可达性核对表
# 1 单击 Planned 卡 → 状态变 Started（或弹仲裁）
# 2 长按卡 → 菜单含 开始/计时/编辑/改期/删除 五项
# 3 🍅按钮仍直接打开计时器
# 4 右滑 Started 卡 → 弹完成弹窗
# 5 左滑卡 → 弹改期面板
# 6 资源卡单击 → 补充弹窗（原行为不变）
# 7 资源卡长按 → 菜单含 编辑/停用/删除
# 8 完成弹窗保存后 → 出现产出接续浮层
```

每条对应一个 `expect(...)` 断言；触摸模拟用 `page.touchscreen.tap(x, y)` 与 CDP 派发 touch 事件序列（长按=按下后停留 700ms）。

- [ ] **Step 2: 运行**

Run: `python scripts/phase1_smoke.py`（dev server 需已启动）
Expected: 全部断言通过

- [ ] **Step 3: 打包三步曲**

```bash
npm test && npm run build && npx cap sync android
cd android && ./gradlew assembleRelease
```

- [ ] **Step 4: Commit**

```bash
git add scripts/phase1_smoke.py
git commit -m "test: 一期可达性冒烟断言（宪法#1核对表自动化）"
```

---

## Self-Review 结论

- **Spec 覆盖**：一期范围=手势基建✓(T1)、活动卡语法✓(T3/T4/T5)、资源卡菜单✓(见下方缺口说明)、断裂#1✓(T6)#3✓(T7)#4✓(T8)#5✓(T9)、反馈系统✓(T2)、timer收编✓(T10)、验收✓(T11)。
  **缺口修正**：资源卡长按菜单在 T4 未覆盖 → 追加 Task 4b 于下方。
- **占位符扫描**：T9 Step1 的 `selKey`、T10 Step4 的变量名标注了「以实际代码为准」——这是对外部事实的核点而非待定设计，接受。
- **类型一致性**：`attachCard` 回调名在 T1/T4 一致；`App.actVerb` 在 T3/T4 一致；`openRescheduleModal` 在 T4 引用、T5 定义，顺序正确。
