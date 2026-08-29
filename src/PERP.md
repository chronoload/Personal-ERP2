

================================================
FILE: C:\Users\qu\Desktop\物理科学与技术论题\TS2\personal-erp\src\css\app.css
================================================

```css
/* ============================================================
   Personal ERP · 单机自包含 · 浅色仪表盘
   ============================================================ */
:root {
  --bg: #f4f5f7;
  --card: #ffffff;
  --border: #e5e8ee;
  --text: #1f2430;
  --muted: #66707e;
  --ink: #202631;
  --primary: #202631;
  --blue: #4a7fbf;
  --green: #3da06a;
  --amber: #c98a2b;
  --red: #c0454f;
  --purple: #7c6cff;
  --r: 12px;
  --shadow: 0 1px 2px rgba(16, 24, 40, .04), 0 1px 3px rgba(16, 24, 40, .06);
}

* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body {
  margin: 0; background: var(--bg); color: var(--text);
  font-family: Inter, system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", "Segoe UI", sans-serif;
  font-size: 14px; line-height: 1.5;
}
button { font: inherit; cursor: pointer; }
input, select, textarea { font: inherit; }
h1, h2, h3 { margin: 0; }
.muted { color: var(--muted); font-size: 12px; }
.warn { color: var(--amber); }
.grow { flex: 1; min-width: 0; }
.row-gap { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }

/* ---------------- 顶栏 ---------------- */
.topbar {
  position: sticky; top: 0; z-index: 30;
  display: flex; align-items: center; gap: 14px; flex-wrap: wrap;
  padding: 12px 20px; background: rgba(255, 255, 255, .92);
  backdrop-filter: blur(10px); border-bottom: 1px solid var(--border);
}
.brand { display: flex; align-items: center; gap: 10px; }
.logo {
  width: 36px; height: 36px; border-radius: 10px; background: var(--ink);
  color: #fff; display: grid; place-items: center; font-weight: 800; font-size: 16px;
  box-shadow: 0 4px 14px rgba(32, 38, 49, .25);
}
.brand h1 { font-size: 18px; letter-spacing: -.2px; }
.top-res { display: flex; gap: 6px; flex-wrap: wrap; }
.res-pill {
  background: #eef1f6; border: 1px solid var(--border); border-radius: 999px;
  padding: 5px 12px; font-size: 12px; color: var(--muted);
}
/* 每个资源独立配色圆点（按资源 id 稳定哈希，与流水账本圆点一致） */
.res-pill::before {
  content: ''; display: inline-block; width: 8px; height: 8px;
  border-radius: 50%; background: var(--pill-c, #596271);
  margin-right: 6px; vertical-align: -1px;
}
.res-pill b { color: var(--text); font-variant-numeric: tabular-nums; }
/* 资源创建时的颜色选择圆点 */
.color-dot i { display: inline-block; width: 14px; height: 14px; border-radius: 50%; background: var(--dot, #999); vertical-align: -2px; }
.tag-chip.on { outline: 2px solid #4A7FBF; outline-offset: 1px; }
.actions { display: flex; gap: 8px; flex-wrap: wrap; margin-left: auto; }

/* ---------------- 按钮：统一风格，克制层级 ----------------
   主操作 primary：深墨填色，每处仅一个
   次操作 默认：浅色幽灵，安静不抢眼
   危险 danger：红色幽灵，卡片/弹窗全站一致
   计时 timer-btn：品牌点缀色（唯一彩色）
-------------------------------------------------------- */
.btn {
  border: 1px solid var(--border); background: #fff; border-radius: 9px;
  padding: 8px 14px; font-size: 13px; font-weight: 600; color: var(--text);
  transition: background .15s, border-color .15s, color .15s, transform .05s;
}
.btn:hover { background: #f2f4f8; border-color: #c9d0db; }
.btn:active { transform: translateY(1px); }
.btn:disabled { opacity: .4; cursor: not-allowed; }
.btn.primary { background: var(--ink); border-color: var(--ink); color: #fff; box-shadow: 0 1px 6px rgba(32, 38, 49, .18); }
.btn.primary:hover { background: #2c3340; border-color: #2c3340; }
.btn.danger { color: var(--red); border-color: #eccfd2; background: #fff; }
.btn.danger:hover { background: #fdf2f3; border-color: #dca4a8; }
.btn.sm { padding: 3px 9px; font-size: 11.5px; border-radius: 7px; background: #fbfcfd; border-color: #e6e9ef; color: #57626f; }
.btn.sm:hover { background: #eef1f6; border-color: #c9d0db; color: var(--text); }
.btn.sm.primary { background: var(--ink); border-color: var(--ink); color: #fff; padding: 3px 10px; }
.btn.sm.primary:hover { background: #2c3340; }
.btn.sm.danger { color: var(--red); border-color: #eccfd2; background: #fff; }
.btn.sm.danger:hover { background: #fdf2f3; color: var(--red); }
.icon-btn { border: none; background: transparent; color: var(--muted); font-size: 15px; padding: 4px 8px; border-radius: 8px; }
.icon-btn:hover { background: #f0f2f6; }
/* 计时按钮：卡片内白底默认样式；顶栏计时入口保持番茄红 */
.actions .btn.timer-btn { background: #ff2d55; border-color: #ff2d55; color: #fff; }
.actions .btn.timer-btn:hover { background: #e61e4b; border-color: #e61e4b; }

/* 计划状态选择（单控件替代多个状态按钮） */
.status-select { display: inline-flex; align-items: center; gap: 5px; font-size: 11.5px; color: var(--muted); font-weight: 700; }
.status-select select {
  border: 1px solid #e6e9ef; border-radius: 7px; padding: 3px 6px;
  background: #fbfcfd; color: var(--text); font-size: 11.5px; font-weight: 600; outline: none; cursor: pointer;
}
.status-select select:focus { border-color: var(--ink); }

/* 活动卡片操作溢出菜单（⋯ → 编辑/删除） */
.act-menu-wrap { position: relative; }
.act-menu {
  position: absolute; right: 0; bottom: calc(100% + 6px); z-index: 15;
  background: #fff; border: 1px solid var(--border); border-radius: 9px;
  box-shadow: 0 8px 24px rgba(16, 24, 40, .14); padding: 4px; min-width: 96px;
}
.act-menu button {
  display: block; width: 100%; text-align: left; border: none; background: transparent;
  padding: 7px 10px; border-radius: 6px; font-size: 12.5px; color: var(--text); font-weight: 600; cursor: pointer;
}
.act-menu button:hover { background: #f0f2f6; }
.act-menu button.danger { color: var(--red); }
.act-menu button.danger:hover { background: #fdf2f3; }

/* ---------------- Tab ---------------- */
.tabs {
  position: sticky; top: 61px; z-index: 20; display: flex; gap: 4px;
  padding: 10px 20px 0; background: var(--bg);
}
.tab {
  border: none; background: transparent; padding: 10px 20px; border-radius: 10px 10px 0 0;
  font-size: 14px; font-weight: 700; color: var(--muted); border-bottom: 2px solid transparent;
}
.tab.on { color: var(--text); background: #fff; border-bottom-color: var(--primary); }

/* ---------------- 布局 ---------------- */
.content { max-width: 1180px; margin: 0 auto; padding: 18px 20px 80px; }
.row-layout { display: flex; gap: 14px; align-items: stretch; }
.row-layout .grow { flex: 1.6; }
.row-layout .narrow { flex: 1; }
.card {
  background: var(--card); border: 1px solid var(--border); border-radius: var(--r);
  padding: 16px; box-shadow: var(--shadow); margin-bottom: 14px;
}
.card-head { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; margin-bottom: 12px; flex-wrap: wrap; }
.card-head h3 { font-size: 14px; font-weight: 800; }

/* ---------------- 资源 ---------------- */
.res-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; }
.res-card { border: 1px solid var(--border); border-radius: 10px; padding: 12px; background: #fff; transition: opacity .2s; cursor: pointer; }
.res-card.off { opacity: .45; }
.res-head { display: flex; justify-content: space-between; align-items: center; }
.res-name { font-size: 13px; font-weight: 700; }
.res-status { transform: scale(.9); }
.res-balance { font-size: 22px; font-weight: 800; font-variant-numeric: tabular-nums; margin: 6px 0 6px; letter-spacing: -.5px; }
.res-balance.neg { color: var(--red); }
.res-unit { font-size: 11px; color: var(--muted); font-weight: 400; }
.res-meta { font-size: 11px; margin-top: 6px; }

/* ---------------- 进度条 ---------------- */
.progress { height: 6px; background: #eceff3; border-radius: 999px; overflow: hidden; }
.progress .bar { display: block; height: 100%; background: #596271; border-radius: 999px; transition: width .3s; }
.progress .bar.warn { background: var(--amber); }
.progress .bar.danger { background: var(--red); }

/* ---------------- 兑换规则 ---------------- */
.rule-row { display: flex; justify-content: space-between; align-items: center; gap: 8px; padding: 9px 0; border-bottom: 1px solid #eef1f5; flex-wrap: wrap; }
.rule-row:last-child { border-bottom: none; }
.rule-row b { font-size: 12.5px; }

/* ---------------- 商店 · 快速消费 ---------------- */
.goods-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(128px, 1fr)); gap: 10px; }
.good-card { border: 1px solid var(--border); border-radius: 10px; padding: 12px; text-align: center; background: #fff; cursor: pointer; transition: box-shadow .18s, transform .12s, opacity .2s; }
.good-card:hover { box-shadow: 0 4px 14px rgba(16, 24, 40, .08); transform: translateY(-1px); }
.good-card.off { opacity: .45; }
.good-emoji { font-size: 26px; line-height: 1.2; }
.good-name { font-size: 13px; font-weight: 700; margin-top: 6px; }
.good-price { font-size: 12px; color: var(--red); font-weight: 600; margin-top: 2px; font-variant-numeric: tabular-nums; }
.good-card.poor .good-price { color: #b0b6c2; }
.good-note { font-size: 11px; color: var(--muted); margin-top: 2px; }
.good-bal { font-size: 11px; margin-top: 4px; }

/* ---------------- 徽章 ---------------- */
.badge {
  display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 10.5px;
  font-weight: 700; background: #eef0f4; color: #59616d; white-space: nowrap;
}
.b-blue { background: #e6eef8; color: #2f6fb2; }
.b-green { background: #e3f2e9; color: #2c7a4f; }
.b-amber { background: #f6ecd9; color: #9a6b1b; }
.b-red { background: #f8e3e5; color: #b23a44; }
.b-purple { background: #ece8ff; color: #5b4bc4; }
.b-gray { background: #eef0f4; color: #59616d; }
.tag { display: inline-block; padding: 1px 6px; border-radius: 5px; background: #f0f2f6; color: #66707e; font-size: 10.5px; margin-right: 3px; }

/* ---------------- 看板 ---------------- */
.kanban { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
.kanban-col { background: #f7f8fa; border: 1px solid var(--border); border-radius: 10px; padding: 10px; min-height: 120px; transition: background .15s; }
.kanban-col.drag-over { outline: 2px dashed var(--primary); outline-offset: -2px; background: #f0f1f6; }
.kanban-head { font-size: 12.5px; font-weight: 800; color: #4a5260; display: flex; justify-content: space-between; align-items: center; padding: 2px 4px 10px; }
.kanban-head .cnt { background: #e6e9ef; border-radius: 999px; padding: 1px 9px; font-size: 11px; }
.kanban-body { display: flex; flex-direction: column; gap: 8px; }
.kanban-add { border: 1px dashed #cdd3dd; border-radius: 8px; padding: 16px 8px; text-align: center; color: var(--muted); font-size: 12px; cursor: pointer; }
.kanban-add:hover { background: #eef1f6; color: #4a5260; border-color: #a9b1bf; }
.kanban-card {
  background: #fff; border: 1px solid var(--border); border-radius: 10px; padding: 11px;
  box-shadow: 0 1px 2px rgba(16, 24, 40, .05); cursor: grab; transition: border-color .15s, box-shadow .15s;
}
.kanban-card:hover { border-color: #c4cad4; box-shadow: 0 3px 10px rgba(16, 24, 40, .08); }
.kanban-card.warned { border-color: #e6c9a8; }
.kanban-card.dragging { opacity: .55; transform: rotate(1deg); }
.kc-head { display: flex; justify-content: space-between; gap: 6px; align-items: center; }
.kanban-card { --kc-text: #1f2430; --kc-sub: #4a5260; --kc-note-bg: rgba(247, 248, 250, .88); --kc-note-border: #cdd3dd; }
/* 暗底主题：白字保证对比度（智能计算 tone-light） */
.kanban-card.tone-light { --kc-text: #fff; --kc-sub: rgba(255, 255, 255, .85); --kc-note-bg: rgba(28, 32, 40, .55); --kc-note-border: rgba(255, 255, 255, .45); }
.kc-title { font-weight: 750; font-size: 13.5px; color: var(--kc-text); }
.kc-meta { font-size: 11.5px; color: var(--kc-sub); margin-top: 4px; }
.kc-outs { margin-top: 8px; display: flex; flex-direction: column; gap: 6px; }
.kc-out { display: flex; justify-content: space-between; align-items: center; gap: 6px; background: #f7f9fc; border: 1px solid #eef1f5; border-radius: 8px; padding: 6px 8px; font-size: 11.5px; flex-wrap: wrap; }
.kc-actions { display: flex; gap: 5px; margin-top: 9px; flex-wrap: wrap; }

/* 计时进度条：已计 vs 计划 */
.kc-time-progress { margin-top: 7px; }
.kc-tp-label { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; font-size: 11px; color: var(--kc-sub); margin-bottom: 3px; }
.kc-tp-label b { font-variant-numeric: tabular-nums; color: var(--kc-text); }
/* 计时进度条：bar 彩色（番茄红），上方「已计时」文字同色点缀 */
/* 计时进度条：bar 颜色由 JS 智能计算（关联计划染色 → 无计划回退番茄红），
   暗底主题整体提亮，任何色都自动可读，不做单一固定红 */
.kc-time-progress .progress { height: 6px; background: #e8ecf2; }
.kanban-card.tone-light .kc-time-progress { filter: brightness(1.55) saturate(.92); }
.kanban-card.tone-light .kc-time-progress .progress { background: rgba(255, 255, 255, .25); }

/* 任务卡片备注（note） */
.kc-note { font-size: 11.5px; color: var(--kc-text); margin-top: 6px; padding: 5px 8px; background: var(--kc-note-bg); border-radius: 6px; border-left: 2px solid var(--kc-note-border); word-break: break-word; }

/* 任务卡片主题背景：轻微糊化铺满，不铺白；文字按亮度智能变色 */
.kanban-card.themed { position: relative; overflow: hidden; }
.kc-bg {
  position: absolute; top: 0; left: 0; width: 100%; height: 100%; z-index: 0;
  background-size: cover; background-position: center;
  filter: blur(3px) saturate(1.08); transform: scale(1.06);
}
/* 白字时加细阴影兜底可读性（不铺白） */
.kanban-card.tone-light .kc-title,
.kanban-card.tone-light .kc-meta,
.kanban-card.tone-light .kc-note { text-shadow: 0 1px 3px rgba(0, 0, 0, .45); }
.kanban-card.themed .kc-head,
.kanban-card.themed .kc-meta,
.kanban-card.themed .kc-outs,
.kanban-card.themed .kc-note,
.kanban-card.themed .kc-actions,
.kanban-card.themed .kc-time-progress { position: relative; z-index: 1; }

/* ---------------- 价值流 / 反馈 ---------------- */
.vf-row { display: flex; justify-content: space-between; align-items: center; gap: 10px; padding: 10px 0; border-bottom: 1px solid #eef1f5; flex-wrap: wrap; }
.vf-row:last-child { border-bottom: none; }
.fb { padding: 10px 12px; border-radius: 9px; margin-bottom: 8px; font-size: 12px; }
.fb b { font-size: 12px; }
.fb p { margin: 4px 0 0; color: var(--muted); }
.fb.warn { background: #fdf7ec; border: 1px solid #f0e3c4; }
.fb.ok { background: #eff7f1; border: 1px solid #d8eadc; }

/* ---------------- 目标与计划 ---------------- */
.goal-block { padding: 4px 0 6px; }
.goal-head { display: flex; justify-content: space-between; align-items: center; gap: 10px; padding: 10px 12px; background: #f7f8fa; border-radius: 10px; margin-bottom: 10px; flex-wrap: wrap; }
.goal-title { font-size: 15px; font-weight: 800; }
.plan-list { display: flex; flex-direction: column; gap: 10px; padding-left: 12px; }
.plan-card { border: 1px solid var(--border); border-radius: 10px; padding: 12px; }
.plan-head { display: flex; justify-content: space-between; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 8px; }
.plan-head b { font-size: 13.5px; }
.plan-head .muted { font-size: 11.5px; }
.plan-card { cursor: pointer; }
.plan-card .btn, .plan-card .progress { cursor: pointer; }
.goal-head { cursor: pointer; }
.plan-add { border: 1px dashed #cdd3dd; border-radius: 8px; padding: 14px 8px; text-align: center; color: var(--muted); font-size: 12.5px; cursor: pointer; margin: 8px 0; }
.plan-add:hover { background: #eef1f6; color: #4a5260; border-color: #a9b1bf; }
.plan-chip { display: inline-block; width: 10px; height: 10px; border-radius: 3px; margin-right: 6px; vertical-align: middle; }

/* 目标/计划折叠：整行点击切换，折叠箭头极简不抢眼 */
.hidden { display: none !important; }
.goal-head, .plan-head { cursor: pointer; }
.collapse-btn {
  border: none; background: transparent; padding: 0 3px; margin-right: 2px;
  font-size: 10px; line-height: 1.2; color: var(--muted); opacity: .45;
  border-radius: 4px; cursor: pointer; transition: opacity .15s, background .15s;
}
.collapse-btn:hover { opacity: 1; background: #e9ecf2; }
.plan-card.collapsed { padding-bottom: 8px; }
.plan-card.collapsed .plan-head { margin-bottom: 0; }
.goal-block.collapsed .goal-head { margin-bottom: 2px; }

/* 计划下活动列表（同一计划聚类分组展示） */
.plan-acts { margin: 8px 0 2px; border: 1px solid #eef1f5; border-radius: 9px; overflow: hidden; }
.plan-acts-head { display: flex; justify-content: space-between; padding: 5px 10px; font-size: 11px; font-weight: 800; color: #4a5260; background: #f7f9fc; border-bottom: 1px solid #eef1f5; }
.plan-act { display: flex; align-items: center; gap: 8px; padding: 7px 10px; font-size: 12.5px; border-bottom: 1px solid #f2f4f7; cursor: pointer; transition: background .12s; }
.plan-act:last-child { border-bottom: none; }
.plan-act:hover { background: #f4f6fa; }
.plan-act .badge { transform: scale(.92); }
.plan-act-note { font-size: 11px; color: var(--muted); margin-top: 2px; }
.color-row { display: flex; gap: 8px; flex-wrap: wrap; }
.swatch { width: 26px; height: 26px; border-radius: 50%; border: 2px solid rgba(255, 255, 255, .7); cursor: pointer; transition: transform .12s, box-shadow .12s; }
.swatch.on { border-color: var(--ink); transform: scale(1.15); box-shadow: 0 0 0 2px #fff inset; }

/* ---------------- 主题选择（全局背景 / 卡片背景共用） ---------------- */
.theme-row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin-top: 6px; }
.theme-chip { width: 28px; height: 28px; border-radius: 7px; border: 2px solid #fff; cursor: pointer; padding: 0; transition: transform .12s, box-shadow .12s; box-shadow: 0 0 0 1px var(--border); }
.theme-chip:hover { transform: scale(1.1); }
.theme-chip.on { transform: scale(1.15); box-shadow: 0 0 0 2px var(--ink); }
.theme-chip.t-none { width: auto; padding: 0 10px; font-size: 12px; font-weight: 700; color: var(--muted); background: #f5f7fa; display: grid; place-items: center; }
.theme-chip.t-upload { display: grid; place-items: center; background: #f5f7fa; font-size: 15px; }
.theme-preview { height: 76px; border: 1px solid var(--border); border-radius: 10px; background: #fafbfc; display: grid; place-items: center; color: var(--muted); font-size: 12px; margin-bottom: 6px; transition: background .2s; overflow: hidden; }

/* 全局背景主题：原样铺底（不做蒙层处理），由 body 直接承载 */

/* 最近产出标签快捷点选 */
.tag-suggest { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 6px; }
.tag-chip {
  border: 1px solid var(--border); background: #f4f6f9; color: #57626f;
  border-radius: 999px; padding: 2px 10px; font-size: 11px; font-weight: 600; cursor: pointer;
  transition: background .15s, color .15s, border-color .15s;
}
.tag-chip:hover { background: #e8edf4; color: var(--ink); border-color: #c9d0db; }

/* ---------------- 表单 / 弹窗 ---------------- */
.field { margin: 10px 0; }
.field label { display: block; font-size: 12px; color: #3f4753; font-weight: 700; margin-bottom: 5px; }
.field input, .field select, .field textarea {
  width: 100%; padding: 9px 11px; border: 1px solid var(--border); border-radius: 9px;
  background: #fff; color: var(--text); outline: none; transition: border-color .15s, box-shadow .15s;
}
.field input:focus, .field select:focus, .field textarea:focus { border-color: var(--primary); box-shadow: 0 0 0 3px rgba(32, 38, 49, .08); }
.grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.chk-group { display: flex; flex-wrap: wrap; gap: 6px; }
.chk { display: flex; align-items: center; gap: 6px; font-size: 12.5px; padding: 5px 10px; border: 1px solid var(--border); border-radius: 999px; cursor: pointer; background: #fff; }
.chk:has(input:checked) { background: var(--ink); color: #fff; border-color: var(--ink); }
.chk input { accent-color: var(--ink); }
.step-divider { font-size: 11.5px; color: var(--muted); font-weight: 800; margin: 16px 0 6px; text-transform: none; }
.callout { background: #f3f6fb; border: 1px solid #dde5f0; border-radius: 9px; padding: 10px 12px; font-size: 12.5px; margin-bottom: 8px; }
.callout b { color: var(--primary); }

.modal-mask {
  position: fixed; inset: 0; background: rgba(18, 22, 30, .45); z-index: 60;
  display: flex; align-items: center; justify-content: center; padding: 18px;
  animation: fade .18s ease;
}
.modal-mask.closing { opacity: 0; transition: opacity .18s; }
.modal-panel {
  background: #fff; border-radius: 16px; width: 100%; max-height: 90vh; overflow: auto;
  box-shadow: 0 24px 60px rgba(16, 24, 40, .25); animation: pop .2s ease;
}
.modal-head { display: flex; justify-content: space-between; align-items: center; padding: 16px 18px 0; }
.modal-head h3 { font-size: 16px; font-weight: 800; }
.modal-body { padding: 6px 18px 8px; }
.modal-foot { display: flex; justify-content: flex-end; gap: 8px; padding: 12px 18px 16px; }
@keyframes fade { from { opacity: 0; } }
@keyframes pop { from { transform: translateY(8px) scale(.99); opacity: 0; } }

/* ---------------- Toast ---------------- */
.toast-root { position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%); z-index: 100; display: flex; flex-direction: column; gap: 8px; align-items: center; pointer-events: none; }
.toast {
  background: var(--ink); color: #fff; padding: 10px 18px; border-radius: 999px; font-size: 13px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, .25); opacity: 0; transform: translateY(8px); transition: all .25s; max-width: 86vw;
}
.toast.show { opacity: 1; transform: translateY(0); }
.toast-err { background: var(--red); }

/* ---------------- 空态 ---------------- */
.empty { color: var(--muted); font-size: 12.5px; text-align: center; padding: 22px 10px; background: #fafbfc; border: 1px dashed #dfe3ea; border-radius: 10px; }

/* ---------------- 日历 ---------------- */
/* 统一网格：圆角外框 + 每格内边线；末列去右边线、末行去底线，圆角不露馅 */
.cal-grid {
  display: grid; grid-template-columns: repeat(7, 1fr); gap: 0;
  background: #fff; border: 1px solid var(--border); border-radius: 12px; overflow: hidden;
}
.cal-grid > * { border-right: 1px solid #eef1f5; border-bottom: 1px solid #eef1f5; }
.cal-grid > :nth-child(7n) { border-right: none; }
.cal-grid > :nth-last-child(-n + 7) { border-bottom: none; }
.cal-dow { background: #f7f9fc; color: var(--muted); text-align: center; padding: 8px 0; font-weight: 700; font-size: 11px; }
.cal-dow:nth-child(6), .cal-dow:nth-child(7) { color: var(--red); } /* 周六/日标题标红 */
.cal-day { min-height: 72px; padding: 6px; font-size: 11px; cursor: pointer; background: #fff; transition: background .12s; position: relative; }
.cal-day:hover:not(.empty) { background: #f2f5fa; }
.cal-day.empty { background: #fafbfc; cursor: default; }
.cal-day.today { background: #eef1f8; }
.cal-day.selected { background: #e6ecf7; box-shadow: inset 0 0 0 2px var(--primary); }
.cal-d { display: inline-grid; place-items: center; width: 22px; height: 22px; border-radius: 50%; font-weight: 800; }
.cal-day.today .cal-d { background: var(--ink); color: #fff; }
.cal-day.selected .cal-d { background: var(--primary); color: #fff; }
.cal-cnt { display: inline-block; margin-top: 4px; font-size: 10px; color: #4a5260; background: #e9edf3; border-radius: 999px; padding: 1px 6px; font-weight: 600; }
.cal-cost { margin-top: 3px; font-size: 10px; color: var(--red); font-weight: 700; }
/* 日历 + 当日日程 */
.cal-wrap { display: grid; grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr); gap: 16px; align-items: start; }
.cal-agenda { border: 1px solid var(--border); border-radius: 12px; padding: 12px; background: #fbfcfe; min-height: 140px; cursor: pointer; }
.agenda-head { display: flex; justify-content: space-between; align-items: center; gap: 8px; font-weight: 800; font-size: 14px; margin-bottom: 8px; }
.agenda-row { display: flex; align-items: center; gap: 10px; padding: 8px 6px; border-radius: 8px; border-bottom: 1px solid #edf0f3; transition: background .12s; }
.agenda-row:hover { background: #f5f7fb; }
.agenda-row.clickable { cursor: pointer; }
.agenda-row.clickable:hover { background: #eef3fb; }
.agenda-row:last-child { border-bottom: none; }
.agenda-time { width: 48px; flex-shrink: 0; text-align: center; font-weight: 800; font-size: 11px; background: #fff; border: 1px solid #e6e9ef; border-radius: 999px; padding: 3px 0; }
.agenda-title { font-size: 13px; font-weight: 600; }
.agenda-title .plan-chip { margin-right: 5px; }
.agenda-note { font-size: 11px; color: var(--muted); margin-top: 2px; }

/* 当日日程 + 活动看板：轮播（transform 平移 + 高度过渡），桌面端堆叠 */
.dash-pager { position: relative; overflow: hidden; transition: height .22s ease; }
.dash-nav { display: flex; gap: 6px; margin-bottom: 10px; }
.dash-nav-item { border: 1px solid var(--border); background: #fff; border-radius: 999px; padding: 4px 14px; font-size: 12px; font-weight: 700; color: var(--muted); transition: background .15s, color .15s, border-color .15s; }
.dash-nav-item:hover { color: var(--text); border-color: #c9d0db; }
.dash-nav-item.on { background: var(--ink); border-color: var(--ink); color: #fff; }
.dash-track { display: flex; align-items: flex-start; transition: transform .28s ease; }
.dash-page { flex: 0 0 50%; min-width: 50%; }
@media (min-width: 861px) {
  .dash-pager { display: block; overflow: visible; height: auto !important; transition: none; }
  .dash-nav { display: none; }
  .dash-track { display: block; width: auto !important; transform: none !important; transition: none; }
  .dash-page { flex: none; width: auto !important; min-width: 0 !important; }
}

/* ---------------- 统计 ---------------- */
.kpi-row { display: grid; grid-template-columns: repeat(5, 1fr); gap: 12px; margin-bottom: 14px; }
.kpi { background: var(--card); border: 1px solid var(--border); border-radius: var(--r); padding: 14px 16px; box-shadow: var(--shadow); }
.kpi-v { font-size: 24px; font-weight: 800; font-variant-numeric: tabular-nums; }
.kpi-l { font-size: 12px; color: var(--muted); }
.trend-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; }
.trend-card { border: 1px solid var(--border); border-radius: 10px; padding: 12px; }
.trend-head { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 6px; }
.spark-wrap { color: #596271; }
.spark { width: 100%; height: 56px; display: block; }
.hbar-row { display: flex; align-items: center; gap: 10px; padding: 6px 0; }
.hbar-label { width: 120px; font-size: 12px; color: #4a5260; text-align: right; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.hbar { flex: 1; height: 12px; background: #eef1f5; border-radius: 999px; overflow: hidden; }
.hbar i { display: block; height: 100%; background: #596271; border-radius: 999px; transition: width .3s; }
.hbar i.danger { background: var(--red); }
.hbar-val { width: 90px; font-size: 11.5px; font-variant-numeric: tabular-nums; color: var(--muted); }

/* ---------------- 流水账本 ---------------- */
.ledger { display: flex; flex-direction: column; }
.tx-row { display: flex; justify-content: space-between; align-items: center; gap: 10px; padding: 10px 0; border-bottom: 1px solid #eef1f5; flex-wrap: wrap; }
.tx-row:last-child { border-bottom: none; }
.tx-row.rev { opacity: .6; }
.tx-main { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.res-dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; }
.amount { font-variant-numeric: tabular-nums; font-weight: 800; }
.amount.pos { color: var(--green); }
.amount.neg { color: var(--red); }
.vf-sum-row { display: flex; align-items: center; gap: 10px; padding: 9px 0; border-bottom: 1px solid #eef1f5; flex-wrap: wrap; font-size: 13px; }
.vf-sum-row:last-child { border-bottom: none; }

/* ---------------- TikTok 计时器 ---------------- */
.timer-overlay {
  position: fixed; inset: 0; background: #0b0b10; color: #fff; z-index: 90;
  display: none; flex-direction: column; align-items: center; justify-content: center; gap: 10px;
  padding: 20px;
}
.timer-overlay.show { display: flex; animation: fade .2s; }
.timer-name { font-size: 18px; font-weight: 700; margin-bottom: 6px; text-align: center; max-width: 82vw; }
.timer-ring { position: relative; width: 300px; height: 300px; }
.timer-ring svg { transform: rotate(-90deg); width: 100%; height: 100%; display: block; }
.ring-bg { stroke: #23232e; fill: none; stroke-width: 10; }
.ring-fg { stroke: #ff2d55; fill: none; stroke-width: 10; stroke-linecap: round; transition: stroke-dashoffset .35s linear; }
.timer-num { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; }
.timer-num .big { font-size: 60px; font-weight: 800; font-variant-numeric: tabular-nums; letter-spacing: 1px; }
.timer-num .lbl { font-size: 13px; color: #8b8fa3; margin-top: 4px; }
.timer-presets { display: flex; gap: 8px; margin-top: 22px; flex-wrap: wrap; justify-content: center; }
.timer-presets button { padding: 10px 18px; border-radius: 999px; border: 1px solid #2a2a35; background: #16161d; color: #d0d0da; font-size: 14px; }
.timer-presets button.on { background: #ff2d55; color: #fff; border-color: #ff2d55; }
.timer-controls { display: flex; gap: 12px; margin-top: 22px; }
.timer-controls button { padding: 12px 30px; border-radius: 999px; font-size: 15px; font-weight: 800; border: none; }
.timer-controls .t-go { background: #ff2d55; color: #fff; }
.timer-controls .t-reset { background: #23232e; color: #fff; }
.timer-controls .t-now { background: #2c3e5e; color: #fff; }
.timer-controls .t-now:hover { background: #38507a; }
.timer-controls .t-close { background: transparent; color: #8b8fa3; border: 1px solid #2a2a35; }
.timer-done { display: none; flex-direction: column; align-items: center; gap: 14px; }
.timer-done.show { display: flex; }
.timer-done .emoji { font-size: 64px; }
.timer-done .txt { font-size: 20px; font-weight: 800; }
.timer-done input { padding: 12px 16px; border-radius: 12px; border: 1px solid #2a2a35; background: #16161d; color: #fff; width: min(340px, 80vw); font-size: 15px; outline: none; }
.timer-done .rowbtn { display: flex; gap: 10px; margin-top: 6px; }
.timer-done .rowbtn button { padding: 12px 24px; border-radius: 12px; border: none; font-size: 14px; font-weight: 800; }
.timer-done .rowbtn .go { background: #ff2d55; color: #fff; }
.timer-done .rowbtn .ghost { background: #23232e; color: #fff; }

/* ---------------- 初始化页 ---------------- */
.setup-card { max-width: 560px; margin: 6vh auto 0; text-align: center; }
.setup-logo { width: 52px; height: 52px; margin: 4px auto 10px; border-radius: 14px; background: var(--ink); color: #fff; display: grid; place-items: center; font-weight: 800; font-size: 24px; box-shadow: 0 8px 22px rgba(32, 38, 49, .25); }
.setup-title { font-size: 20px; font-weight: 800; }
.setup-sub { max-width: 400px; margin: 6px auto 0; }
.setup-quick { justify-content: center; margin: 14px 0; }
.setup-list { margin-top: 14px; }
.setup-item { justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #eef1f5; }
.setup-foot { margin-top: 18px; }

/* ---------------- 语义色 / 弹窗意图 ---------------- */
:root {
  --acc-primary: #4f46e5; /* 主操作：靛蓝 */
  --acc-info: #2563eb;    /* 信息/执行 */
  --acc-ok: #16a34a;      /* 成功/闭环 */
  --acc-warn: #d97706;    /* 警示/严格 */
  --acc-danger: #dc2626;  /* 危险/删除/冲正 */
}

/* 主操作按钮样式见顶部「按钮」小节（统一风格） */

/* 弹窗意图：顶边条（危险/成功/警示/信息用语义色），品牌/常规用深色 */
.modal-panel.accent-brand { border-top: 4px solid var(--ink); }
.modal-panel.accent-info { border-top: 4px solid var(--acc-info); }
.modal-panel.accent-ok { border-top: 4px solid var(--acc-ok); }
.modal-panel.accent-warn { border-top: 4px solid var(--acc-warn); }
.modal-panel.accent-danger { border-top: 4px solid var(--acc-danger); }
.modal-head h3 { font-size: 17px; font-weight: 800; color: var(--text); }
.modal-panel.accent-info .modal-head h3 { color: var(--acc-info); }
.modal-panel.accent-ok .modal-head h3 { color: var(--acc-ok); }
.modal-panel.accent-warn .modal-head h3 { color: var(--acc-warn); }
.modal-panel.accent-danger .modal-head h3 { color: var(--acc-danger); }

/* 步骤分段（完成弹窗 ① ②）：不同意图不同色 */
.step-divider { margin: 18px 0 8px; font-weight: 800; font-size: 12.5px; letter-spacing: .3px; color: var(--text); }
.step-divider.step-1 { color: var(--acc-info); }
.step-divider.step-2 { color: var(--acc-ok); }

/* 强调提示条（严格闭环等） */
.callout.warn { background: #fffbeb; border-color: #fcd34d; color: #92400e; }
.callout.warn b { color: #b45309; }

/* 危险按钮：全站统一为红色幽灵（见顶部「按钮」小节），弹窗内亦然 */

/* 必填星号 */
.field label .req { color: var(--acc-danger); font-weight: 800; }

/* 输入聚焦：深色描边（高对比，不花哨） */
.field input:focus, .field select:focus, .field textarea:focus { border-color: var(--ink); box-shadow: 0 0 0 3px rgba(32, 38, 49, .12); }

/* 成功 / 信息 toast 语义色 */
.toast-ok { background: var(--acc-ok); }
.toast-info { background: var(--acc-info); }

/* ---------------- 动效 ---------------- */
/* 切换 Tab 时的卡片入场（刷新不重播） */
.content.anim-in > .card, .content.anim-in .dash-page > .card { animation: card-in .32s ease both; }
.content.anim-in > .row-layout > .card { animation: card-in .32s ease both; }
.content.anim-in .dash-page > #calendar-section > .card { animation: card-in .32s ease both; animation-delay: .05s; }
.content.anim-in .dash-page:nth-child(2) > .card { animation-delay: .08s; }
.content.anim-in > .row-layout:nth-of-type(1) > .card { animation-delay: .05s; }
.content.anim-in > .row-layout:nth-of-type(2) > .card { animation-delay: .11s; }
@keyframes card-in { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }

/* 看板卡片入场 + 交互反馈 */
.content.anim-in .kanban-card { animation: pop-in .26s ease both; }
.content.anim-in .kanban-body .kanban-card:nth-child(1) { animation-delay: .02s; }
.content.anim-in .kanban-body .kanban-card:nth-child(2) { animation-delay: .05s; }
.content.anim-in .kanban-body .kanban-card:nth-child(3) { animation-delay: .08s; }
.content.anim-in .kanban-body .kanban-card:nth-child(4) { animation-delay: .11s; }
@keyframes pop-in { from { opacity: 0; transform: translateY(6px) scale(.98); } to { opacity: 1; transform: none; } }

.kanban-card { transition: box-shadow .18s, border-color .18s, transform .12s; }
.kanban-card:hover { box-shadow: 0 6px 18px rgba(16, 24, 40, .10); border-color: #b9c0cc; }
.kanban-card:active { transform: scale(.99); }
.res-card { transition: box-shadow .18s, transform .12s; }
.res-card:hover { box-shadow: 0 4px 14px rgba(16, 24, 40, .08); }

/* ---------------- 响应式 ---------------- */
@media (max-width: 1080px) {
  .res-grid { grid-template-columns: repeat(2, 1fr); }
  .kpi-row { grid-template-columns: repeat(3, 1fr); }
}
@media (max-width: 860px) {
  .row-layout { flex-direction: column; }
  .kanban { grid-template-columns: 1fr; }
  .cal-wrap { grid-template-columns: 1fr; }
  .trend-grid { grid-template-columns: 1fr; }
  .tabs { top: auto; position: sticky; bottom: 0; background: rgba(255, 255, 255, .95); border-top: 1px solid var(--border); border-radius: 14px 14px 0 0; padding: 6px; }
  .tab { flex: 1; border-radius: 10px; border-bottom: none; background: transparent; padding: 10px; }
  .tab.on { background: var(--ink); color: #fff; }
  .content { padding-bottom: 120px; }
  .actions .btn { padding: 7px 10px; font-size: 12px; }
  .top-res { order: 3; width: 100%; }
}
@media (max-width: 560px) {
  .topbar { padding: 10px 14px; }
  .res-grid { grid-template-columns: 1fr 1fr; }
  .kpi-row { grid-template-columns: repeat(2, 1fr); }
  .timer-ring { width: 240px; height: 240px; }
  .timer-num .big { font-size: 48px; }
  .grid2 { grid-template-columns: 1fr; }
  .hbar-label { width: 84px; }
  .modal-panel { border-radius: 12px; }
}

/* ---------------- 新一天引导 ---------------- */
.dg-overlay { position: fixed; inset: 0; z-index: 90; background: rgba(24, 28, 36, .45); backdrop-filter: blur(4px); display: none; align-items: center; justify-content: center; padding: 18px; }
.dg-overlay.show { display: flex; }
.dg-panel {
  width: min(480px, 94vw); max-height: 86vh; overflow-y: auto;
  background: #fff; border-radius: 16px; padding: 22px;
  box-shadow: 0 12px 48px rgba(10, 14, 22, .28);
  animation: dg-in .25s ease both;
}
@keyframes dg-in { from { opacity: 0; transform: translateY(10px) scale(.98); } to { opacity: 1; transform: none; } }
.dg-head { text-align: center; margin-bottom: 16px; }
.dg-greet { font-size: 13px; color: #4A7FBF; font-weight: 700; }
.dg-head h2 { margin: 6px 0 4px; font-size: 20px; }
.dg-head p { margin: 0; }
.dg-cards { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-bottom: 18px; }
.dg-card { border: 1px dashed #cfd7e2; border-radius: 10px; padding: 14px 8px; text-align: center; font-size: 12.5px; color: #3d4655; background: #f7f9fc; }
.dg-or { text-align: center; color: var(--muted); font-size: 12px; margin: 12px 0 6px; position: relative; }
.dg-or::before, .dg-or::after { content: ''; position: absolute; top: 50%; width: 34%; height: 1px; background: var(--border); }
.dg-or::before { left: 0; } .dg-or::after { right: 0; }
.dg-add { border: 1px solid var(--border); border-radius: 10px; padding: 12px; background: #f9fafc; }
.dg-add input#dg-act-title { width: 100%; margin-bottom: 8px; }
.dg-act-list { margin-top: 12px; display: flex; flex-direction: column; gap: 6px; }
.dg-act-row, .dg-sum-row { display: flex; align-items: center; gap: 8px; border: 1px solid var(--border); border-radius: 8px; padding: 7px 10px; font-size: 12.5px; background: #fff; }
.dg-act-time { font-weight: 700; font-variant-numeric: tabular-nums; color: #202631; min-width: 44px; }
.dg-foot { display: flex; justify-content: space-between; align-items: center; margin-top: 20px; gap: 10px; }

/* ---------------- 新一天引导 END ---------------- */

```



================================================
FILE: C:\Users\qu\Desktop\物理科学与技术论题\TS2\personal-erp\src\domain\engine.js
================================================

``javascript
// ============================================================
// domain/engine.js
// 领域引擎（应用服务层）：所有会改变系统的操作都必须经过这里。
// 职责：强制状态机合法流转 + 5 条全局不变量，失败返回 {ok:false,error}，
//       成功则原地修改 db 并返回 {ok:true}。UI 只调用本层函数。
// 这是「严格 ERP」与「普通 CRUD」的分水岭。
// ============================================================
import {
  ACTIVITY_TRANSITIONS, PLAN_TRANSITIONS, OUTPUT_TRANSITIONS,
  nextId, newActivity, newOutput, newPlan, newGoal, newResource, newRule, newGood,
  VF_EXPECT_MS, VF_RECHARGE, DIR_CONSUME,
} from './entities.js';

const ok = (extra) => ({ ok: true, ...(extra || {}) });
const fail = (error) => ({ ok: false, error });

// ---------- 只读核算（不变量1/4 的数值基础） ----------

// 资源余额 = initial + Σ(debit) − Σ(credit)
// 冲正流水本身是真实借贷分录，必须计入（原单 −50 + 冲正 +50 = 0，账实相符）
export function balanceOf(db, resourceId) {
  const r = db.resources.find((x) => x.id === resourceId);
  if (!r) return 0;
  let d = 0, c = 0;
  for (const t of db.txs) {
    if (t.resource_id !== resourceId) continue;
    d += t.debit; c += t.credit;
  }
  return r.initial + d - c;
}

export function resourceOf(db, id) {
  return db.resources.find((r) => r.id === id);
}

// 某计划下所有活动累计消耗（活动来源流水的 credit 之和，冲正抵减）
export function planCost(db, planId) {
  const actIds = new Set(db.activities.filter((a) => a.plan_ids.includes(planId)).map((a) => a.id));
  // 原单被冲正额：origTxId -> 该单累计被冲正的 credit（冲正为 debit）
  const revByOrig = new Map();
  for (const t of db.txs) {
    if (t.source_type === 'reversal') {
      revByOrig.set(t.source_id, (revByOrig.get(t.source_id) || 0) + t.debit);
    }
  }
  let sum = 0;
  for (const t of db.txs) {
    if (t.source_type !== 'activity' || !actIds.has(t.source_id)) continue;
    sum += t.credit - (revByOrig.get(t.id) || 0);
  }
  return Math.max(0, sum);
}

// 单个活动的消耗（活动来源流水 credit 之和，扣减冲正）
export function activityCost(db, activityId) {
  let rev = 0;
  const origIds = new Set(
    db.txs.filter((t) => t.source_type === 'activity' && t.source_id === activityId).map((t) => t.id)
  );
  for (const t of db.txs) {
    if (t.source_type === 'reversal' && origIds.has(t.source_id)) rev += t.debit;
  }
  let sum = 0;
  for (const t of db.txs) {
    if (t.source_type === 'activity' && t.source_id === activityId) sum += t.credit;
  }
  return Math.max(0, sum - rev);
}

// 按任务累计计时（番茄钟 time_logs 之和，运行中按当前时间计）
export function trackedMinutes(db, activityId) {
  const a = db.activities.find((x) => x.id === activityId);
  if (!a || !Array.isArray(a.time_logs)) return 0;
  return a.time_logs.reduce((s, l) => {
    const end = l.end || Date.now();
    return s + Math.max(0, Math.round((end - l.start) / 60000));
  }, 0);
}

// 不变量4：计划预算硬约束（budget 非空且已耗 ≥ 预算 → 冻结）
export function isPlanBlocked(db, planId) {
  const p = db.plans.find((x) => x.id === planId);
  if (!p || p.budget === null) return false;
  return planCost(db, planId) >= p.budget;
}

export function anyPlanBlocked(db, planIds) {
  return planIds.some((pid) => isPlanBlocked(db, pid));
}

// 不变量2：活动必须已有流水 + 产出
export function activityHasTx(db, id) {
  return db.txs.some((t) => t.source_type === 'activity' && t.source_id === id && !t.reversal_of);
}
export function activityHasOutput(db, id) {
  return db.outputs.some((o) => o.activity_id === id);
}

// 决策 16BC：ValueFlow 超期状态由 expected 派生（不落库，定时任务由派生代替）
export function vfStatus(db, vf) {
  if (vf.status === 'Closed') return 'Closed';
  return vf.expected < Date.now() ? 'Overdue' : 'Pending';
}

// 通用状态机校验
function checkTransition(table, from, to) {
  const allowed = table[from];
  return !!allowed && allowed.includes(to);
}

// ---------- 资源 (Resource) ----------

export function createResource(db, { name, unit, initial, color }) {
  if (!name || !name.trim()) return fail('资源名称必填');
  if (!Number.isFinite(Number(initial))) return fail('初始余额必须是数字');
  const r = newResource({ name: name.trim(), unit: (unit || '').trim(), initial: Number(initial) || 0, color: color || null });
  r.id = nextId(db, 'r');
  db.resources.push(r);
  return ok();
}

export function setResourceStatus(db, id, status) {
  const r = resourceOf(db, id);
  if (!r) return fail('资源不存在');
  r.status = status;
  return ok();
}

// 删除资源（初始化/维护）：连带清理其流水与兑换规则
export function deleteResource(db, id) {
  const r = resourceOf(db, id);
  if (!r) return fail('资源不存在');
  db.resources = db.resources.filter((x) => x.id !== id);
  db.txs = db.txs.filter((t) => t.resource_id !== id);
  db.rules = db.rules.filter((x) => x.from !== id && x.to !== id);
  return ok();
}

// 手动调整资源余额（点击资源卡「补充」）：生成一笔 manual 流水，不挂活动
export function adjustResource(db, resourceId, { direction, amount, note }) {
  const r = resourceOf(db, resourceId);
  if (!r) return fail('资源不存在');
  const amt = Number(amount);
  if (!(amt > 0)) return fail('金额必须 > 0');
  db.txs.push({
    id: nextId(db, 't'), resource_id: resourceId,
    debit: direction === 'debit' ? amt : 0,
    credit: direction === 'credit' ? amt : 0,
    source_type: 'manual', source_id: 'manual',
    note: (note || '').trim() || (direction === 'debit' ? '手动补充' : '手动调整'),
    reversal_of: null, created: Date.now(),
  });
  return ok();
}

// ---------- 兑换规则 (ConversionRule) ----------

export function createRule(db, { label, from, to, rate }) {
  if (!label || !label.trim()) return fail('规则标签必填');
  if (from === to) return fail('不能同资源兑换');
  if (!(Number(rate) > 0)) return fail('兑换比例必须 > 0');
  const rule = newRule({ label: label.trim(), from, to, rate: Number(rate) });
  rule.id = nextId(db, 'ru');
  db.rules.push(rule);
  return ok();
}

export function setRuleStatus(db, id, status) {
  const r = db.rules.find((x) => x.id === id);
  if (!r) return fail('规则不存在');
  r.status = status;
  return ok();
}

// 执行兑换（决策 B：单向换算）。生成两条流水，保证两资源各自 余额=Σ流水。
// 允许借贷：from 余额不足也放行，from 可扣为负。
export function convert(db, ruleId, amount) {
  const rule = db.rules.find((r) => r.id === ruleId);
  if (!rule || rule.status !== 'Active') return fail('规则不存在或已停用');
  const amt = Number(amount);
  if (!(amt > 0)) return fail('兑换数量必须 > 0');
  const gain = amt * rule.rate;
  db.txs.push({
    id: nextId(db, 't'), resource_id: rule.from, debit: 0, credit: amt,
    source_type: 'conversion', source_id: rule.id, note: `${rule.label} → 兑换为${resourceOf(db, rule.to).name}`,
    reversal_of: null, created: Date.now(),
  });
  db.txs.push({
    id: nextId(db, 't'), resource_id: rule.to, debit: gain, credit: 0,
    source_type: 'conversion', source_id: rule.id, note: `${rule.label} ← 来自${resourceOf(db, rule.from).name}`,
    reversal_of: null, created: Date.now(),
  });
  return ok();
}

// ---------- 商品 (Good) ----------

// 读取商品成本（兼容旧单资源格式 {resource_id, price}）
export function goodCosts(g) {
  if (Array.isArray(g?.costs) && g.costs.length) return g.costs;
  if (g?.resource_id && Number(g?.price) > 0) return [{ resource_id: g.resource_id, amount: Number(g.price) }];
  return [];
}

function normalizeCosts(db, costs) {
  const out = [];
  for (const c of costs || []) {
    const amount = Number(c.amount);
    if (!(amount > 0)) continue;
    if (!resourceOf(db, c.resource_id)) return fail('消耗资源不存在');
    out.push({ resource_id: c.resource_id, amount });
  }
  if (!out.length) return fail('至少配置一种资源消耗');
  return { ok: true, out };
}

export function createGood(db, { name, emoji, costs, note }) {
  if (!name || !name.trim()) return fail('商品名称必填');
  const nc = normalizeCosts(db, costs);
  if (!nc.ok) return nc;
  const g = newGood({
    name: name.trim(), emoji: (emoji || '').trim() || '🛍️',
    costs: nc.out, note: (note || '').trim(),
  });
  g.id = nextId(db, 'gd');
  db.goods.push(g);
  return ok();
}

export function updateGood(db, id, { name, emoji, costs, note }) {
  const g = db.goods.find((x) => x.id === id);
  if (!g) return fail('商品不存在');
  if (!name || !name.trim()) return fail('商品名称必填');
  const nc = normalizeCosts(db, costs);
  if (!nc.ok) return nc;
  g.name = name.trim(); g.emoji = (emoji || '').trim() || '🛍️';
  g.costs = nc.out; g.note = (note || '').trim();
  delete g.resource_id; delete g.price; // 清理旧格式字段
  return ok();
}

export function setGoodStatus(db, id, status) {
  const g = db.goods.find((x) => x.id === id);
  if (!g) return fail('商品不存在');
  g.status = status;
  return ok();
}

export function deleteGood(db, id) {
  const g = db.goods.find((x) => x.id === id);
  if (!g) return fail('商品不存在');
  db.goods = db.goods.filter((x) => x.id !== id);
  return ok();
}

// 快速消费（LifeUp 式）：按商品的多资源成本逐一生成 credit 流水，不挂活动。
// 允许借贷：余额不足照样扣减，余额可为负。
export function consumeGood(db, id, { qty = 1, note = '' } = {}) {
  const g = db.goods.find((x) => x.id === id);
  if (!g) return fail('商品不存在');
  if (g.status !== 'Active') return fail('商品已停用');
  const n = Number(qty);
  if (!(n > 0)) return fail('数量必须 > 0');
  const costs = goodCosts(g);
  if (!costs.length) return fail('商品未配置资源消耗');
  for (const c of costs) {
    db.txs.push({
      id: nextId(db, 't'), resource_id: c.resource_id,
      debit: 0, credit: c.amount * n,
      source_type: 'goods', source_id: g.id,
      note: `购买「${g.name}」×${n}${note ? ' · ' + note : ''}`,
      reversal_of: null, created: Date.now(),
    });
  }
  return ok();
}

// ---------- 目标 (Goal) ----------

export function createGoal(db, { title, desc }) {
  if (!title || !title.trim()) return fail('目标名称必填');
  const g = newGoal({ title: title.trim(), desc: (desc || '').trim() });
  g.id = nextId(db, 'g');
  db.goals.push(g);
  return ok();
}

export function updateGoal(db, id, { title, desc }) {
  const g = db.goals.find((x) => x.id === id);
  if (!g) return fail('目标不存在');
  if (!title || !title.trim()) return fail('目标名称必填');
  g.title = title.trim(); g.desc = (desc || '').trim();
  return ok();
}

export function deleteGoal(db, id) {
  const cnt = db.plans.filter((p) => p.goal_id === id).length;
  if (cnt) return fail(`该目标下有 ${cnt} 个计划，需先移除计划`);
  db.goals = db.goals.filter((x) => x.id !== id);
  return ok();
}

// 级联删除一个活动：活动 + 其产出 + 产出衍生的价值流 + 相关流水与冲正
function removeActivityDeep(db, activityId) {
  const outIds = new Set(db.outputs.filter((o) => o.activity_id === activityId).map((o) => o.id));
  const vfIds = new Set(db.valueflows.filter((v) => outIds.has(v.output_id)).map((v) => v.id));
  const txIds = new Set(db.txs.filter((t) => t.source_type === 'activity' && t.source_id === activityId).map((t) => t.id));
  db.activities = db.activities.filter((a) => a.id !== activityId);
  db.outputs = db.outputs.filter((o) => o.activity_id !== activityId);
  db.valueflows = db.valueflows.filter((v) => !vfIds.has(v.id));
  db.txs = db.txs.filter((t) => {
    if (t.source_type === 'activity' && t.source_id === activityId) return false;
    if (t.source_type === 'reversal' && txIds.has(t.source_id)) return false;
    if (t.source_type === 'valueflow' && vfIds.has(t.source_id)) return false;
    return true;
  });
}

// 级联删除一个计划：
//   - 仅关联该计划的活动 → 整链删除（含产出/价值流/流水）
//   - 同时关联多个计划的活动 → 仅解除与该计划的关联（保留活动）
export function deletePlanCascade(db, planId) {
  const plan = db.plans.find((x) => x.id === planId);
  if (!plan) return fail('计划不存在');
  const linked = db.activities.filter((a) => a.plan_ids.includes(planId));
  for (const a of linked) {
    if (a.plan_ids.length <= 1) removeActivityDeep(db, a.id);
    else a.plan_ids = a.plan_ids.filter((pid) => pid !== planId);
  }
  db.plans = db.plans.filter((x) => x.id !== planId);
  return ok();
}

// 级联删除一个目标：先级联删除其下所有计划，再删目标
export function deleteGoalCascade(db, goalId) {
  const goal = db.goals.find((x) => x.id === goalId);
  if (!goal) return fail('目标不存在');
  const plans = db.plans.filter((p) => p.goal_id === goalId);
  for (const p of plans) deletePlanCascade(db, p.id);
  db.goals = db.goals.filter((x) => x.id !== goalId);
  return ok();
}

// 删除影响统计（供确认提示）：{ acts 级联删, unlink 解除关联, outs, vfs }
export function planDeleteImpact(db, planId) {
  const linked = db.activities.filter((a) => a.plan_ids.includes(planId));
  const solo = linked.filter((a) => a.plan_ids.length <= 1);
  const soloIds = new Set(solo.map((a) => a.id));
  const outs = db.outputs.filter((o) => soloIds.has(o.activity_id));
  const outIds = new Set(outs.map((o) => o.id));
  return {
    acts: solo.length,
    unlink: linked.length - solo.length,
    outs: outs.length,
    vfs: db.valueflows.filter((v) => outIds.has(v.output_id)).length,
  };
}

export function goalDeleteImpact(db, goalId) {
  const plans = db.plans.filter((p) => p.goal_id === goalId);
  const acc = { plans: plans.length, acts: 0, unlink: 0, outs: 0, vfs: 0 };
  for (const p of plans) {
    const im = planDeleteImpact(db, p.id);
    acc.acts += im.acts; acc.unlink += im.unlink; acc.outs += im.outs; acc.vfs += im.vfs;
  }
  return acc;
}

// 计划配色（按计划染色任务卡片 / 计划卡片）
export const PLAN_COLORS = ['#4a7fbf', '#3da06a', '#d97706', '#7c3aed', '#dc2626', '#0e7490', '#be185d', '#4d7c0f'];

// ---------- 计划 (Plan) ----------

export function createPlan(db, { goal_id, title, budget, color }) {
  if (!title || !title.trim()) return fail('计划名称必填');
  if (!db.goals.some((g) => g.id === goal_id)) return fail('所属目标不存在');
  if (budget !== null && !(Number(budget) >= 0)) return fail('预算必须 ≥ 0');
  const p = newPlan({
    goal_id, title: title.trim(), budget: budget === null ? null : Number(budget),
    color: color || PLAN_COLORS[db.plans.length % PLAN_COLORS.length],
  });
  p.id = nextId(db, 'p');
  db.plans.push(p);
  return ok();
}

export function updatePlan(db, id, { title, budget, color }) {
  const p = db.plans.find((x) => x.id === id);
  if (!p) return fail('计划不存在');
  if (!title || !title.trim()) return fail('计划名称必填');
  if (budget !== null && !(Number(budget) >= 0)) return fail('预算必须 ≥ 0');
  p.title = title.trim(); p.budget = budget === null ? null : Number(budget);
  if (color !== undefined) p.color = color || null;
  return ok();
}

export function deletePlan(db, id) {
  const cnt = db.activities.filter((a) => a.plan_ids.includes(id)).length;
  if (cnt) return fail(`该计划下有 ${cnt} 个活动，需先移除活动`);
  db.plans = db.plans.filter((x) => x.id !== id);
  return ok();
}

export function setPlanStatus(db, id, next) {
  const p = db.plans.find((x) => x.id === id);
  if (!p) return fail('计划不存在');
  if (!checkTransition(PLAN_TRANSITIONS, p.status, next)) return fail(`非法流转：${p.status} → ${next}`);
  p.status = next;
  return ok();
}

// ---------- 活动 (Activity) ----------

// 循环：计算下一次执行日（返回 YYYY-M-D）。repeat: daily|weekday|weekly|monthly
export function nextOccurrenceDate(dateStr, repeat) {
  const d = parseDate(dateStr || todayKey());
  if (repeat === 'daily') d.setDate(d.getDate() + 1);
  else if (repeat === 'weekday') { do { d.setDate(d.getDate() + 1); } while (d.getDay() === 0 || d.getDay() === 6); }
  else if (repeat === 'weekly') d.setDate(d.getDate() + 7);
  else if (repeat === 'monthly') d.setMonth(d.getMonth() + 1);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}
// 解析 YYYY-M-D / YYYY-MM-DD（非 ISO，避免 new Date(string) 的补零限制）
function parseDate(str) {
  const [y, m, d] = String(str).split('-').map(Number);
  return new Date(y || 1970, (m || 1) - 1, d || 1);
}
function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}
// 日期字符串比较（兼容 YYYY-M-D / YYYY-MM-DD）
function dateKey(s) {
  return String(s).split('-').map((n) => String(Number(n)).padStart(2, '0')).join('-');
}

// 由计划开始时间（YYYY-MM-DDTHH:MM，精确到分钟）推导计划日期（非补零 YYYY-M-D）
function datePartFromDatetime(v) {
  if (!v) return null;
  const m = String(v).match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  return m ? `${Number(m[1])}-${Number(m[2])}-${Number(m[3])}` : null;
}
function timePartFromDatetime(v) {
  const m = String(v).match(/T(\d{1,2}):(\d{1,2})/);
  return m ? `${m[1]}:${m[2]}` : null;
}

// ---------- 活动时间原子性 ----------
// 规则：有开始时间且时长>0 的活动占固定时段，一律禁止重叠；
// 弹性活动（无开始时间或零时长）不参与冲突。显式保留的重叠互记 conflicts 捆绑，
// 执行（startActivity）时仲裁：先做这个 / 让对手先。
const OCCUPY_STATUSES = ['Planned', 'Started']; // 未完成的占时间线；已完成属历史事实不拦路

function parseDt(v) { // 'YYYY-MM-DDTHH:MM' → 本地毫秒时间戳
  const m = String(v || '').match(/^(\d{4})-(\d{1,2})-(\d{1,2})T(\d{1,2}):(\d{2})/);
  if (!m) return 0;
  return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]).getTime();
}
function fmtDt(ms) { // 时间戳 → 'YYYY-MM-DDTHH:MM'
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

// 活动固定时间窗；null = 弹性（不占时段）
export function activityWindow(a) {
  const s = parseDt(a && a.planned_start);
  const mins = Number(a && a.planned_minutes) || 0;
  if (!s || mins <= 0) return null;
  return { start: s, end: s + mins * 60000 };
}

function occupies(a) { return OCCUPY_STATUSES.includes(a.status) && !!activityWindow(a); }

function windowsOverlap(w1, w2) { return w1.start < w2.end && w2.start < w1.end; }

// 与 [startMs,endMs] 相交的占用中活动（可排除自身）
export function findConflicts(db, { startMs, endMs, excludeId = null }) {
  return db.activities.filter((x) => {
    if (x.id === excludeId || !occupies(x)) return false;
    const w = activityWindow(x);
    return w.start < endMs && startMs < w.end;
  });
}

// 从期望时刻起找最近空闲槽：当天扫间隙放不下 → 次日同一钟点重试（上限30天）
function findFreeSlot(db, desiredMs, minutes, excludeId) {
  const dur = Math.max(1, minutes) * 60000;
  let cur = desiredMs;
  for (let i = 0; i < 30; i++) {
    const dayEnd = new Date(cur); dayEnd.setHours(24, 0, 0, 0);
    const wins = db.activities
      .filter((x) => x.id !== excludeId && occupies(x))
      .map((x) => activityWindow(x))
      .filter((w) => w.start < dayEnd.getTime() && w.end > cur)
      .sort((p, q) => p.start - q.start);
    let t = cur;
    for (const w of wins) {
      if (t >= w.end) continue;          // 块已在身后
      if (t + dur <= w.start) break;     // 当前起点可用
      t = w.end;                         // 撞块 → 移到块尾再看后续块
    }
    if (t + dur <= dayEnd.getTime()) return t;
    const d = new Date(cur); d.setDate(d.getDate() + 1); // 次日同一钟点
    cur = d.getTime();
  }
  return cur; // 兜底：30 天后必有空隙（极端全满时直接给终点时刻）
}

function linkConflict(a, b) { // 双向捆绑（去重）
  a.conflicts = Array.from(new Set([...(a.conflicts || []), b.id]));
  b.conflicts = Array.from(new Set([...(b.conflicts || []), a.id]));
}
function unlinkConflict(a, b) {
  a.conflicts = (a.conflicts || []).filter((z) => z !== b.id);
  b.conflicts = (b.conflicts || []).filter((z) => z !== a.id);
}
function cleanConflictsFor(db, id) { // 清除某活动的全部捆绑（双向）
  const a = db.activities.find((x) => x.id === id);
  if (!a) return;
  for (const oid of a.conflicts || []) {
    const o = db.activities.find((x) => x.id === oid);
    if (o) o.conflicts = (o.conflicts || []).filter((z) => z !== id);
  }
  a.conflicts = [];
}

// 原子性落地：推算 planned_end → 冲突检测 → 自动顺延（默认）或按 keep_conflict 捆绑。
// 返回 { shifted } | { bundled } | {}（UI 据此提示）
function applyAtomicity(db, a, { keepConflict = false } = {}) {
  cleanConflictsFor(db, a.id);
  const w = activityWindow(a);
  if (!w) { a.planned_end = null; return {}; }
  a.planned_end = fmtDt(w.end);
  const hits = findConflicts(db, { startMs: w.start, endMs: w.end, excludeId: a.id });
  if (hits.length && keepConflict) {
    for (const h of hits) linkConflict(a, h);
    return { bundled: true };
  }
  if (hits.length) { // 智能顺延：挪到最近空闲槽
    const slot = findFreeSlot(db, w.start, a.planned_minutes, a.id);
    a.planned_start = fmtDt(slot);
    a.planned_date = datePartFromDatetime(a.planned_start);
    a.planned_end = fmtDt(slot + a.planned_minutes * 60000);
    return { shifted: true, to: a.planned_start };
  }
  return {};
}

export function createActivity(db, { title, note, plan_ids, planned_date = null, planned_start = null, planned_minutes = 0, repeat = null, repeat_until = null, theme = null, keep_conflict = false }) {
  if (!title || !title.trim()) return fail('活动名称必填');
  const ids = plan_ids || [];
  for (const pid of ids) if (!db.plans.some((p) => p.id === pid)) return fail('关联计划不存在');
  const a = newActivity({
    title: title.trim(), note: (note || '').trim(), plan_ids: ids,
    planned_date: planned_start ? datePartFromDatetime(planned_start) : (planned_date || null),
    planned_start: planned_start || null,
    planned_minutes: Number(planned_minutes) || 0,
    repeat, repeat_until: repeat_until || null, theme: theme || null,
  });
  a.id = nextId(db, 'a');
  db.activities.push(a);
  const atom = applyAtomicity(db, a, { keepConflict: !!keep_conflict }); // 入库后跑原子性（排除自身）
  return ok(atom);
}

export function updateActivity(db, id, { title, note, plan_ids, planned_date, planned_start, planned_minutes, repeat, repeat_until, theme, keep_conflict }) {
  const a = db.activities.find((x) => x.id === id);
  if (!a) return fail('活动不存在');
  if (!title || !title.trim()) return fail('活动名称必填');
  a.title = title.trim(); a.note = (note || '').trim();
  let atom = {};
  if (plan_ids) {
    for (const pid of plan_ids) if (!db.plans.some((p) => p.id === pid)) return fail('关联计划不存在');
    a.plan_ids = plan_ids;
  }
  if (planned_start !== undefined) {
    a.planned_start = planned_start || null;
    a.planned_date = planned_start ? datePartFromDatetime(planned_start) : null;
  } else if (planned_date !== undefined) {
    a.planned_date = planned_date;
  }
  if (planned_minutes !== undefined) a.planned_minutes = Number(planned_minutes) || 0;
  // 时间窗被触碰 → 重跑原子性（顺延或按 keep_conflict 捆绑；挪走则自动解除旧捆绑）
  if (planned_start !== undefined || planned_minutes !== undefined) {
    atom = applyAtomicity(db, a, { keepConflict: !!keep_conflict });
  }
  if (repeat !== undefined) {
    const hadRepeat = !!a.repeat;
    a.repeat = repeat || null;
    a.repeat_until = repeat_until !== undefined ? (repeat_until || null) : a.repeat_until;
    // 完成后补设循环：完成瞬间不会触发 spawnRecurrence，这里补生成下一期，
    // 否则「做完才想起来要每天做」的链条永远无法开始。
    if (!hadRepeat && a.repeat && (a.status === 'Completed' || a.status === 'Reviewed')) {
      const before = db.activities.length;
      spawnRecurrence(db, a);
      return ok({ spawned: db.activities.length > before, ...atom });
    }
  }
  if (repeat_until !== undefined) a.repeat_until = repeat_until || null;
  if (theme !== undefined) a.theme = theme || null;
  return ok(atom);
}

export function deleteActivity(db, id) {
  const a = db.activities.find((x) => x.id === id);
  if (!a) return fail('活动不存在');
  if (a.status !== 'Planned') return fail('仅 Planned 状态可删除');
  db.activities = db.activities.filter((x) => x.id !== id);
  db.txs = db.txs.filter((t) => !(t.source_type === 'activity' && t.source_id === id));
  db.outputs = db.outputs.filter((o) => o.activity_id !== id);
  return ok();
}

// 活动级联删除影响（供确认提示）
export function activityDeleteImpact(db, id) {
  const outIds = new Set(db.outputs.filter((o) => o.activity_id === id).map((o) => o.id));
  return {
    outs: outIds.size,
    vfs: db.valueflows.filter((v) => outIds.has(v.output_id)).length,
    txs: db.txs.filter((t) => (t.source_type === 'activity' && t.source_id === id)
      || (t.source_type === 'reversal' && db.txs.some((x) => x.source_type === 'activity' && x.source_id === id && x.id === t.source_id))
      || (t.source_type === 'valueflow' && outIds.has(t.source_id))).length,
  };
}

// 级联删除活动（任意状态）：活动 + 产出 + 价值流 + 相关流水/冲正
export function deleteActivityCascade(db, id) {
  const a = db.activities.find((x) => x.id === id);
  if (!a) return fail('活动不存在');
  removeActivityDeep(db, id);
  return ok();
}

// Planned → Started（不变量4：预算耗尽则禁止）。
// 原子性仲裁：存在排队中的捆绑对手（Planned 且窗口仍重叠）时，不直接启动，
// 返回结构化 conflict_choice 供 UI 弹三选一：先做这个 / 让对手先 / 取消。
export function startActivity(db, id, { override = null } = {}) {
  const a = db.activities.find((x) => x.id === id);
  if (!a) return fail('活动不存在');
  if (!checkTransition(ACTIVITY_TRANSITIONS, a.status, 'Started')) return fail(`仅 ${a.status} 可开始`);
  if (anyPlanBlocked(db, a.plan_ids)) return fail('⛔ 关联计划预算已耗尽，禁止开始');
  const rivals = (a.conflicts || [])
    .map((cid) => db.activities.find((x) => x.id === cid))
    .filter((x) => x && x.status === 'Planned'
      && windowsOverlap(activityWindow(a), activityWindow(x)));
  if (!override && rivals.length) {
    return ok({ conflict_choice: {
      self: { id: a.id, title: a.title },
      others: rivals.map((x) => ({ id: x.id, title: x.title })),
    } });
  }
  if (override === 'first') { // 先做这个：对手顺延到本活动结束后的最近空闲槽
    const myWin = activityWindow(a);
    for (const rv of rivals) {
      const rvMins = rv.planned_minutes || 30;
      const from = Math.max(parseDt(rv.planned_start), myWin ? myWin.end : Date.now());
      const slot = findFreeSlot(db, from, rvMins, a.id);
      rv.planned_start = fmtDt(slot);
      rv.planned_date = datePartFromDatetime(rv.planned_start);
      rv.planned_end = fmtDt(slot + rvMins * 60000);
      unlinkConflict(a, rv);
    }
  }
  if (override === 'defer') { // 让对手先：自己顺延到对手之后的最近空闲槽，仍为 Planned
    const myWin = activityWindow(a);
    const rivalEnds = rivals.map((x) => { const w = activityWindow(x); return w ? w.end : Date.now(); });
    const mins = a.planned_minutes || 30;
    const from = Math.max(myWin ? myWin.start : Date.now(), ...(rivalEnds.length ? rivalEnds : [Date.now()]));
    const slot = findFreeSlot(db, from, mins, a.id);
    a.planned_start = fmtDt(slot);
    a.planned_date = datePartFromDatetime(a.planned_start);
    a.planned_end = fmtDt(slot + mins * 60000);
    for (const rv of rivals) unlinkConflict(a, rv);
    return ok({ moved_to: a.planned_start });
  }
  a.actual_start = Date.now();
  a.status = 'Started';
  return ok();
}

// Started → Completed（不变量2 + 不变量4）。
// 原子创建「支出(credit) + 收入(debit)」两笔流水（至少一笔）+ 产出。
// expense/income: { resource_id, amount, note } | null
export function completeActivity(db, id, { expense = null, income = null, output_title, output_tags }) {
  const a = db.activities.find((x) => x.id === id);
  if (!a) return fail('活动不存在');
  if (a.status !== 'Started') return fail('仅 Started 可完成');
  if (anyPlanBlocked(db, a.plan_ids)) return fail('⛔ 关联计划预算已耗尽，禁止完成');
  const hasExpense = !!(expense && Number(expense.amount) > 0);
  const hasIncome = !!(income && Number(income.amount) > 0);
  if (!hasExpense && !hasIncome) return fail('必须至少登记一笔收支流水');
  if (!output_title || !output_title.trim()) return fail('产出标题必填');
  if (hasExpense && !resourceOf(db, expense.resource_id)) return fail('支出资源不存在');
  if (hasIncome && !resourceOf(db, income.resource_id)) return fail('收入资源不存在');
  if (hasExpense) {
    db.txs.push({
      id: nextId(db, 't'), resource_id: expense.resource_id, debit: 0,
      credit: Number(expense.amount),
      source_type: 'activity', source_id: id, note: (expense.note || '').trim() || '支出',
      reversal_of: null, created: Date.now(),
    });
  }
  if (hasIncome) {
    db.txs.push({
      id: nextId(db, 't'), resource_id: income.resource_id, debit: Number(income.amount),
      credit: 0,
      source_type: 'activity', source_id: id, note: (income.note || '').trim() || '收入',
      reversal_of: null, created: Date.now(),
    });
  }
  const out = newOutput({ title: output_title.trim(), tags: output_tags || [], note: '' });
  out.id = nextId(db, 'o'); out.activity_id = id;
  db.outputs.push(out);
  a.actual_end = Date.now();
  a.status = 'Completed';
  spawnRecurrence(db, a);
  return ok();
}

// 循环任务：完成后自动生成下一期（Planned，沿用标题/计划/循环规则）
function spawnRecurrence(db, a) {
  if (!a.repeat) return;
  const nextDate = nextOccurrenceDate(a.planned_date, a.repeat);
  if (a.repeat_until && dateKey(nextDate) > dateKey(a.repeat_until)) return;
  const na = newActivity({
    title: a.title, note: a.note, plan_ids: [...a.plan_ids],
    planned_date: nextDate, planned_minutes: a.planned_minutes,
    repeat: a.repeat, repeat_until: a.repeat_until || null,
  });
  // 计划开始时间（分钟级）带到下一期：日期换成 nextDate，时间不变
  if (a.planned_start) {
    const t = timePartFromDatetime(a.planned_start);
    na.planned_start = t ? `${nextDate.replace(/-/g, '-')}T${t}` : null;
  }
  na.id = nextId(db, 'a');
  db.activities.push(na);
  applyAtomicity(db, na, {}); // 下一期撞车也自动顺延（循环生成同样遵守时间原子性）
}

// 后续状态：Completed → Reviewed → Archived（决策 8C）
export function setActivityStatus(db, id, next) {
  const a = db.activities.find((x) => x.id === id);
  if (!a) return fail('活动不存在');
  if (!checkTransition(ACTIVITY_TRANSITIONS, a.status, next)) return fail(`非法流转：${a.status} → ${next}`);
  if (next === 'Completed') {
    // 直接到 Completed 的兜底校验（正常路径应走 completeActivity）
    if (!activityHasTx(db, id)) return fail('⛔ 完成必须已有资源流水（不变量2）');
    if (!activityHasOutput(db, id)) return fail('⛔ 完成必须已有产出（不变量2）');
    if (anyPlanBlocked(db, a.plan_ids)) return fail('⛔ 关联计划预算已耗尽');
    a.actual_end = Date.now();
  }
  a.status = next;
  return ok();
}

// ---------- 产出 (Output) ----------

// 决策 12B/13B：Draft→Published→Archived；归档自动生成 ValueFlow(Pending, +7天)
export function setOutputStatus(db, id, next) {
  const o = db.outputs.find((x) => x.id === id);
  if (!o) return fail('产出不存在');
  if (!checkTransition(OUTPUT_TRANSITIONS, o.status, next)) return fail(`非法流转：${o.status} → ${next}`);
  if (next === 'Archived') {
    db.valueflows.push({
      id: nextId(db, 'v'), output_id: o.id,
      giver: '', receiver: '', // 决策 14C：可后续补录双向交换对象
      status: 'Pending', expected: Date.now() + VF_EXPECT_MS,
      feedback: '', created: Date.now(),
    });
  }
  o.status = next;
  return ok();
}

// ---------- 流水 (ResourceTransaction) ----------

// 不变量5 / 决策 6B：绝对禁止 UPDATE/DELETE；更正 = 追加冲正流水（reversal_of 指向原单）
export function reverseTx(db, id, { amount, reason }) {
  const orig = db.txs.find((x) => x.id === id);
  if (!orig) return fail('流水不存在');
  if (orig.reversal_of) return fail('被冲正的流水不可再次冲正');
  const amt = Number(amount);
  if (!(amt > 0)) return fail('冲正金额必须 > 0');
  const max = orig.debit || orig.credit;
  if (amt > max) return fail(`冲正金额不能超过原金额 ${max}`);
  db.txs.push({
    id: nextId(db, 't'), resource_id: orig.resource_id,
    debit: orig.credit ? amt : 0, credit: orig.debit ? amt : 0,
    source_type: 'reversal', source_id: orig.id,
    note: `${(reason || '').trim() || '冲正'}（冲正 ${orig.id}）`,
    reversal_of: orig.id, created: Date.now(),
  });
  return ok();
}

// ---------- 价值流 (ValueFlow) ----------

// 决策 16BC：Pending/Overdue → 录入反馈 → Closed；可选回充资源（决策 15C）
export function closeValueflow(db, id, { feedback, recharge }) {
  const v = db.valueflows.find((x) => x.id === id);
  if (!v) return fail('价值流不存在');
  if (v.status === 'Closed') return fail('该价值流已闭环');
  v.feedback = (feedback || '').trim();
  v.status = 'Closed';
  if (recharge) {
    const token = db.resources.find((r) => r.name === '价值元') || db.resources[0];
    if (token) {
      db.txs.push({
        id: nextId(db, 't'), resource_id: token.id, debit: VF_RECHARGE, credit: 0,
        source_type: 'valueflow', source_id: v.id, note: `价值流回充 +${VF_RECHARGE}`,
        reversal_of: null, created: Date.now(),
      });
    }
  }
  return ok();
}

``



================================================
FILE: C:\Users\qu\Desktop\物理科学与技术论题\TS2\personal-erp\src\domain\entities.js
================================================

```javascript
// ============================================================
// domain/entities.js
// 领域层：聚合根定义、状态机常量与合法流转表（纯数据，无副作用）
// 依据：测试.md 冻结决策 1B~19BC + 5 条全局不变量
// ============================================================

// ---- 资源 (Resource) -------------------------------------------------
// 决策：多资源账户 + 可自定义；余额 = initial + Σ(debit) − Σ(credit)（不变量1）
export const RESOURCE_STATES = ['Active', 'Inactive'];

// ---- 活动 (Activity) -------------------------------------------------
// 决策 8C：严格五态（含审计关门）
export const ACTIVITY_STATES = ['Planned', 'Started', 'Completed', 'Reviewed', 'Archived'];
export const ACTIVITY_TRANSITIONS = {
  Planned: ['Started'],
  Started: ['Completed'],
  Completed: ['Reviewed'],
  Reviewed: ['Archived'],
};

// ---- 计划 (Plan) -----------------------------------------------------
// 决策 18C：终身演进态（含孵化）
export const PLAN_STATES = ['Incubating', 'Active', 'Paused', 'Completed', 'Archived'];
export const PLAN_TRANSITIONS = {
  Incubating: ['Active'],
  Active: ['Paused', 'Completed', 'Archived'],
  Paused: ['Active', 'Completed', 'Archived'],
};

// ---- 产出 (Output) ---------------------------------------------------
// 决策 12B：独立生命周期
export const OUTPUT_STATES = ['Draft', 'Published', 'Archived'];
export const OUTPUT_TRANSITIONS = {
  Draft: ['Published'],
  Published: ['Archived'],
};

// ---- 价值流 (ValueFlow) ----------------------------------------------
// 决策 16BC：Pending → Closed / Overdue（Overdue 由 expected 派生）
export const VF_STATES = ['Pending', 'Closed', 'Overdue'];

// ---- 流水方向 ---------------------------------------------------------
export const DIR_CONSUME = 'credit'; // 消耗（支出）
export const DIR_GAIN = 'debit';     // 获得（收入）

// 价值流回充额度（决策 15C）
export const VF_RECHARGE = 10;

// 产出归档后 ValueFlow 默认期望反馈周期（决策 13B/16C）：7 天
export const VF_EXPECT_MS = 7 * 24 * 3600 * 1000;

// ---- 商品 (Good) -------------------------------------------------
// 决策：LifeUp 式快速消费——预设商品，一键扣减资源余额（生成 credit 流水）
export const GOOD_STATES = ['Active', 'Inactive'];

export function newGood({ name, emoji = '🛍️', costs = [], note = '' }) {
  return { name, emoji, costs, note, status: 'Active', created: Date.now() };
}

// ---- ID 生成 ----------------------------------------------------------
// 为每个聚合根维护独立自增序号：db.seq[key] 递增
export function nextId(db, key) {
  db.seq[key] = (db.seq[key] || 0) + 1;
  return key + db.seq[key];
}

// ---- 通用实体工厂 -----------------------------------------------------
export function newActivity({ title, note = '', plan_ids = [], planned_date = null, planned_start = null, planned_minutes = 0, repeat = null, repeat_until = null, time_logs = [], theme = null }) {
  return {
    title,
    note,
    plan_ids,
    planned_date,       // YYYY-M-D（计划日期，供日历/循环；由 planned_start 推导）
    planned_start,      // 计划开始时间，精确到分钟：YYYY-MM-DDTHH:MM（可空）
    planned_minutes,    // 计划投入分钟
    repeat,             // 循环：null | 'daily' | 'weekday' | 'weekly' | 'monthly'
    repeat_until,       // 循环结束日（YYYY-M-D / YYYY-MM-DD，可空=一直循环）
    time_logs,          // 按任务计时 [{ start, end? }]，未关 end 表示运行中
    theme,              // 卡片虚化主题背景：null | {type:'gradient'|'image', value/url}
    conflicts: [],      // 冲突捆绑：显式保留的时间重叠对手 id 列表（执行时仲裁）
    actual_start: null, // 实际开始时间戳（决策 9B 实际坐标）
    actual_end: null,
    status: 'Planned',
    created: Date.now(),
  };
}

export function newOutput({ title, tags = [], note = '' }) {
  return { title, tags, note, status: 'Draft', created: Date.now() };
}

export function newPlan({ goal_id, title, budget = null, color = null }) {
  return { goal_id, title, budget, color, status: 'Incubating', created: Date.now() };
}

export function newGoal({ title, desc = '' }) {
  return { title, desc, created: Date.now() };
}

export function newResource({ name, unit = '', initial = 0, color = null }) {
  return { name, unit, initial, color, status: 'Active', created: Date.now() };
}

export function newRule({ label, from, to, rate }) {
  return { label, from, to, rate, status: 'Active', created: Date.now() };
}

```



================================================
FILE: C:\Users\qu\Desktop\物理科学与技术论题\TS2\personal-erp\src\domain\importMerge.js
================================================

```javascript
// ============================================================
// domain/importMerge.js
// 增量合并导入（纯函数，可测试）：
//   - 同名资源 → 复用现有账户（其流水/规则引用重映射到已有 id，不新增）
//   - 其余实体 → 按 id 去重追加（已有 id 跳过）
// ============================================================
import { ensureSeq } from '../store/db.js';

export function inspectImport(db, incoming) {
  const byName = new Set(db.resources.map((r) => r.name));
  const all = incoming.resources || [];
  const sameRes = all.filter((r) => byName.has(r.name)).length;
  const nNew = (key) => {
    const have = new Set((db[key] || []).map((x) => x.id));
    return (incoming[key] || []).filter((x) => !have.has(x.id)).length;
  };
  return {
    newRes: all.length - sameRes, sameRes,
    rules: nNew('rules'), goals: nNew('goals'), plans: nNew('plans'),
    activities: nNew('activities'), txs: nNew('txs'),
    outputs: nNew('outputs'), valueflows: nNew('valueflows'),
    goods: nNew('goods'),
  };
}

export function mergeImport(db, incoming) {
  const resMap = {};
  const byName = new Map(db.resources.map((r) => [r.name, r]));
  let addedRes = 0, reusedRes = 0;
  for (const ir of incoming.resources || []) {
    const ex = byName.get(ir.name);
    if (ex) { resMap[ir.id] = ex.id; reusedRes++; }
    else {
      const copy = { ...ir, id: 'r' + ((db.seq.r = (db.seq.r || 0) + 1)) };
      db.resources.push(copy);
      byName.set(copy.name, copy);
      resMap[ir.id] = copy.id;
      addedRes++;
    }
  }
  const remap = (id) => resMap[id] || id;
  const pushNew = (arr, list) => {
    const have = new Set(arr.map((x) => x.id));
    let n = 0;
    for (const item of list || []) if (!have.has(item.id)) { arr.push(item); n++; }
    return n;
  };
  const counts = {
    rules: pushNew(db.rules, (incoming.rules || []).map((r) => ({ ...r, from: remap(r.from), to: remap(r.to) }))),
    goals: pushNew(db.goals, incoming.goals),
    plans: pushNew(db.plans, incoming.plans),
    activities: pushNew(db.activities, incoming.activities),
    outputs: pushNew(db.outputs, incoming.outputs),
    valueflows: pushNew(db.valueflows, incoming.valueflows),
    txs: pushNew(db.txs, (incoming.txs || []).map((t) => ({ ...t, resource_id: remap(t.resource_id) }))),
    goods: pushNew(db.goods, incoming.goods),
  };
  ensureSeq(db);
  return { addedRes, reusedRes, ...counts };
}

```



================================================
FILE: C:\Users\qu\Desktop\物理科学与技术论题\TS2\personal-erp\src\main.js
================================================

``javascript
// ============================================================
// main.js
// 装配根：db(store) + engine(domain) + views(ui) → window.App
// 自包含单机应用：无后端，数据在 localStorage。
// ============================================================
import { loadDB, saveDB, resetDB, ensureSeq } from './store/db.js';
import { Prefs } from './store/prefs.js';
import { bgStyle } from './ui/themes.js';
import { openModal, toast, esc } from './ui/helpers.js';
import * as engine from './domain/engine.js';
import { Widget } from './services/widget.js';
import { System } from './services/system.js';
import { Notifications } from './services/notifications.js';
import { Backup } from './services/backup.js';
import { Scheduler } from './services/scheduler.js';
import { Sync } from './services/sync.js';
import { renderTopbar, renderTabs } from './views/topbar.js';
import * as overview from './views/overview.js';
import * as goals from './views/goals.js';
import * as stats from './views/stats.js';
import * as calendar from './views/calendar.js';
import * as timer from './views/timer.js';
import * as setup from './views/setup.js';

// 桌面小组件快照（预留接口的数据来源）
function widgetSnapshot(App) {
  const { db, engine } = App;
  const today = new Date();
  const todayKey = `${today.getFullYear()}-${today.getMonth() + 1}-${today.getDate()}`;
  return {
    balances: db.resources.filter((r) => r.status === 'Active').map((r) => ({
      id: r.id, name: r.name, unit: r.unit, value: engine.balanceOf(db, r.id),
    })),
    todayActivities: db.activities.filter((a) =>
      (a.actual_start ? new Date(a.actual_start) : (a.planned_date ? new Date(a.planned_date + 'T00:00') : null)) &&
      (a.actual_start ? (() => {
        const d = new Date(a.actual_start);
        return d.getFullYear() === today.getFullYear() && d.getMonth() === today.getMonth() && d.getDate() === today.getDate();
      })() : a.planned_date === todayKey)
    ).length,
    nextActivity: (() => {
      const list = db.activities.filter((a) => a.status === 'Planned' || a.status === 'Started');
      if (!list.length) return null;
      return { title: list[0].title, status: list[0].status };
    })(),
    pendingValueFlows: db.valueflows.filter((v) => engine.vfStatus(db, v) !== 'Closed').length,
  };
}

const TAB_VIEWS = { overview, goals, stats };
const TAB_ORDER = ['overview', 'goals', 'stats'];

const App = {
  db: loadDB(),
  engine,
  tab: 'overview',
  // 系统服务接口（预留：小组件 / 系统提示 / 系统通知 / 备份）
  widget: Widget, system: System, notifications: Notifications, backup: Backup, sync: Sync,
  // 视图扁平暴露给内联 handler（App.calendar.open() 等）
  overview, goals, stats, calendar, timer,
  setTab(id) { this.tab = id; this.render(true); window.scrollTo({ top: 0 }); },
  // 统一启动入口：撞上捆绑冲突时弹三选一仲裁（先做这个 / 让对方先 / 取消）
  startAct(id) {
    const r = this.engine.startActivity(this.db, id);
    if (!r.ok) { toast(r.error, 'err'); return; }
    if (r.conflict_choice) {
      const c = r.conflict_choice;
      const names = c.others.map((o) => `「${esc(o.title)}」`).join('、');
      const m = openModal({
        title: '⏱ 时间冲突',
        bodyHTML: `<p>「${esc(c.self.title)}」与 ${names} 时间重叠（捆绑对）。</p><p class="muted">谁先做？</p>`,
        footerHTML: `<button class="btn" data-cancel>取消</button><button class="btn" data-defer>让对方先</button><button class="btn primary" data-first>先做这个</button>`,
      });
      m.q('[data-cancel]').onclick = () => m.close();
      m.q('[data-first]').onclick = () => {
        const rr = this.engine.startActivity(this.db, id, { override: 'first' });
        m.close();
        if (!rr.ok) return toast(rr.error, 'err');
        toast(`已开始；${names} 自动顺延`, 'ok');
        this.refresh();
      };
      m.q('[data-defer]').onclick = () => {
        const rr = this.engine.startActivity(this.db, id, { override: 'defer' });
        m.close();
        if (!rr.ok) return toast(rr.error, 'err');
        toast(`已改约至 ${(rr.moved_to || '').replace('T', ' ')}`, 'ok');
        this.refresh();
      };
      return; // 仲裁中无状态变化，不刷新
    }
    this.refresh();
  },
  // 应用全局背景主题（图片/渐变）：原样铺底，不做蒙层处理
  applyGlobalTheme() {
    document.body.style.background = bgStyle(Prefs.load().globalTheme || null) || '';
  },
  // 刷新保留滚动位置，避免点击后页面跳顶/脱离焦点；不重放入场动画
  refresh() {
    const sy = window.scrollY;
    this.render(false);
    requestAnimationFrame(() => window.scrollTo(0, sy));
  },
  async reset() {
    if (!(await System.confirm({ title: '重置数据', message: '清空全部数据并恢复演示数据？' }))) return;
    this.db = resetDB();
    this.render(true);
    window.scrollTo({ top: 0 });
  },
  // 从备份导入：替换库并修复 seq
  restore(db) {
    ensureSeq(db);
    this.db = db;
    this.render(true);
    window.scrollTo({ top: 0 });
  },
  // 增量合并导入：同名资源复用现有账户，其余按 id 去重追加
  merge(incoming) {
    this.db = Backup.merge(this.db, incoming);
    this.render(true);
  },
  render(animate) {
    saveDB(this.db); // 每次变更后持久化（单机自包含）
    this.applyGlobalTheme();
    renderTopbar(this);
    const content = document.getElementById('content');
    content.classList.toggle('anim-in', !!animate);
    // 首次初始化：无资源 → 引导配置资源
    const tabsEl = document.getElementById('tabs');
    if (!this.db.resources.length) {
      tabsEl.style.display = 'none';
      content.innerHTML = '';
      setup.render(this, content);
      Widget.push(widgetSnapshot(this));
      Scheduler.syncValueflowNotifs(this.db);
      return;
    }
    tabsEl.style.display = '';
    renderTabs(this);
    content.innerHTML = '';
    const view = TAB_VIEWS[this.tab] || overview;
    view.render(this, content);
    Widget.push(widgetSnapshot(this)); // 维护小组件快照（预留）
    Widget.refreshNative();
    Scheduler.syncValueflowNotifs(this.db); // 待反馈价值流系统通知（16C）
    Scheduler.syncAutoBackup(this.db);      // 定时自动备份（本地保存）
  },
};

// Tab 左右滑动切换（活动 ⇄ 目标与计划 ⇄ 统计）
(function setupSwipe() {
  const content = document.getElementById('content');
  let start = null;
  content.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1) { start = null; return; }
    if (e.target.closest('.modal-mask, .timer-overlay, input, select, textarea, .modal-panel, .dash-pager')) { start = null; return; }
    start = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  }, { passive: true });
  content.addEventListener('touchend', (e) => {
    if (!start) return;
    const dx = e.changedTouches[0].clientX - start.x;
    const dy = e.changedTouches[0].clientY - start.y;
    start = null;
    if (Math.abs(dx) > 64 && Math.abs(dx) > Math.abs(dy) * 1.4) {
      const idx = TAB_ORDER.indexOf(App.tab);
      const next = dx < 0 ? idx + 1 : idx - 1; // 左滑 → 下一个；右滑 → 上一个
      if (TAB_ORDER[next]) App.setTab(TAB_ORDER[next]);
    }
  }, { passive: true });
})();

window.App = App;

// 双向同步（原生 → JS）：启动与每次回前台时，若桌面小组件独立操作过（rev 变大），
// 用原生数据覆盖本地并重渲染。pushData 的 txs 合并负责反方向，二者互补成闭环。
async function syncFromNative() {
  try {
    const r = await Widget.pullFromNative();
    if (r.changed) App.render(false);
  } catch (e) {}
}
syncFromNative();
document.addEventListener('visibilitychange', () => { if (!document.hidden) syncFromNative(); });

// 计时器跨进程恢复：被杀后台后按时间戳相对计时，重启自动接续；
// restoreNative 兜底 WebView 存储被系统清理的场景（从 SharedPreferences 回捞）
timer.restore();
timer.restoreNative();

// 桌面小组件点击跳转：MainActivity 触发 window 事件，切到对应 Tab（fresh=直接弹新建）
window.addEventListener('erpLaunchTab', (e) => {
  const d = e.detail || {};
  if (d.tab && TAB_ORDER.includes(d.tab)) App.setTab(d.tab);
  if (d.fresh) setTimeout(() => overview.openActModal(), 350);
});

App.render(true);

``



================================================
FILE: C:\Users\qu\Desktop\物理科学与技术论题\TS2\personal-erp\src\services\backup.js
================================================

``javascript
// ============================================================
// services/backup.js
// 数据备份 / 恢复（自包含数据安全）：
//   export：native 写入 Documents/backups（本地保存，不再调分享）；web 触发 JSON 下载
//   exportLocal：静默本地备份（定时自动备份用）——native 写 Documents/backups；web 存 localStorage 备份历史
//   import：隐藏 file input（Capacitor WebView 自动调起系统文件选择器）
// 备份文件契约：{ app:'personal-erp', version:1, exportedAt, db:{...} }
// ============================================================
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { inspectImport, mergeImport } from '../domain/importMerge.js';
import { Prefs } from '../store/prefs.js';
import { toast } from '../ui/helpers.js';

const NATIVE = () => Capacitor.isNativePlatform();
const WEB_BACKUP_KEY = 'personal_erp_backups'; // web 端本地备份历史（保留最近 10 份）
const MAX_WEB_BACKUPS = 10;

function dbShapeOK(d) {
  return d && Array.isArray(d.resources) && Array.isArray(d.rules) && Array.isArray(d.goals)
    && Array.isArray(d.plans) && Array.isArray(d.activities) && Array.isArray(d.txs)
    && Array.isArray(d.outputs) && Array.isArray(d.valueflows)
    && (!d.goods || Array.isArray(d.goods)); // 兼容旧备份（无 goods 字段）
}

// 备份文件名：PersonalERP_backup_YYYYMMDD_HHMM.json（分钟级，避免同日覆盖）
function backupFilename() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `PersonalERP_backup_${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}.json`;
}

export const Backup = {
  serialize(db) {
    return JSON.stringify({ app: 'personal-erp', version: 1, exportedAt: new Date().toISOString(), db }, null, 2);
  },

  // 校验并解析备份内容 → { ok, db } | { ok:false, error }
  parse(text) {
    try {
      const obj = JSON.parse(text);
      if (obj && obj.app === 'personal-erp' && obj.db && dbShapeOK(obj.db)) {
        return { ok: true, db: obj.db };
      }
      if (dbShapeOK(obj)) return { ok: true, db: obj };
      return { ok: false, error: '不是有效的 Personal ERP 备份文件' };
    } catch (e) {
      return { ok: false, error: `JSON 解析失败：${e.message}` };
    }
  },

  // 手动导出：native 本地保存（Documents/backups，不调分享）；web 触发 JSON 下载
  async export(db) {
    const json = this.serialize(db);
    const filename = backupFilename();
    if (NATIVE()) {
      try {
        await Filesystem.writeFile({
          path: `backups/${filename}`, data: json, directory: Directory.Documents, recursive: true,
        });
        Prefs.set({ lastAutoBackup: Date.now() });
        toast(`备份已保存到本地：Documents/backups/${filename}`);
      } catch (e) {
        toast(`导出失败：${e.message || '未知错误'}`, 'err');
      }
      return;
    }
    const blob = new Blob([json], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    Prefs.set({ lastAutoBackup: Date.now() });
    toast('备份已下载');
  },

  // 静默本地备份（定时自动备份用）：native 写 Documents/backups；web 存 localStorage 备份历史
  // 返回 { ok, filename } | { ok:false, error }
  async exportLocal(db) {
    const json = this.serialize(db);
    const filename = backupFilename();
    if (NATIVE()) {
      try {
        await Filesystem.writeFile({
          path: `backups/${filename}`, data: json, directory: Directory.Documents, recursive: true,
        });
        Prefs.set({ lastAutoBackup: Date.now() });
        return { ok: true, filename };
      } catch (e) {
        return { ok: false, error: e.message || '写入失败' };
      }
    }
    try {
      const list = JSON.parse(localStorage.getItem(WEB_BACKUP_KEY) || '[]');
      list.push({ filename, exportedAt: new Date().toISOString(), data: json });
      while (list.length > MAX_WEB_BACKUPS) list.shift();
      localStorage.setItem(WEB_BACKUP_KEY, JSON.stringify(list));
      Prefs.set({ lastAutoBackup: Date.now() });
      return { ok: true, filename };
    } catch (e) {
      return { ok: false, error: e.message || '本地存储失败' };
    }
  },

  // 最近一次本地备份时间（web 端从备份历史读；原生端由 Prefs.lastAutoBackup 记录）
  lastLocalBackup() {
    if (NATIVE()) return null;
    try {
      const list = JSON.parse(localStorage.getItem(WEB_BACKUP_KEY) || '[]');
      return list.length ? list[list.length - 1].exportedAt : null;
    } catch (e) { return null; }
  },

  // 调起文件选择，读取后回调 onDone(parsedDb)
  importFromFile(onDone) {
    let input = document.getElementById('erp-import-input');
    if (!input) {
      input = document.createElement('input');
      input.id = 'erp-import-input';
      input.type = 'file';
      input.accept = 'application/json,.json';
      input.style.display = 'none';
      document.body.appendChild(input);
    }
    input.onchange = () => {
      const file = input.files && input.files[0];
      input.value = '';
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        const res = Backup.parse(String(reader.result));
        if (!res.ok) return toast(res.error, 'err');
        onDone(res.db);
      };
      reader.onerror = () => toast('读取文件失败', 'err');
      reader.readAsText(file);
    };
    input.click();
  },

  // 预览：统计将新增 / 同名复用数量（供导入确认）
  inspect: inspectImport,
  // 增量合并导入（同名资源复用，其余按 id 去重）
  merge: mergeImport,
};

``



================================================
FILE: C:\Users\qu\Desktop\物理科学与技术论题\TS2\personal-erp\src\services\notifications.js
================================================

``javascript
// ============================================================
// services/notifications.js
// 系统通知接口（预留/已实现双层）：
//   native：@capacitor/local-notifications（Android 系统通知，后台/锁屏/杀进程仍触发）
//   web   ：Web Notification API → 失败回退应用内 toast
// 业务代码只依赖本模块，不直接 import 插件，便于替换实现。
// ============================================================
import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import { toast } from '../ui/helpers.js';

const NATIVE = () => Capacitor.isNativePlatform();
let receivedHandler = null;

export const Notifications = {
  isNative: NATIVE,

  // 请求系统通知权限
  async requestPermission() {
    if (NATIVE()) {
      try { await LocalNotifications.requestPermissions(); } catch (e) {}
      return;
    }
    if ('Notification' in window && Notification.permission === 'default') {
      try { await Notification.requestPermission(); } catch (e) {}
    }
  },

  // 调度一条系统通知。at 为 Date；省略则立即发出。
  async schedule({ id, title, body, at }) {
    if (NATIVE()) {
      try {
        await LocalNotifications.schedule({
          notifications: [{ id, title, body, schedule: at ? { at } : undefined }],
        });
      } catch (e) { /* 权限被拒则静默 */ }
      return;
    }
    // Web 无法定时调度未来通知：静默跳过（避免调度器在 web 上每次渲染弹 toast）
    if (at && at.getTime() > Date.now()) return;
    // Web 立即通知：Notification API → 失败回退应用内提示
    if ('Notification' in window && Notification.permission === 'granted') {
      try { new Notification(title, { body }); return; } catch (e) {}
    }
    toast(`${title} · ${body}`);
  },

  // 取消一条已调度的通知
  async cancel(id) {
    if (NATIVE()) {
      try { await LocalNotifications.cancel({ notifications: [{ id }] }); } catch (e) {}
    }
  },

  // 注册通知触发回调（native：通知到达；web：暂无）
  onReceived(cb) {
    if (NATIVE()) {
      LocalNotifications.addListener('localNotificationReceived', (n) => cb && cb(n));
    }
    receivedHandler = cb;
  },
};

export function __notifyFallback(title, body) {
  if (receivedHandler) receivedHandler({ title, body });
}

``



================================================
FILE: C:\Users\qu\Desktop\物理科学与技术论题\TS2\personal-erp\src\services\scheduler.js
================================================

``javascript
// ============================================================
// services/scheduler.js
// 系统调度器：
//   syncValueflowNotifs —— 为「待反馈价值流」在期望日期调度一条系统通知（决策 16C）。
//   syncAutoBackup     —— 定时自动备份：按 Prefs.autoBackupEvery（小时）周期静默本地备份。
// 幂等：已调度的在 localStorage 登记，关闭/移除即取消，不重复弹。
// ============================================================
import { Notifications } from './notifications.js';
import { Prefs } from '../store/prefs.js';
import { Backup } from './backup.js';

const TRACK_KEY = 'scheduled_vf_notifs';
const NOTIF_BASE = 2000;

function loadTracked() {
  try { return JSON.parse(localStorage.getItem(TRACK_KEY) || '{}'); } catch (e) { return {}; }
}
function saveTracked(t) {
  try { localStorage.setItem(TRACK_KEY, JSON.stringify(t)); } catch (e) {}
}

// 价值流 id → 稳定数字通知 id（local-notifications 需要 Int）
function vfNotifId(vfId) {
  return NOTIF_BASE + (parseInt(String(vfId).replace(/\D/g, ''), 10) || 0);
}

export const Scheduler = {
  // 每次 App 渲染后调用，维护「待反馈价值流」的系统通知
  syncValueflowNotifs(db) {
    const tracked = loadTracked();
    const desired = {}; // notifId(string) -> vfId
    const now = Date.now();
    for (const v of db.valueflows) {
      if (v.status === 'Closed') continue;      // 已闭环，无需提醒
      if (v.expected <= now) continue;           // 已逾期（派生状态），不再提醒
      const nid = String(vfNotifId(v.id));
      desired[nid] = v.id;
    }
    // 新出现 → 调度
    for (const nid of Object.keys(desired)) {
      if (nid in tracked) continue;
      const vf = db.valueflows.find((x) => x.id === desired[nid]);
      const out = db.outputs.find((o) => o.id === vf.output_id);
      Notifications.schedule({
        id: Number(nid),
        title: '价值流待反馈',
        body: `产出「${(out && out.title) || vf.output_id}」待反馈，记得回 App 闭环`,
        at: new Date(vf.expected),
      });
      tracked[nid] = desired[nid];
    }
    // 已移除/已闭环 → 取消
    for (const nid of Object.keys(tracked)) {
      if (!(nid in desired)) {
        Notifications.cancel(Number(nid));
        delete tracked[nid];
      }
    }
    saveTracked(tracked);
  },

  // 定时自动备份：到点则静默本地备份一次（native 写 Documents/backups；web 存 localStorage 历史）
  async syncAutoBackup(db) {
    const p = Prefs.load();
    if (!p.autoBackup) return;
    const every = Number(p.autoBackupEvery) || 24; // 小时
    const last = Number(p.lastAutoBackup) || 0;
    if (Date.now() - last < every * 3600 * 1000) return;
    await Backup.exportLocal(db); // 成功时内部更新 lastAutoBackup；失败则下次渲染再试
  },
};

``



================================================
FILE: C:\Users\qu\Desktop\物理科学与技术论题\TS2\personal-erp\src\services\sync.js
================================================

``javascript
// ============================================================
// services/sync.js
// 局域网同步：通过 FastAPI 单文件服务（sync_server.py）推送/拉取备份 JSON。
//   push：先比较服务器版本（exportedAt），服务器更新则返回 conflict，由用户决定覆盖
//   pull：GET 服务器最新备份，交给 stats.doImport 做增量合并或全量替换
// 冗余：服务端保留最近 10 份；本地备份历史保留最近 10 份（backup.js）
// ============================================================
import { Backup } from './backup.js';
import { Prefs } from '../store/prefs.js';
import { Capacitor } from '@capacitor/core';

export const Sync = {
  server() {
    return (Prefs.load().syncServer || '').trim().replace(/\/+$/, '');
  },
  setServer(url) {
    const v = (url || '').trim().replace(/\/+$/, '');
    Prefs.set({ syncServer: v });
    if (v) this.addHistory(v);
  },

  // 历史地址（最近 8 个，去重）
  history() {
    const h = Prefs.load().syncHistory;
    return Array.isArray(h) ? h : [];
  },
  addHistory(url) {
    const v = (url || '').trim().replace(/\/+$/, '');
    if (!v) return;
    const h = this.history().filter((x) => x !== v);
    h.unshift(v);
    Prefs.set({ syncHistory: h.slice(0, 8) });
  },

  // 自动检测本机局域网 IP：优先用页面访问地址（location.hostname），否则 WebRTC 探测
  async detectLocalIP() {
    const hn = location.hostname;
    if (hn && hn !== 'localhost' && hn !== '127.0.0.1' && /^\d+\.\d+\.\d+\.\d+$/.test(hn)) {
      return hn;
    }
    return new Promise((resolve) => {
      try {
        const pc = new RTCPeerConnection({ iceServers: [] });
        pc.createDataChannel('');
        pc.onicecandidate = (e) => {
          if (!e.candidate) { try { pc.close(); } catch (x) {} resolve(null); return; }
          const m = /([0-9]{1,3}(\.[0-9]{1,3}){3})/.exec(e.candidate.candidate);
          if (m) {
            const ip = m[1];
            if (!ip.startsWith('127.') && !ip.startsWith('169.254.')) {
              try { pc.close(); } catch (x) {}
              resolve(ip);
            }
          }
        };
        pc.createOffer().then((o) => pc.setLocalDescription(o)).catch(() => resolve(null));
        setTimeout(() => { try { pc.close(); } catch (x) {} resolve(null); }, 2500);
      } catch (e) { resolve(null); }
    });
  },

  // 启动命令（供一键复制）
  startCommand(port = 6920) {
    return `python sync_server.py --port ${port}`;
  },

  // ---- 安卓 App 内一键启动同步服务（手机当服务器）----
  nativeAvailable() {
    return Capacitor.isNativePlatform();
  },
  async startServer(port = 6920) {
    if (!this.nativeAvailable()) return { ok: false, error: '仅安卓 App 内支持' };
    try {
      const P = Capacitor.registerPlugin('Sync');
      const r = await P.start({ port });
      return { ok: true, running: r.running, port: r.port, ip: r.ip };
    } catch (e) { return { ok: false, error: e.message || '启动失败' }; }
  },
  async stopServer() {
    if (!this.nativeAvailable()) return { ok: false, error: '仅安卓 App 内支持' };
    try {
      const P = Capacitor.registerPlugin('Sync');
      await P.stop();
      return { ok: true };
    } catch (e) { return { ok: false, error: e.message || '停止失败' }; }
  },
  async serverStatus() {
    if (!this.nativeAvailable()) return { ok: false, running: false };
    try {
      const P = Capacitor.registerPlugin('Sync');
      const r = await P.status();
      return { ok: true, running: r.running, port: r.port, ip: r.ip };
    } catch (e) { return { ok: false, running: false }; }
  },

  async health() {
    const s = this.server();
    if (!s) return { ok: false, error: '未配置服务器地址' };
    try {
      const r = await fetch(`${s}/health`);
      return r.ok ? { ok: true } : { ok: false, error: `服务器响应 ${r.status}` };
    } catch (e) {
      return { ok: false, error: `无法连接：${e.message}` };
    }
  },

  // 推送当前数据到服务器。返回 { ok } | { ok:false, error } | { ok:false, conflict, server }
  async push(db) {
    const s = this.server();
    if (!s) return { ok: false, error: '未配置服务器地址' };
    const json = Backup.serialize(db);
    const mine = JSON.parse(json).exportedAt;
    try {
      // 防冲突（客户端先比较）：服务器更新则提示，不盲目覆盖
      const cur = await fetch(`${s}/backup`);
      if (cur.ok) {
        const serverObj = await cur.json();
        if (serverObj.exportedAt && serverObj.exportedAt > mine) {
          return { ok: false, conflict: true, server: serverObj };
        }
      }
      const r = await fetch(`${s}/backup`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: json,
      });
      if (r.status === 409) {
        const body = await r.json();
        return { ok: false, conflict: true, server: body.server };
      }
      if (!r.ok) return { ok: false, error: `推送失败：${r.status}` };
      Prefs.set({ lastSyncAt: Date.now() });
      return { ok: true };
    } catch (e) {
      return { ok: false, error: `无法连接：${e.message}` };
    }
  },

  // 强制覆盖服务器（用户已确认冲突）：跳过客户端比较，服务端 force=1 跳过冲突检查
  async pushForce(db) {
    const s = this.server();
    if (!s) return { ok: false, error: '未配置服务器地址' };
    const json = Backup.serialize(db);
    try {
      const r = await fetch(`${s}/backup?force=1`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: json,
      });
      if (!r.ok) return { ok: false, error: `推送失败：${r.status}` };
      Prefs.set({ lastSyncAt: Date.now() });
      return { ok: true };
    } catch (e) {
      return { ok: false, error: `无法连接：${e.message}` };
    }
  },

  // 拉取服务器最新备份。返回 { ok, db } | { ok:false, error }
  async pull() {
    const s = this.server();
    if (!s) return { ok: false, error: '未配置服务器地址' };
    try {
      const r = await fetch(`${s}/backup`);
      if (r.status === 404) return { ok: false, error: '服务器暂无备份' };
      if (!r.ok) return { ok: false, error: `拉取失败：${r.status}` };
      const text = await r.text();
      const res = Backup.parse(text);
      if (!res.ok) return { ok: false, error: res.error };
      Prefs.set({ lastSyncAt: Date.now() });
      return { ok: true, db: res.db };
    } catch (e) {
      return { ok: false, error: `无法连接：${e.message}` };
    }
  },
};
``



================================================
FILE: C:\Users\qu\Desktop\物理科学与技术论题\TS2\personal-erp\src\services\system.js
================================================

```javascript
// ============================================================
// services/system.js
// 系统提示 / 系统能力接口：
//   confirm/alert  原生 Dialog 插件（web 回退 window.confirm/alert）
//   vibrate        原生 Haptics（web 回退 navigator.vibrate）
//   keepAwake      标准 Web Wake Lock API（WebView 原生支持，无需插件）
//   onResume       App 回前台回调（@capacitor/app）
// 业务代码只依赖本模块，便于替换实现与预留新能力。
// ============================================================
import { Capacitor } from '@capacitor/core';
import { Dialog } from '@capacitor/dialog';
import { Haptics } from '@capacitor/haptics';
import { App } from '@capacitor/app';

const NATIVE = () => Capacitor.isNativePlatform();
let wakeLock = null;

export const System = {
  isNative: NATIVE,

  // 系统确认框 → Promise<boolean>
  async confirm({ title = '', message }) {
    if (NATIVE()) {
      try {
        const r = await Dialog.confirm({ title, message });
        return r.value;
      } catch (e) {}
    }
    return window.confirm(message);
  },

  // 系统提示框
  async alert({ title = '', message }) {
    if (NATIVE()) {
      try { await Dialog.alert({ title, message }); return; } catch (e) {}
    }
    window.alert(message);
  },

  // 震动反馈（完成/错误等）
  async vibrate(ms = 60) {
    if (NATIVE()) {
      try { await Haptics.vibrate({ duration: ms }); return; } catch (e) {}
    }
    if ('vibrate' in navigator) { try { navigator.vibrate(ms); } catch (e) {} }
  },

  // 成功提示音（原生）
  async success() {
    if (NATIVE()) { try { await Haptics.notification({ type: 'SUCCESS' }); } catch (e) {} }
  },

  // 屏幕常亮（计时器期间防熄屏）
  async keepAwake(on) {
    if (on) {
      try {
        if ('wakeLock' in navigator) {
          wakeLock = wakeLock || await navigator.wakeLock.request('screen');
        }
      } catch (e) {}
    } else if (wakeLock) {
      try { await wakeLock.release(); } catch (e) {}
      wakeLock = null;
    }
  },

  // App 回到前台回调（native 精确；web 用 visibilitychange 近似）
  onResume(cb) {
    if (NATIVE()) {
      App.addListener('appStateChange', ({ isActive }) => { if (isActive) cb(); });
    } else {
      document.addEventListener('visibilitychange', () => { if (!document.hidden) cb(); });
    }
  },
};

```



================================================
FILE: C:\Users\qu\Desktop\物理科学与技术论题\TS2\personal-erp\src\services\widget.js
================================================

```javascript
import { Capacitor } from '@capacitor/core';
import { Prefs } from '../store/prefs.js';

const SNAPSHOT_KEY = 'widget_snapshot';
const REV_KEY = 'widget_native_rev';

export const Widget = {
  key: SNAPSHOT_KEY,

  enabled() {
    return !!Prefs.load().widgetEnabled;
  },

  setEnabled(v) {
    Prefs.set({ widgetEnabled: !!v });
  },

  // 小组件深色主题（安卓端写入原生配置并立即刷新；web 端仅记忆偏好）
  async setDarkTheme(dark) {
    Prefs.set({ widgetDark: !!dark });
    try {
      if (!Capacitor.isNativePlatform()) return;
      const P = Capacitor.registerPlugin('Widget');
      await P.setDarkTheme({ dark: !!dark });
    } catch (e) {}
  },

  push(snapshot) {
    try {
      localStorage.setItem(SNAPSHOT_KEY, JSON.stringify({ ...snapshot, updatedAt: new Date().toISOString() }));
    } catch (e) {}
  },

  snapshot() {
    try { return JSON.parse(localStorage.getItem(SNAPSHOT_KEY) || 'null'); } catch (e) { return null; }
  },

  // ---- 原生回读：桌面独立操作（开始/充值/消费）后 rev 变大，拉取原生 db 覆盖本地 ----
  // 返回 { changed:boolean }。由 main.js 在启动与回前台时调用。
  async pullFromNative() {
    if (!this.nativeAvailable()) return { changed: false };
    try {
      const P = Capacitor.registerPlugin('Widget');
      const r = await P.getData();
      const nativeRev = Number(r.rev) || 0;
      const known = Number(localStorage.getItem(REV_KEY)) || 0;
      if (!r.db || nativeRev <= known) return { changed: false };
      const db = JSON.parse(r.db);
      delete db.native_txs; // 合并机制产物，JS 库不需要
      const { ensureSeq } = await import('../store/db.js');
      ensureSeq(db);
      localStorage.setItem('personal_erp_db_v1', JSON.stringify(db));
      localStorage.setItem(REV_KEY, String(nativeRev));
      return { changed: true };
    } catch (e) { return { changed: false }; }
  },

  async refreshNative() {
    try {
      if (!this.enabled()) return;
      if (!Capacitor.isNativePlatform()) return;
      const P = Capacitor.registerPlugin('Widget');
      // 数据桥接：Capacitor 8 不再自动同步 localStorage → 主动把 db + prefs 推给原生，
      // 原生写入 SharedPreferences("CapacitorStorage") 并刷新小组件。
      await P.pushData({
        db: localStorage.getItem('personal_erp_db_v1') || '',
        prefs: localStorage.getItem('personal_erp_prefs') || '',
      });
    } catch (e) {}
  },
};

```



================================================
FILE: C:\Users\qu\Desktop\物理科学与技术论题\TS2\personal-erp\src\store\db.js
================================================

```javascript
// ============================================================
// store/db.js
// 持久化层：单机自包含（localStorage），1 个 key 存全部真相。
// 未来切 SQLite/IndexedDB 只改本文件。
// ============================================================

const LS_KEY = 'personal_erp_db_v1';
let listeners = [];

export function loadDB() {
  let db = null;
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) db = JSON.parse(raw);
  } catch (e) { /* 损坏则回退种子 */ }
  if (!db || !Array.isArray(db.resources)) db = seedDB();
  ensureSeq(db);
  migrate(db);
  return db;
}

// 术语迁移：Token → 价值元（兼容旧数据）
function migrate(db) {
  for (const r of db.resources) {
    if (r.name === 'Token') r.name = '价值元';
    if (r.unit === 'Token') r.unit = '价值元';
  }
  if (!Array.isArray(db.goods)) db.goods = []; // 兼容旧库：补商品集合
}

export function saveDB(db) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(db)); } catch (e) { /* 容量满则提示 */ }
  listeners.forEach((fn) => fn(db));
}

// UI 订阅数据变更（用于跨视图同步刷新）
export function subscribe(fn) {
  listeners.push(fn);
  return () => { listeners = listeners.filter((x) => x !== fn); };
}

export function resetDB() {
  const db = seedDB();
  saveDB(db);
  return db;
}

// 保证每个聚合根的 seq 计数器存在且足够大（导入备份后也调用）
export function ensureSeq(db) {
  const maxOf = (arr, prefix) => arr.reduce((m, x) => {
    const n = parseInt(String(x.id).replace(prefix, ''), 10);
    return Number.isFinite(n) ? Math.max(m, n) : m;
  }, 0);
  db.seq = db.seq || {};
  db.seq.r = Math.max(db.seq.r || 0, maxOf(db.resources, 'r'));
  db.seq.ru = Math.max(db.seq.ru || 0, maxOf(db.rules, 'ru'));
  db.seq.g = Math.max(db.seq.g || 0, maxOf(db.goals, 'g'));
  db.seq.p = Math.max(db.seq.p || 0, maxOf(db.plans, 'p'));
  db.seq.a = Math.max(db.seq.a || 0, maxOf(db.activities, 'a'));
  db.seq.t = Math.max(db.seq.t || 0, maxOf(db.txs, 't'));
  db.seq.o = Math.max(db.seq.o || 0, maxOf(db.outputs, 'o'));
  db.seq.v = Math.max(db.seq.v || 0, maxOf(db.valueflows, 'v'));
  db.seq.gd = Math.max(db.seq.gd || 0, maxOf(db.goods || [], 'gd'));
}

// 全新初始化：资源不预设，首次启动进入「初始化资源」流程由用户自行配置
export function seedDB() {
  return {
    resources: [],
    rules: [],
    goals: [],
    plans: [],
    activities: [],
    txs: [],
    outputs: [],
    valueflows: [],
    goods: [],
    seq: { r: 0, ru: 0, g: 0, p: 0, a: 0, t: 0, o: 0, v: 0, gd: 0 },
  };
}

```



================================================
FILE: C:\Users\qu\Desktop\物理科学与技术论题\TS2\personal-erp\src\store\prefs.js
================================================

```javascript
// ============================================================
// store/prefs.js
// 轻量偏好记忆：记住用户上次的输入习惯，用于「按语境预填」，
// 让新建/完成时只需快速调整。
// ============================================================
const KEY = 'personal_erp_prefs';

export const Prefs = {
  load() {
    try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; }
  },
  set(patch) {
    const p = this.load();
    Object.assign(p, patch);
    try { localStorage.setItem(KEY, JSON.stringify(p)); } catch (e) {}
  },
};

```



================================================
FILE: C:\Users\qu\Desktop\物理科学与技术论题\TS2\personal-erp\src\ui\helpers.js
================================================

``javascript
// ============================================================
// ui/helpers.js
// UI 基础工具：DOM 构建、弹窗、Toast、格式化、状态徽章
// ============================================================

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

export function fmtNum(n, digits = 0) {
  return Number(n).toLocaleString('zh-CN', { maximumFractionDigits: digits });
}

export function fmtDate(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function fmtDateTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  return `${fmtDate(ts)} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function fmtDuration(min) {
  if (!min) return '';
  return min >= 60 ? `${Math.floor(min / 60)}h${min % 60 ? ` ${min % 60}m` : ''}` : `${min}m`;
}

// 状态徽章配色映射（统一状态语义）
export function badgeClass(state) {
  const map = {
    Planned: 'b-muted', Started: 'b-blue', Completed: 'b-green',
    Reviewed: 'b-amber', Archived: 'b-gray',
    Incubating: 'b-purple', Active: 'b-blue', Paused: 'b-amber',
    Draft: 'b-gray', Published: 'b-blue',
    Pending: 'b-amber', Overdue: 'b-red', Closed: 'b-green',
    Active_: 'b-green', Inactive: 'b-gray',
  };
  return map[state] || 'b-gray';
}

export function badge(state, label) {
  return `<span class="badge ${badgeClass(state)}">${esc(label || state)}</span>`;
}

// ---------- Toast ----------
let toastTimer = null;
export function toast(msg, type = 'info') {
  const root = document.getElementById('toast-root');
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.innerHTML = esc(msg);
  root.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    root.querySelectorAll('.toast.show').forEach((t) => t.classList.remove('show'));
    setTimeout(() => (root.innerHTML = ''), 300);
  }, 2600);
}

// ---------- Modal（通用）----------
// accent: brand(默认·创建) | info(执行/兑换) | ok(闭环/反馈) | warn(严格/完成) | danger(危险/冲正)
export function openModal({ title, bodyHTML, footerHTML, width = 520, accent = 'brand' }) {
  const root = document.getElementById('modal-root');
  root.innerHTML = `
    <div class="modal-mask" onclick="this.dataset.closing=1;this.classList.add('closing');setTimeout(()=>{this.remove()},180)">
      <div class="modal-panel accent-${accent}" style="max-width:${width}px" onclick="event.stopPropagation()">
        <div class="modal-head">
          <h3>${esc(title)}</h3>
          <button class="icon-btn" data-close>✕</button>
        </div>
        <div class="modal-body">${bodyHTML}</div>
        ${footerHTML ? `<div class="modal-foot">${footerHTML}</div>` : ''}
      </div>
    </div>`;
  const mask = root.querySelector('.modal-mask');
  mask.querySelector('[data-close]').onclick = () => closeModal(mask);
  // 填写交互优化：Esc 关闭；Enter 提交（输入框内回车 = 提交所在区域的主按钮）
  mask.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { closeModal(mask); return; }
    if (e.key !== 'Enter' || e.shiftKey) return;
    const t = e.target;
    if (!t || (t.tagName !== 'INPUT' && t.tagName !== 'SELECT')) return;
    if (t.type === 'checkbox' || t.type === 'radio' || t.type === 'button' || t.type === 'file') return;
    e.preventDefault();
    const zone = t.closest('[data-enter-zone]') || mask;
    const btn = [...zone.querySelectorAll('[data-enter]')].find((b) => b.offsetParent !== null)
      || zone.querySelector('[data-save]');
    if (btn) btn.click();
  });
  return {
    el: mask,
    close: () => closeModal(mask),
    q: (sel) => mask.querySelector(sel),
    qa: (sel) => mask.querySelectorAll(sel),
  };
}

export function closeModal(mask) {
  if (!mask) return;
  mask.classList.add('closing');
  setTimeout(() => mask.remove(), 180);
}

// 快捷按钮生成
export function btn(label, onclick, { cls = '', disabled = false } = {}) {
  return `<button class="btn ${cls}" ${disabled ? 'disabled' : ''} onclick="${onclick}">${esc(label)}</button>`;
}

// 资源稳定配色（按 id 哈希）：顶栏标签 / 流水圆点等共用
export function resColor(id) {
  const colors = ['#596271', '#4a7fbf', '#7c6cff', '#3da06a', '#c98a2b', '#d05a7a'];
  return colors[Math.abs(String(id).split('').reduce((s, c) => s + c.charCodeAt(0), 0)) % colors.length];
}

// 空态占位
export function empty(text, hint = '') {
  return `<div class="empty">${esc(text)}${hint ? `<div class="muted">${esc(hint)}</div>` : ''}</div>`;
}

``



================================================
FILE: C:\Users\qu\Desktop\物理科学与技术论题\TS2\personal-erp\src\ui\themes.js
================================================

``javascript
// ============================================================
// ui/themes.js
// 背景主题：全局背景 / 任务卡片虚化主题 共用同一套主题结构。
//   theme = null | { type:'gradient', value:'linear-gradient(...)' }
//                | { type:'image', url:'data:image/...' }
// ============================================================

export const THEMES = [
  { name: '晨曦', value: 'linear-gradient(135deg, #f6d365 0%, #fda085 100%)' },
  { name: '青空', value: 'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)' },
  { name: '暮紫', value: 'linear-gradient(135deg, #a18cd1 0%, #fbc2eb 100%)' },
  { name: '森林', value: 'linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)' },
  { name: '晚霞', value: 'linear-gradient(135deg, #ff9a9e 0%, #fecfef 100%)' },
  { name: '深海', value: 'linear-gradient(135deg, #2b5876 0%, #4e4376 100%)' },
];

export function themeStyle(theme) {
  if (!theme) return null;
  if (theme.type === 'image' && theme.url) return `url(${theme.url}) center / cover no-repeat`;
  if (theme.type === 'gradient' && theme.value) return theme.value;
  return null;
}

// 全局背景：图片固定铺满（随屏滚动跟随），渐变直接平铺
export function bgStyle(theme) {
  if (!theme) return null;
  if (theme.type === 'image' && theme.url) return `url(${theme.url}) center / cover no-repeat fixed`;
  if (theme.type === 'gradient' && theme.value) return theme.value;
  return null;
}

// 生成一行主题选择按钮（渐变 + 上传图片 + 无），供弹窗/设置页复用
// chosen: 当前主题；onPick(theme): 选中回调；onUpload(file): 上传图片回调
export function themePickerHTML({ chosen }) {
  return `
    <div class="theme-row">
      <button type="button" class="theme-chip t-none ${chosen ? '' : 'on'}" data-t="none">无</button>
      ${THEMES.map((t) => `<button type="button" class="theme-chip ${chosen && chosen.type === 'gradient' && chosen.value === t.value ? 'on' : ''}" data-g="${t.value}" title="${t.name}" style="background:${t.value}"></button>`).join('')}
      <label class="theme-chip t-upload" title="上传图片">📷<input type="file" accept="image/*" style="display:none" class="theme-file"></label>
    </div>`;
}

// 绑定主题选择交互；onPick/onUpload 由调用方传入
export function bindThemePicker(scope, { onPick, onUpload }) {
  const chips = scope.querySelectorAll('.theme-chip');
  chips.forEach((chip) => {
    chip.onclick = () => {
      let theme = null;
      if (chip.dataset.t === 'none') theme = null;
      else if (chip.dataset.g) theme = { type: 'gradient', value: chip.dataset.g };
      chips.forEach((x) => x.classList.toggle('on', x === chip));
      if (onPick) onPick(theme);
    };
  });
  const file = scope.querySelector('.theme-file');
  if (file) file.onchange = () => {
    const f = file.files[0];
    if (f && onUpload) onUpload(f);
  };
}

// 读本地图片为 data URL（自包含存储，离线可用）
export function readImageAsDataURL(file, cb) {
  const r = new FileReader();
  r.onload = () => cb(r.result);
  r.onerror = () => cb(null);
  r.readAsDataURL(file);
}

// ---------------- 智能文字对比度 ----------------
// 卡片主题整卡铺满，按主题真实亮度决定文字：平均亮度 > 150 → 亮底 → 深字(dark)；否则 → 暗底 → 白字(light)
const toneCache = new Map(); // image url -> 'dark'|'light'

function rawLum(hex) {
  const n = parseInt(String(hex).replace('#', ''), 16);
  if (Number.isNaN(n)) return 180;
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return 0.299 * r + 0.587 * g + 0.114 * b;
}
function gradientTone(value) {
  const colors = String(value || '').match(/#[0-9a-fA-F]{6}/g) || [];
  if (!colors.length) return 'dark';
  const avg = colors.reduce((s, c) => s + rawLum(c), 0) / colors.length;
  return avg > 150 ? 'dark' : 'light';
}
// 同步可判定的色调：渐变直接算；图片优先取缓存
export function themeTone(theme) {
  if (!theme) return 'dark';
  if (theme.type === 'gradient') return gradientTone(theme.value);
  if (theme.type === 'image' && theme.url) {
    if (toneCache.has(theme.url)) return toneCache.get(theme.url);
    return null; // 未知：交由异步采样
  }
  return 'dark';
}
// 异步采样图片平均亮度 → 色调（按 url 缓存，会话内不重复计算）
export function sampleImageTone(theme, cb) {
  if (!theme || theme.type !== 'image' || !theme.url) return cb && cb('dark');
  if (toneCache.has(theme.url)) return cb && cb(toneCache.get(theme.url));
  const img = new Image();
  img.onload = () => {
    let tone = 'dark';
    try {
      const c = document.createElement('canvas');
      c.width = Math.min(img.naturalWidth || 64, 64);
      c.height = Math.min(img.naturalHeight || 64, 64);
      const ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0, c.width, c.height);
      const d = ctx.getImageData(0, 0, c.width, c.height).data;
      let sum = 0, n = 0;
      for (let i = 0; i < d.length; i += 4) {
        sum += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
        n++;
      }
      tone = sum / n > 150 ? 'dark' : 'light';
    } catch (e) { tone = 'dark'; }
    toneCache.set(theme.url, tone);
    cb && cb(tone);
  };
  img.onerror = () => { toneCache.set(theme.url, 'dark'); cb && cb('dark'); };
  img.src = theme.url;
}

``



================================================
FILE: C:\Users\qu\Desktop\物理科学与技术论题\TS2\personal-erp\src\views\calendar.js
================================================

``javascript
// ============================================================
// views/calendar.js
// 日历板块（内嵌于「活动」页，第二顺位）：
//   月份网格 + 当日日程表（按计划开始时间排序，可开始/完成/编辑）
// ============================================================
import { esc, badge, empty } from '../ui/helpers.js';

let calYear, calMonth, calSelected = null;

function dayKey(d) { return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; }
// YYYY-M-D → 补零（datetime-local 需要）
function padDateKey(k) {
  if (!k) { const t = new Date(); k = dayKey(t); } // 未选日期时回退今天
  const [y, m, d] = String(k).split('-').map(Number);
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
function timeOf(ps) { const m = String(ps || '').match(/T(\d{1,2}):(\d{1,2})/); return m ? `${m[1]}:${m[2]}` : null; }
function fmtDay(k) {
  if (!k) return '选择日期'; // 翻月未选日：不显示 undefined
  const [y, m, d] = String(k).split('-').map(Number);
  return `${m}月${d}日`;
}
function planColor(db, planIds) {
  for (const pid of planIds) { const p = db.plans.find((x) => x.id === pid); if (p && p.color) return p.color; }
  return '#e5e8ee';
}
function planTitles(db, planIds) {
  return planIds.map((pid) => { const p = db.plans.find((x) => x.id === pid); return p ? esc(p.title) : ''; }).filter(Boolean).join(' · ') || '未关联';
}
function actDate(a) {
  if (a.actual_start) return dayKey(new Date(a.actual_start));
  if (a.planned_date) return a.planned_date;
  return null;
}

function agendaRow(App, a, t) {
  const { db } = App;
  const pcolor = planColor(db, a.plan_ids);
  // 时间原子性可视化：有截止时间显示完整时段；捆绑冲突加 ⚠ 提示
  const end = timeOf(a.planned_end);
  const span = t ? (end ? `${t}–${end}` : t) : '全天';
  const warn = (a.conflicts || []).length ? `<span title="与 ${(a.conflicts || []).map((cid) => { const o = db.activities.find((x) => x.id === cid); return o ? o.title : ''; }).join('、')} 时间重叠（捆绑，开始时仲裁）">⚠</span> ` : '';
  return `
    <div class="agenda-row clickable" data-edit="${a.id}" title="点击编辑">
      <div class="agenda-time" style="color:${pcolor}">${warn}${span}</div>
      <div class="grow">
        <div class="agenda-title"><span class="plan-chip" style="background:${pcolor}"></span>${esc(a.title)} ${badge(a.status)}${a.planned_minutes ? `<span class="muted"> · ${a.planned_minutes}m</span>` : ''}</div>
        ${a.note ? `<div class="agenda-note">📝 ${esc(a.note)}</div>` : ''}
        <div class="muted">${planTitles(db, a.plan_ids)}</div>
      </div>
      <div class="row-gap">
        <button class="btn sm timer-btn" title="按任务计时（计入 time_logs）" onclick="App.timer.openForActivity('${a.id}')">🍅</button>
        ${a.status === 'Planned' ? `<button class="btn sm primary" onclick="App.startAct('${a.id}')">开始</button>` : ''}
        ${a.status === 'Started' ? `<button class="btn sm primary" onclick="App.overview.openCompleteModal('${a.id}')">完成</button>` : ''}
      </div>
    </div>`;
}

// 渲染内嵌日历卡片到 host 元素（每次渲染重建，事件用事件委托）
export function renderSection(App, host) {
  if (calYear === undefined) { const d = new Date(); calYear = d.getFullYear(); calMonth = d.getMonth(); calSelected = dayKey(d); }
  const { db } = App;
  const byDay = {};
  for (const a of db.activities) { const k = actDate(a); if (k) (byDay[k] = byDay[k] || []).push(a); }

  const first = new Date(calYear, calMonth, 1);
  let start = first.getDay(); start = (start + 6) % 7; // 周一为 0
  const dim = new Date(calYear, calMonth + 1, 0).getDate();
  const todayK = dayKey(new Date());

  let grid = ['一', '二', '三', '四', '五', '六', '日'].map((d) => `<div class="cal-dow">${d}</div>`).join('');
  for (let i = 0; i < start; i++) grid += '<div class="cal-day empty"></div>';
  for (let d = 1; d <= dim; d++) {
    const k = dayKey(new Date(calYear, calMonth, d));
    const acts = byDay[k] || [];
    const cost = acts.reduce((s, a) => s + App.engine.activityCost(db, a.id), 0);
    grid += `
      <div class="cal-day ${k === todayK ? 'today' : ''} ${calSelected === k ? 'selected' : ''}" data-k="${k}">
        <div class="cal-d">${d}</div>
        ${acts.length ? `<div class="cal-cnt">${acts.length} 活动</div>` : ''}
        ${cost ? `<div class="cal-cost">-${cost}</div>` : ''}
      </div>`;
  }
  // 末尾补空位，保证最后一行填满（网格边线才整齐、圆角不露馅）
  const rem = (start + dim) % 7;
  if (rem) for (let i = 0; i < 7 - rem; i++) grid += '<div class="cal-day empty"></div>';

  // 当日日程：按计划开始时间排序（无时间的「全天」排在最后）
  const dayActs = (byDay[calSelected] || [])
    .map((a) => ({ a, t: timeOf(a.planned_start) }))
    .sort((x, y) => (x.t || '99:99').localeCompare(y.t || '99:99'));
  const totalMin = dayActs.reduce((s, x) => s + (x.a.planned_minutes || 0), 0);

  host.innerHTML = `
    <div class="card">
      <div class="card-head">
        <h3>日历 · 当日日程</h3>
        <div class="row-gap">
          <button class="btn sm" data-cal="prev">‹ 上月</button>
          <button class="btn sm" data-cal="today">今天</button>
          <button class="btn sm" data-cal="next">下月 ›</button>
        </div>
      </div>
      <div class="cal-wrap">
        <div class="cal-grid">${grid}</div>
        <div class="cal-agenda">
        <div class="agenda-head">
          <span>${fmtDay(calSelected)}<span class="muted"> · ${dayActs.length} 项${totalMin ? ` · 预计 ${totalMin} 分钟` : ''}</span></span>
          <button class="btn sm" title="为 ${fmtDay(calSelected)} 快速添加待办" onclick="App.overview.openActModal(null,null,'${padDateKey(calSelected)}T09:00')">＋</button>
        </div>
        ${dayActs.length ? dayActs.map(({ a, t }) => agendaRow(App, a, t)).join('') : empty('当天无安排', '＋ 点击此处，为该日快速添加待办')}
      </div>
      </div>
    </div>
  `;

  // 事件绑定
  host.querySelector('[data-cal="prev"]').onclick = () => { calMonth--; if (calMonth < 0) { calMonth = 11; calYear--; } calSelected = null; renderSection(App, host); };
  host.querySelector('[data-cal="today"]').onclick = () => { const t = new Date(); calYear = t.getFullYear(); calMonth = t.getMonth(); calSelected = dayKey(t); renderSection(App, host); };
  host.querySelector('[data-cal="next"]').onclick = () => { calMonth++; if (calMonth > 11) { calMonth = 0; calYear++; } calSelected = null; renderSection(App, host); };
  host.querySelectorAll('.cal-day[data-k]').forEach((el) => {
    el.onclick = () => { calSelected = el.dataset.k; renderSection(App, host); };
  });
  // 点击日程空白处 → 为选中日快速新建活动（行/按钮除外）
  const agenda = host.querySelector('.cal-agenda');
  if (agenda) agenda.onclick = (e) => {
    // 点击日程行卡片 → 编辑该活动（按钮/链接除外）
    const rowEl = e.target.closest('.agenda-row.clickable');
    if (rowEl) {
      if (e.target.closest('button, a, input, select, textarea')) return;
      App.overview.openActModal(rowEl.dataset.edit);
      return;
    }
    if (e.target.closest('.agenda-row, button, input, select, textarea')) return;
    App.overview.openActModal(null, null, `${padDateKey(calSelected)}T09:00`);
  };
}

``



================================================
FILE: C:\Users\qu\Desktop\物理科学与技术论题\TS2\personal-erp\src\views\dayGuide.js
================================================

``javascript
// ============================================================
// views/dayGuide.js
// 新一天引导模式：每天第一次启动应用时弹出，
// 根据启动时间引导：问候 → 建目标 → 建计划 → 排满一整天 → 今日清单。
// 完成/跳过后记录 dayGuideLast，当天不再打扰。
// ============================================================
import { esc, fmtNum } from '../ui/helpers.js';
import { Prefs } from '../store/prefs.js';

const STEPS = ['welcome', 'goal', 'plan', 'acts', 'summary'];
let el = null;
let st = null; // { App, step, goalId, planTitle, budget, acts:[{title,start:Date,minutes}], slot }

function dayKey(d) { return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; }
function hm(d) { return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; }
function greeting() {
  const h = new Date().getHours();
  if (h < 5) return '夜深了';
  if (h < 11) return '早上好';
  if (h < 14) return '中午好';
  if (h < 18) return '下午好';
  return '晚上好';
}
// 从当前时间取整到下一个半点，作为首个活动的开始
function firstSlot() {
  const d = new Date();
  d.setSeconds(0, 0);
  const min = d.getMinutes();
  d.setMinutes(min + (min % 30 === 0 ? 30 : 30 - (min % 30)));
  return d;
}

export function maybeShow(App) {
  const today = dayKey(new Date());
  const p = Prefs.load();
  if (p.dayGuideLast === today) return;
  if (!App.db.resources.length) return; // 首次初始化流程优先
  open(App);
}

function open(App) {
  st = { App, step: 'welcome', goalId: null, planTitle: '', budget: '', acts: [], slot: firstSlot(), pickedExistingGoal: '' };
  if (!el) build();
  render();
  el.classList.add('show');
}

function close(done) {
  Prefs.set({ dayGuideLast: dayKey(new Date()) });
  el.classList.remove('show');
  if (!done && st && st.acts.length) toastSkip();
  st = null;
  if (done) { window.App.setTab('overview'); }
}
function toastSkip() {
  import('../ui/helpers.js').then((m) => m.toast('引导已关闭，稍后可在活动页继续安排', 'info'));
}

function build() {
  el = document.createElement('div');
  el.id = 'dayGuide';
  el.className = 'dg-overlay';
  document.body.appendChild(el);
}

function head(title, sub) {
  return `<div class="dg-head"><div class="dg-greet">${greeting()}</div><h2>${title}</h2><p class="muted">${sub}</p></div>`;
}
function foot(backLabel, nextLabel, backFn, nextFn, nextDisabled) {
  return `<div class="dg-foot">
    ${backLabel ? `<button class="btn" data-back>${esc(backLabel)}</button>` : '<span></span>'}
    ${nextLabel ? `<button class="btn primary" data-next ${nextDisabled ? 'disabled' : ''}>${esc(nextLabel)}</button>` : '<span></span>'}
  </div>`;
}

function render() {
  const { App, step } = st;
  const db = App.db;
  let body = '';

  if (step === 'welcome') {
    body = `
      ${head('开启新的一天', `现在是 ${hm(new Date())}，把剩下的时间安排好`)}
      <div class="dg-cards">
        <div class="dg-card">🎯 定一个目标</div>
        <div class="dg-card">📋 拆成今天的计划</div>
        <div class="dg-card">⏱ 从现在起排满一整天</div>
      </div>
      ${foot('先跳过', '开始规划', () => close(false), () => { st.step = 'goal'; render(); })}`;
  }

  if (step === 'goal') {
    const goals = db.goals.map((g) => `<option value="${g.id}">${esc(g.title)}</option>`).join('');
    body = `
      ${head('第一步 · 目标', '长期方向，一个就够（已有目标可直接选用）')}
      <div class="field"><label>新建目标</label><input id="dg-goal" placeholder="例：写完一本书"></div>
      <div class="dg-or">或选择已有目标</div>
      <select id="dg-goal-existing"><option value="">— 不选 —</option>${goals}</select>
      ${foot('上一步', '下一步', () => { st.step = 'welcome'; render(); }, () => saveGoal())}`;
  }

  if (step === 'plan') {
    body = `
      ${head('第二步 · 计划', '今天要推进的具体事项')}
      <div class="field"><label>计划名称 *</label><input id="dg-plan" placeholder="例：每天写 2000 字"></div>
      <div class="field"><label>预算 价值元（留空 = 无限）</label><input id="dg-budget" type="number" min="0"></div>
      ${foot('上一步', '下一步，排活动', () => { st.step = 'goal'; render(); }, () => savePlan())}`;
  }

  if (step === 'acts') {
    const rows = st.acts.map((x, i) => `
      <div class="dg-act-row">
        <span class="dg-act-time">${hm(x.start)}</span>
        <span class="grow">${esc(x.title)}<span class="muted"> · ${x.minutes}m</span></span>
        <button class="btn sm danger" data-del="${i}">✕</button>
      </div>`).join('');
    body = `
      ${head('第三步 · 排满一整天', `从 ${hm(st.slot)} 起，新活动自动顺延`)}
      <div class="dg-add">
        <input id="dg-act-title" placeholder="活动名称，例：写第二章初稿">
        <div class="row-gap">
          <input id="dg-act-min" type="number" min="5" step="5" value="60" style="width:90px"><span class="muted">分钟</span>
          <button class="btn primary sm" data-add>＋ 加入日程</button>
        </div>
      </div>
      <div class="dg-act-list">${rows || '<div class="empty">还没添加，从下一行开始吧</div>'}</div>
      ${foot('上一步', st.acts.length ? '预览今天' : '跳过预览', () => { st.step = 'plan'; render(); }, () => finishActs())}`;
  }

  if (step === 'summary') {
    const rows = st.acts.map((x) => `
      <div class="dg-sum-row">
        <span class="dg-act-time" style="color:#4A7FBF">${hm(x.start)}</span>
        <span class="grow">${esc(x.title)}</span>
        <span class="muted">${x.minutes}m</span>
      </div>`).join('');
    const total = st.acts.reduce((s, x) => s + x.minutes, 0);
    body = `
      ${head('今天就绪 🎉', `${st.acts.length} 项活动 · 共 ${total >= 60 ? Math.floor(total / 60) + 'h' : ''}${total % 60 ? (total % 60) + 'm' : ''}`)}
      <div class="dg-act-list">${rows}</div>
      <div class="callout ok">按清单推进，每完成一项记得回来闭环入账。</div>
      ${foot('', '开始今天', null, () => close(true))}`;
  }

  el.innerHTML = `<div class="dg-panel accent-brand">${body}</div>`;

  // 绑定
  const q = (s) => el.querySelector(s);
  const back = el.querySelector('[data-back]');
  const next = el.querySelector('[data-next]');
  if (back && typeof st._back !== 'undefined') {} // no-op 占位
  if (back) back.onclick = () => st._pendingBack && st._pendingBack();
  if (next) next.onclick = () => st._pendingNext && st._pendingNext();

  // 各步的回调注入（闭包捕获输入值）
  if (step === 'welcome') { st._pendingBack = () => close(false); st._pendingNext = () => { st.step = 'goal'; render(); }; }
  if (step === 'goal') {
    st._pendingBack = () => { st.step = 'welcome'; render(); };
    st._pendingNext = () => saveGoal();
  }
  if (step === 'plan') {
    st._pendingBack = () => { st.step = 'goal'; render(); };
    st._pendingNext = () => savePlan();
  }
  if (step === 'acts') {
    st._pendingBack = () => { st.step = 'plan'; render(); };
    st._pendingNext = () => finishActs();
    const add = el.querySelector('[data-add]');
    if (add) add.onclick = addAct;
    el.querySelectorAll('[data-del]').forEach((b) => {
      b.onclick = () => {
        const removed = st.acts.splice(Number(b.dataset.del), 1)[0];
        // 后续活动时间回退重排
        reflow();
        render();
      };
    });
    const t = el.querySelector('#dg-act-title');
    if (t) t.focus();
  }
  if (step === 'summary') {
    st._pendingNext = () => close(true);
  }
}

function saveGoal() {
  const title = el.querySelector('#dg-goal').value.trim();
  const existSel = el.querySelector('#dg-goal-existing');
  const existing = existSel ? existSel.value : '';
  if (existing) { st.goalId = existing; st.step = 'plan'; render(); return; }
  if (!title) { st.goalId = null; st.step = 'plan'; render(); return; }
  const r = st.App.engine.createGoal(st.App.db, { title });
  if (!r.ok) { import('../ui/helpers.js').then((m) => m.toast(r.error, 'err')); return; }
  st.goalId = st.App.db.goals[st.App.db.goals.length - 1].id;
  st.step = 'plan'; render();
}

function savePlan() {
  const name = el.querySelector('#dg-plan').value.trim();
  const budgetRaw = el.querySelector('#dg-budget').value.trim();
  if (!name) {
    // 无计划也可继续（活动可不挂计划）
    st.planTitle = ''; st.step = 'acts'; render(); return;
  }
  if (!st.goalId) {
    import('../ui/helpers.js').then((m) => m.toast('请先在上一步选择或创建目标', 'err'));
    return;
  }
  const r = st.App.engine.createPlan(st.App.db, {
    goal_id: st.goalId, title: name,
    budget: budgetRaw === '' ? null : Number(budgetRaw),
  });
  if (!r.ok) { import('../ui/helpers.js').then((m) => m.toast(r.error, 'err')); return; }
  st.planTitle = name;
  st.step = 'acts'; render();
}

function addAct() {
  const t = el.querySelector('#dg-act-title');
  const m = el.querySelector('#dg-act-min');
  const title = t.value.trim();
  const minutes = Math.max(5, Number(m.value) || 60);
  if (!title) { t.focus(); return; }
  st.acts.push({ title, start: new Date(st.slot), minutes });
  st.slot = new Date(st.slot.getTime() + minutes * 60000);
  render();
  const nt = el.querySelector('#dg-act-title');
  if (nt) nt.focus();
}

function reflow() {
  let s = firstSlot();
  for (const x of st.acts) { x.start = new Date(s); s = new Date(s.getTime() + x.minutes * 60000); }
  st.slot = s;
}

function finishActs() {
  if (!st.acts.length) { st.step = 'summary'; render(); return; }
  const { App, db } = st;
  const todayK = dayKey(new Date());
  let planIds = [];
  const plan = db.plans[db.plans.length - 1];
  if (st.planTitle && plan && plan.title === st.planTitle) planIds = [plan.id];
  for (const x of st.acts) {
    const r = App.engine.createActivity(App.db, {
      title: x.title, note: '', plan_ids: [...planIds],
      planned_start: `${pad(todayK)}T${hm(x.start)}`,
      planned_minutes: x.minutes,
    });
    if (!r.ok) { import('../ui/helpers.js').then((mm) => mm.toast(r.error, 'err')); return; }
  }
  App.refresh();
  st.step = 'summary'; render();
}

function pad(k) {
  const [y, m, d] = String(k).split('-').map(Number);
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
``



================================================
FILE: C:\Users\qu\Desktop\物理科学与技术论题\TS2\personal-erp\src\views\goals.js
================================================

``javascript
// ============================================================
// views/goals.js
// 「目标与计划」Tab —— 战略层
//   目标(Goal) 1:N 计划(Plan)；计划 18C 状态机；19BC 混合预算
// ============================================================
import { esc, fmtNum, badge, openModal, toast } from '../ui/helpers.js';
import { PLAN_COLORS } from '../domain/engine.js';
import { Prefs } from '../store/prefs.js';

// 折叠状态（目标/计划可收起展开，跨会话记忆）
const collapsedGoals = new Set(Prefs.load().collapsedGoals || []);
const collapsedPlans = new Set(Prefs.load().collapsedPlans || []);
function persistCollapsed() {
  Prefs.set({ collapsedGoals: [...collapsedGoals], collapsedPlans: [...collapsedPlans] });
}
export function toggleGoal(id) {
  collapsedGoals.has(id) ? collapsedGoals.delete(id) : collapsedGoals.add(id);
  persistCollapsed(); App.refresh();
}
export function togglePlan(id) {
  collapsedPlans.has(id) ? collapsedPlans.delete(id) : collapsedPlans.add(id);
  persistCollapsed(); App.refresh();
}
export function openGoalModal(editId) {
  const g = editId ? App.db.goals.find((x) => x.id === editId) : null;
  const m = openModal({
    title: g ? '编辑目标' : '新建目标',
    bodyHTML: `
      <div class="field"><label>目标名称 *</label><input id="f-gname" value="${esc(g?.title || '')}" placeholder="例：写一本书"></div>
      <div class="field"><label>描述</label><input id="f-gdesc" value="${esc(g?.desc || '')}"></div>`,
    footerHTML: `<button class="btn" data-cancel>取消</button><button class="btn primary" data-save>保存</button>`,
  });
  m.q('[data-cancel]').onclick = () => m.close();
  m.q('[data-save]').onclick = () => {
    const r = g
      ? App.engine.updateGoal(App.db, g.id, { title: m.q('#f-gname').value, desc: m.q('#f-gdesc').value })
      : App.engine.createGoal(App.db, { title: m.q('#f-gname').value, desc: m.q('#f-gdesc').value });
    if (!r.ok) return toast(r.error, 'err');
    m.close(); App.refresh();
  };
}

export async function delGoal(id) {
  const g = App.db.goals.find((x) => x.id === id);
  if (!g) return;
  const im = App.engine.goalDeleteImpact(App.db, id);
  const parts = [`${im.plans} 个计划`];
  if (im.acts) parts.push(`级联删除 ${im.acts} 个活动（含 ${im.outs} 个产出、${im.vfs} 条价值流及流水）`);
  if (im.unlink) parts.push(`${im.unlink} 个多计划活动解除关联（保留）`);
  const msg = `删除目标「${g.title}」将连带删除：${parts.join('；')}。确定？`;
  if (!(await App.system.confirm({ title: '删除目标', message: msg }))) return;
  const r = App.engine.deleteGoalCascade(App.db, id);
  if (!r.ok) return toast(r.error, 'err');
  App.refresh(); toast('目标已删除');
}

export function openPlanModal(goalId, editId) {
  const p = editId ? App.db.plans.find((x) => x.id === editId) : null;
  const goalOpts = App.db.goals.map((g) =>
    `<option value="${g.id}" ${g.id === (p ? p.goal_id : goalId) ? 'selected' : ''}>${esc(g.title)}</option>`).join('');
  const defColor = p?.color || PLAN_COLORS[0];
  const m = openModal({
    title: p ? '编辑计划' : '新建计划（挂在目标下）',
    bodyHTML: `
      <div class="field"><label>所属目标</label><select id="f-pgoal">${goalOpts}</select></div>
      <div class="field"><label>计划名称 *</label><input id="f-pname" value="${esc(p?.title || '')}" placeholder="例：每天写 2000 字"></div>
      <div class="field"><label>计划颜色（按计划染色任务卡片）</label>
        <div class="color-row">${PLAN_COLORS.map((c) => `<button type="button" class="swatch ${c === defColor ? 'on' : ''}" data-c="${c}" style="background:${c}"></button>`).join('')}</div>
      </div>
      <div class="field"><label>预算 价值元（留空 = 无限 ∞，19BC 混合预算）</label><input id="f-pbudget" type="number" min="0" value="${p?.budget ?? ''}" placeholder="∞"></div>`,
    footerHTML: `<button class="btn" data-cancel>取消</button><button class="btn primary" data-save>保存</button>`,
  });
  m.qa('.swatch').forEach((s) => {
    s.onclick = () => { m.qa('.swatch').forEach((x) => x.classList.remove('on')); s.classList.add('on'); };
  });
  m.q('[data-cancel]').onclick = () => m.close();
  m.q('[data-save]').onclick = () => {
    const bRaw = m.q('#f-pbudget').value.trim();
    const budget = bRaw === '' ? null : Number(bRaw);
    const color = m.q('.swatch.on')?.dataset.c || null;
    const payload = { goal_id: m.q('#f-pgoal').value, title: m.q('#f-pname').value, budget, color };
    const r = p
      ? App.engine.updatePlan(App.db, p.id, payload)
      : App.engine.createPlan(App.db, payload);
    if (!r.ok) return toast(r.error, 'err');
    m.close(); App.refresh();
  };
}

export async function delPlan(id) {
  const p = App.db.plans.find((x) => x.id === id);
  if (!p) return;
  const im = App.engine.planDeleteImpact(App.db, id);
  const parts = [];
  if (im.acts) parts.push(`级联删除 ${im.acts} 个活动（含 ${im.outs} 个产出、${im.vfs} 条价值流及流水）`);
  if (im.unlink) parts.push(`${im.unlink} 个多计划活动解除关联（保留）`);
  const msg = parts.length ? `删除计划「${p.title}」将：${parts.join('；')}。确定？` : `删除计划「${p.title}」？`;
  if (!(await App.system.confirm({ title: '删除计划', message: msg }))) return;
  const r = App.engine.deletePlanCascade(App.db, id);
  if (!r.ok) return toast(r.error, 'err');
  App.refresh(); toast('计划已删除');
}

// 计划状态：下拉选择切换（非法流转由引擎拒绝）
export function setPlanStatus(pid, status) {
  const r = App.engine.setPlanStatus(App.db, pid, status);
  if (!r.ok) return toast(r.error, 'err');
  App.refresh();
}

function planCard(App, p) {
  const { engine } = App;
  const cost = engine.planCost(App.db, p.id);
  const blocked = engine.isPlanBlocked(App.db, p.id);
  const pct = p.budget !== null ? Math.min(100, (cost / p.budget) * 100) : 0;
  const acts = App.db.activities.filter((a) => a.plan_ids.includes(p.id));
  const collapsed = collapsedPlans.has(p.id);
  return `
    <div class="plan-card ${collapsed ? 'collapsed' : ''}" style="border-left:4px solid ${p.color || '#e5e8ee'}">
      <div class="plan-head" onclick="App.goals.togglePlan('${p.id}')" title="点击收起 / 展开">
        <button class="collapse-btn" tabindex="-1" onclick="event.stopPropagation();App.goals.togglePlan('${p.id}')" aria-label="收起/展开">${collapsed ? '▸' : '▾'}</button>
        <div class="grow">
          <span class="plan-chip" style="background:${p.color || '#e5e8ee'}"></span>
          <b>${esc(p.title)}</b> ${badge(p.status)}
          <span class="muted">${acts.length} 活动</span>
        </div>
        <span class="muted">预算 ${p.budget === null ? '∞' : fmtNum(p.budget)} · 已耗 ${fmtNum(cost)}${p.budget !== null ? ` · ${pct.toFixed(0)}%` : ''}</span>
      </div>
      <div class="plan-details ${collapsed ? 'hidden' : ''}">
      ${p.budget !== null ? `
        <div class="progress"><i class="bar ${blocked ? 'danger' : pct >= 70 ? 'warn' : ''}" style="width:${pct}%"></i></div>
        ${blocked ? '<div class="muted warn">⛔ 硬约束触发：禁止新活动开始/完成</div>' : ''}` : ''}
      ${acts.length ? `
      <div class="plan-acts">
        <div class="plan-acts-head"><span>活动（${acts.length}）</span><span class="muted">点击可编辑</span></div>
        ${acts.map((a) => `
          <div class="plan-act" onclick="event.stopPropagation();App.overview.openActModal('${a.id}')" title="点击编辑">
            <span class="grow">
              ${esc(a.title)}${a.planned_minutes ? ` <span class="muted">· ${a.planned_minutes}m</span>` : ''}
              ${a.note ? `<div class="plan-act-note">📝 ${esc(a.note)}</div>` : ''}
            </span>
            ${badge(a.status)}
          </div>`).join('')}
      </div>` : ''}
      <div class="row-gap" style="margin-top:8px" onclick="event.stopPropagation()">
        <button class="btn sm primary" onclick="App.overview.openActModal(null,'${p.id}')">＋ 活动</button>
        <label class="status-select">状态
          <select onchange="App.goals.setPlanStatus('${p.id}', this.value)">
            <option value="Active" ${p.status === 'Active' ? 'selected' : ''}>进行中</option>
            <option value="Paused" ${p.status === 'Paused' ? 'selected' : ''}>已暂停</option>
            <option value="Completed" ${p.status === 'Completed' ? 'selected' : ''}>已完成</option>
            <option value="Archived" ${p.status === 'Archived' ? 'selected' : ''}>已归档</option>
          </select>
        </label>
        <span class="grow"></span>
        <button class="btn sm" onclick="App.goals.openPlanModal('${p.goal_id}','${p.id}')">编辑</button>
        <button class="btn sm danger" onclick="App.goals.delPlan('${p.id}')">删除</button>
      </div>
      </div>
    </div>`;
}

export function render(App, el) {
  const { db } = App;
  if (!db.goals.length) {
    el.innerHTML = `
      <div class="card"><div class="card-head"><h3>目标与计划</h3></div>
        <div class="plan-add" onclick="App.goals.openGoalModal()">＋ 点击创建你的第一个目标</div>
        <button class="btn primary" style="margin-top:10px" onclick="App.goals.openGoalModal()">＋ 创建目标</button>
      </div>`;
    return;
  }
  el.innerHTML = `
    <div class="card">
      <div class="card-head">
        <h3>目标 Goals <span class="muted">1 : N 计划</span></h3>
        <button class="btn sm" onclick="App.goals.openGoalModal()">＋ 新建目标</button>
      </div>
      ${db.goals.map((g) => {
        const plans = db.plans.filter((p) => p.goal_id === g.id);
        const gcoll = collapsedGoals.has(g.id);
        return `
          <div class="goal-block ${gcoll ? 'collapsed' : ''}">
            <div class="goal-head" onclick="App.goals.toggleGoal('${g.id}')" title="点击收起 / 展开">
              <button class="collapse-btn" tabindex="-1" onclick="event.stopPropagation();App.goals.toggleGoal('${g.id}')" aria-label="收起/展开">${gcoll ? '▸' : '▾'}</button>
              <div class="grow">
                <b class="goal-title">🎯 ${esc(g.title)}</b>
                <span class="muted">${esc(g.desc || '')} · ${plans.length} 个计划</span>
              </div>
              <div class="row-gap" onclick="event.stopPropagation()">
                <button class="btn sm primary" onclick="App.goals.openPlanModal('${g.id}')">＋ 计划</button>
                <button class="btn sm" onclick="App.goals.openGoalModal('${g.id}')">编辑</button>
                <button class="btn sm danger" onclick="App.goals.delGoal('${g.id}')">删除</button>
              </div>
            </div>
            <div class="goal-plans ${gcoll ? 'hidden' : ''}">
            ${plans.length ? `<div class="plan-list">${plans.map((p) => planCard(App, p)).join('')}</div>` : `<div class="plan-add" onclick="App.goals.openPlanModal('${g.id}')">＋ 点击添加计划</div>`}
            </div>
          </div>`;
      }).join('')}
    </div>
  `;
}

``



================================================
FILE: C:\Users\qu\Desktop\物理科学与技术论题\TS2\personal-erp\src\views\overview.js
================================================

``javascript
// ============================================================
// views/overview.js
// 「活动」Tab —— 主战场：
//   资源总览 / 兑换规则 / 活动看板(五态) / 价值流
// 所有写操作均经 App.engine（不变量强制），成功后才 refresh。
// ============================================================
import { esc, fmtNum, fmtDate, fmtDateTime, badge, openModal, closeModal, toast, btn, empty, resColor } from '../ui/helpers.js';
import * as calendar from './calendar.js';
import { Prefs } from '../store/prefs.js';
import { themeStyle, themePickerHTML, bindThemePicker, readImageAsDataURL, themeTone, sampleImageTone } from '../ui/themes.js';

const REPEAT_LABEL = { daily: '每天', weekday: '工作日', weekly: '每周', monthly: '每月' };

// 计划截止时刻的 HH:mm 部分（无则 null）
function plannedEndOf(a) {
  const m = String(a && a.planned_end || '').match(/T(\d{1,2}:\d{2})/);
  return m ? m[1] : null;
}

// 语境辅助：今天（补零 YYYY-MM-DD）、由计划标题推导活动标题建议
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
// YYYY-M-D / YYYY-MM-DD → 补零（date input 需要）
function toDateInput(s) {
  if (!s) return '';
  const [y, m, d] = String(s).split('-').map(Number);
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
function suggestTitle(planTitle) {
  const t = String(planTitle || '').trim();
  const stripped = t.replace(/^(每天|每日|每周|每月|工作日|按日|按周|按月)\s*/, '').trim();
  return stripped || t;
}
// #rrggbb → rgba(..., alpha)
function hexToRgba(hex, alpha) {
  const n = parseInt(String(hex).replace('#', ''), 16);
  if (Number.isNaN(n)) return `rgba(0,0,0,${alpha})`;
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}
// 活动关联计划的染色（取第一个有颜色的计划）
function activityPlanColor(db, planIds) {
  for (const pid of planIds) {
    const p = db.plans.find((x) => x.id === pid);
    if (p && p.color) return p.color;
  }
  return null;
}

// ---------------- 资源 ----------------
const RESOURCE_COLORS = ['#4a7fbf', '#3da06a', '#d97706', '#7c3aed', '#dc2626', '#0e7490', '#be185d', '#4d7c0f'];

export function openResModal() {
  let chosenColor = null; // null = 自动分配
  const m = openModal({
    title: '新增资源（决策 B：多资源账户，可自定义）',
    bodyHTML: `
      <div class="field"><label>资源名称</label><input id="f-rname" placeholder="例：灵感"></div>
      <div class="field"><label>单位</label><input id="f-runit" placeholder="点 / 小时 / 元"></div>
      <div class="field"><label>初始余额</label><input id="f-rinit" type="number" value="0" step="0.01"></div>
      <div class="field"><label>标签颜色</label>
        <div class="tag-suggest" id="res-colors">
          ${RESOURCE_COLORS.map((c) => `<button type="button" class="tag-chip color-dot" data-color="${c}" style="--dot:${c}" title="${c}"><i></i></button>`).join('')}
          <button type="button" class="tag-chip color-auto on">自动</button>
        </div>
      </div>`,
    footerHTML: `<button class="btn" data-cancel>取消</button><button class="btn primary" data-save>创建</button>`,
  });
  m.qa('#res-colors .color-dot').forEach((b) => {
    b.onclick = () => {
      chosenColor = b.dataset.color;
      m.qa('#res-colors .tag-chip').forEach((x) => x.classList.remove('on'));
      b.classList.add('on');
    };
  });
  const autoBtn = m.q('.color-auto');
  autoBtn.onclick = () => {
    chosenColor = null;
    m.qa('#res-colors .tag-chip').forEach((x) => x.classList.remove('on'));
    autoBtn.classList.add('on');
  };
  m.q('[data-cancel]').onclick = () => m.close();
  m.q('[data-save]').onclick = () => {
    const r = App.engine.createResource(App.db, {
      name: m.q('#f-rname').value,
      unit: m.q('#f-runit').value,
      initial: m.q('#f-rinit').value,
      color: chosenColor,
    });
    if (!r.ok) return toast(r.error, 'err');
    m.close(); App.refresh(); toast('资源已创建');
  };
}

function resourceCard(App, r) {
  const b = App.engine.balanceOf(App.db, r.id);
  const init = r.initial || 1;
  const pct = Math.max(0, Math.min(100, (b / init) * 100));
  const danger = b < 0;
  // 智能配色：正常态用资源自选色（无则按 id 哈希），偏低黄、透支红
  const resC = r.color || resColor(r.id);
  return `
    <div class="res-card ${r.status === 'Inactive' ? 'off' : ''}" onclick="App.overview.openAdjustModal('${r.id}')" title="点击补充/调整余额">
      <div class="res-head">
        <span class="res-name">${esc(r.name)}</span>
        <span class="res-status">${r.status === 'Active' ? badge('Active_', '启用') : badge('Inactive', '停用')}</span>
      </div>
      <div class="res-balance ${danger ? 'neg' : ''}">${fmtNum(b)}<span class="res-unit"> ${esc(r.unit)}</span></div>
      <div class="progress"><i class="bar ${danger ? 'danger' : pct >= 90 ? 'warn' : ''}" style="width:${pct}%;${!danger && pct < 90 ? `background:${resC}` : ''}"></i></div>
      <div class="res-meta muted">初始 ${fmtNum(r.initial)} · 余额=Σ流水 · 点击补充</div>
      <div class="row-gap" onclick="event.stopPropagation()">
        <button class="btn sm primary" onclick="App.overview.openAdjustModal('${r.id}')">＋ 补充</button>
        <button class="btn sm" onclick="App.engine.setResourceStatus(App.db,'${r.id}','${r.status === 'Active' ? 'Inactive' : 'Active'}');App.refresh()">
          ${r.status === 'Active' ? '停用' : '启用'}
        </button>
        <button class="btn sm danger" onclick="App.overview.delResource('${r.id}')">删除</button>
      </div>
    </div>`;
}

// 点击资源卡：简洁补充/调整余额
export function openAdjustModal(resourceId) {
  const r = App.db.resources.find((x) => x.id === resourceId);
  if (!r) return;
  const m = openModal({
    title: `补充「${r.name}」`,
    accent: 'ok',
    bodyHTML: `
      <p class="muted">当前余额：<b class="amount ${App.engine.balanceOf(App.db, r.id) < 0 ? 'neg' : 'pos'}">${fmtNum(App.engine.balanceOf(App.db, r.id))} ${esc(r.unit)}</b></p>
      <div class="grid2">
        <div class="field"><label>操作</label><select id="f-adir"><option value="debit">补充（+余额）</option><option value="credit">扣减（−余额）</option></select></div>
        <div class="field"><label>金额 &gt; 0</label><input id="f-aamt" type="number" min="0" step="0.01"></div>
      </div>
      <div class="field"><label>备注</label><input id="f-anote" placeholder="例：发工资 / 充值 / 修正"></div>`,
    footerHTML: `<button class="btn" data-cancel>取消</button><button class="btn primary" data-save>入账</button>`,
  });
  m.q('[data-cancel]').onclick = () => m.close();
  m.q('[data-save]').onclick = () => {
    const res = App.engine.adjustResource(App.db, resourceId, {
      direction: m.q('#f-adir').value, amount: m.q('#f-aamt').value, note: m.q('#f-anote').value,
    });
    if (!res.ok) return toast(res.error, 'err');
    m.close(); App.refresh(); toast('已入账', 'ok');
  };
}

export async function delResource(id) {
  const r = App.db.resources.find((x) => x.id === id);
  if (!r) return;
  const nTx = App.db.txs.filter((t) => t.resource_id === id).length;
  const nRule = App.db.rules.filter((x) => x.from === id || x.to === id).length;
  const parts = [];
  if (nTx) parts.push(`${nTx} 条流水`);
  if (nRule) parts.push(`${nRule} 条兑换规则`);
  const msg = parts.length
    ? `删除资源「${r.name}」将连带删除：${parts.join('、')}。确定？`
    : `删除资源「${r.name}」？`;
  if (!(await App.system.confirm({ title: '删除资源', message: msg }))) return;
  const res = App.engine.deleteResource(App.db, id);
  if (!res.ok) return toast(res.error, 'err');
  App.refresh(); toast('资源已删除', 'ok');
}

// ---------------- 兑换规则 ----------------
export function openRuleModal() {
  const opts = App.db.resources.filter((r) => r.status === 'Active')
    .map((r) => `<option value="${r.id}">${esc(r.name)}</option>`).join('');
  const m = openModal({
    title: '新增兑换规则（决策：单向换算 · 完全自定义）',
    bodyHTML: `
      <div class="field"><label>规则标签</label><input id="f-rlabel" placeholder="例：深度工作换算"></div>
      <div class="field"><label>从（消耗）</label><select id="f-rfrom">${opts}</select></div>
      <div class="field"><label>到（获得）</label><select id="f-rto">${opts}</select></div>
      <div class="field"><label>1 从 = ? 到</label><input id="f-rrate" type="number" min="0.01" step="0.01" value="1"></div>`,
    footerHTML: `<button class="btn" data-cancel>取消</button><button class="btn primary" data-save>创建</button>`,
  });
  m.q('[data-cancel]').onclick = () => m.close();
  m.q('[data-save]').onclick = () => {
    const r = App.engine.createRule(App.db, {
      label: m.q('#f-rlabel').value, from: m.q('#f-rfrom').value,
      to: m.q('#f-rto').value, rate: m.q('#f-rrate').value,
    });
    if (!r.ok) return toast(r.error, 'err');
    m.close(); App.refresh(); toast('兑换规则已创建');
  };
}

export function openConvertModal(ruleId) {
  const rule = App.db.rules.find((r) => r.id === ruleId);
  if (!rule) return;
  const from = App.db.resources.find((r) => r.id === rule.from);
  const to = App.db.resources.find((r) => r.id === rule.to);
  const m = openModal({
    title: `执行兑换：${esc(rule.label)}`,
    bodyHTML: `
      <p class="muted">1 ${esc(from.name)} → ${rule.rate} ${esc(to.name)}（单向）</p>
      <div class="field"><label>消耗 ${esc(from.name)} 数量</label><input id="f-camt" type="number" min="0" step="0.01" placeholder="当前余额 ${fmtNum(App.engine.balanceOf(App.db, rule.from))}"></div>`,
    footerHTML: `<button class="btn" data-cancel>取消</button><button class="btn primary" data-save>兑换</button>`,
  });
  m.q('[data-cancel]').onclick = () => m.close();
  m.q('[data-save]').onclick = () => {
    const r = App.engine.convert(App.db, rule.id, m.q('#f-camt').value);
    if (!r.ok) return toast(r.error, 'err');
    m.close(); App.refresh(); toast('兑换完成，已生成双向流水', 'ok');
  };
}

function ruleRow(App, r) {
  const from = App.db.resources.find((x) => x.id === r.from);
  const to = App.db.resources.find((x) => x.id === r.to);
  return `
    <div class="rule-row">
      <div class="grow">
        <b>${esc(r.label)}</b> ${r.status === 'Active' ? badge('Active_', '启用') : badge('Inactive', '停用')}
        <div class="muted">1 ${esc(from?.name || '?')} → ${r.rate} ${esc(to?.name || '?')}</div>
      </div>
      <div class="row-gap">
        ${r.status === 'Active' ? `<button class="btn sm primary" onclick="App.overview.openConvertModal('${r.id}')">兑换</button>` : ''}
        <button class="btn sm" onclick="App.engine.setRuleStatus(App.db,'${r.id}','${r.status === 'Active' ? 'Inactive' : 'Active'}');App.refresh()">${r.status === 'Active' ? '停用' : '启用'}</button>
      </div>
    </div>`;
}

// ---------------- 商品 · 快速消费（LifeUp 式） ----------------
function costLabel(App, g) {
  const costs = App.engine.goodCosts(g);
  return costs.map((c) => {
    const r = App.db.resources.find((x) => x.id === c.resource_id);
    return `${fmtNum(c.amount)}${r?.unit ? esc(r.unit) : ''} ${esc(r?.name || '?')}`;
  }).join(' ＋ ');
}

function goodCard(App, g) {
  const costs = App.engine.goodCosts(g);
  const poor = costs.some((c) => App.engine.balanceOf(App.db, c.resource_id) < c.amount * 1);
  const balLine = costs.map((c) => {
    const r = App.db.resources.find((x) => x.id === c.resource_id);
    return `${esc(r?.name || '?')} 余 ${fmtNum(App.engine.balanceOf(App.db, c.resource_id))}`;
  }).join(' · ');
  return `
    <div class="good-card ${g.status === 'Inactive' ? 'off' : ''} ${poor ? 'poor' : ''}" onclick="App.overview.openConsumeModal('${g.id}')" title="点击消费（余额不足将借贷）">
      <div class="good-emoji">${esc(g.emoji)}</div>
      <div class="good-name">${esc(g.name)}</div>
      <div class="good-price">${costLabel(App, g)}</div>
      ${g.note ? `<div class="good-note">${esc(g.note)}</div>` : ''}
      <div class="good-bal muted">${balLine}</div>
      <div class="row-gap" style="margin-top:8px" onclick="event.stopPropagation()">
        <button class="btn sm" onclick="App.overview.openGoodModal('${g.id}')">编辑</button>
        <button class="btn sm" onclick="App.engine.setGoodStatus(App.db,'${g.id}','${g.status === 'Active' ? 'Inactive' : 'Active'}');App.refresh()">${g.status === 'Active' ? '停用' : '启用'}</button>
        <button class="btn sm danger" onclick="App.overview.delGood('${g.id}')">删除</button>
      </div>
    </div>`;
}

// 新增 / 编辑商品：多资源成本编辑器
export function openGoodModal(editId) {
  const g = editId ? App.db.goods.find((x) => x.id === editId) : null;
  const active = App.db.resources.filter((r) => r.status === 'Active');
  const resOpts = (sel) => active
    .map((r) => `<option value="${r.id}" ${sel === r.id ? 'selected' : ''}>${esc(r.name)}</option>`).join('');
  const initCosts = g ? App.engine.goodCosts(g) : [{ resource_id: active[0]?.id || '', amount: '' }];
  const m = openModal({
    title: g ? '编辑商品' : '新增商品（快速消费）',
    width: 560,
    bodyHTML: `
      <div class="field"><label>商品名称 *</label><input id="f-gname" value="${esc(g?.name || '')}" placeholder="例：一杯咖啡"></div>
      <div class="field"><label>图标（emoji）</label><input id="f-gemoji" value="${esc(g?.emoji || '')}" placeholder="☕"></div>
      <div class="field"><label>消耗资源（可多种，如 金钱+精力）</label>
        <div id="f-gcosts">
          ${initCosts.map((c) => `
            <div class="row-gap dg-cost-row" style="margin-bottom:6px">
              <select class="gc-res" style="flex:1">${resOpts(c.resource_id)}</select>
              <input type="number" class="gc-amt" min="0.01" step="0.01" value="${c.amount ?? ''}" placeholder="数量" style="width:110px">
              <button class="btn sm danger" data-delcost>✕</button>
            </div>`).join('')}
        </div>
        <button class="btn sm" data-addcost>＋ 加一种资源</button>
      </div>
      <div class="field"><label>备注</label><input id="f-gnote" value="${esc(g?.note || '')}" placeholder="可选"></div>`,
    footerHTML: `<button class="btn" data-cancel>取消</button><button class="btn primary" data-save>${g ? '保存' : '创建'}</button>`,
  });

  const bindDel = () => m.qa('[data-delcost]').forEach((b) => {
    b.onclick = () => b.closest('.dg-cost-row').remove();
  });
  m.q('[data-addcost]').onclick = () => {
    const div = document.createElement('div');
    div.className = 'row-gap dg-cost-row';
    div.style.marginBottom = '6px';
    div.innerHTML = `<select class="gc-res" style="flex:1">${resOpts()}</select>
      <input type="number" class="gc-amt" min="0.01" step="0.01" placeholder="数量" style="width:110px">
      <button class="btn sm danger" data-delcost>✕</button>`;
    m.q('#f-gcosts').appendChild(div);
    div.querySelector('[data-delcost]').onclick = () => div.remove();
  };
  bindDel();

  m.q('[data-cancel]').onclick = () => m.close();
  m.q('[data-save]').onclick = () => {
    const costs = [...m.qa('#f-gcosts .dg-cost-row')].map((row) => ({
      resource_id: row.querySelector('.gc-res').value,
      amount: row.querySelector('.gc-amt').value,
    })).filter((c) => c.resource_id && Number(c.amount) > 0);
    const payload = {
      name: m.q('#f-gname').value, emoji: m.q('#f-gemoji').value,
      costs, note: m.q('#f-gnote').value,
    };
    const r = g ? App.engine.updateGood(App.db, g.id, payload) : App.engine.createGood(App.db, payload);
    if (!r.ok) return toast(r.error, 'err');
    m.close(); App.refresh(); toast(g ? '已保存' : '商品已创建', 'ok');
  };
  setTimeout(() => { const e2 = m.q('#f-gname'); if (e2) e2.focus(); }, 60);
}

// 点击商品：确认数量后一键消费（逐资源生成 credit 流水，允许借贷）
export function openConsumeModal(goodId) {
  const g = App.db.goods.find((x) => x.id === goodId);
  if (!g) return;
  const costs = App.engine.goodCosts(g);
  const costLines = costs.map((c) => {
    const r = App.db.resources.find((x) => x.id === c.resource_id);
    const bal = App.engine.balanceOf(App.db, c.resource_id);
    return `<li>${fmtNum(c.amount)} ${esc(r?.unit || '')} · ${esc(r?.name || '?')}（余 <b class="${bal < c.amount ? 'neg' : 'pos'}">${fmtNum(bal)}</b>）</li>`;
  }).join('');
  const anyLack = costs.some((c) => App.engine.balanceOf(App.db, c.resource_id) < c.amount);
  const m = openModal({
    title: `消费「${g.name}」`,
    accent: 'warn',
    bodyHTML: `
      <div class="callout warn">${esc(g.emoji)} ${esc(g.name)} 消耗：</div>
      <ul style="margin:8px 0 12px;padding-left:20px;font-size:13px;line-height:1.9">${costLines}</ul>
      ${anyLack ? '<div class="callout">💡 部分资源不足，允许借贷扣为负数，后续充值自动回补。</div>' : ''}
      <div class="grid2">
        <div class="field"><label>数量</label><input id="f-gqty" type="number" min="1" step="1" value="1"></div>
        <div class="field"><label>备注</label><input id="f-gnote" placeholder="可选"></div>
      </div>`,
    footerHTML: `<button class="btn" data-cancel>取消</button><button class="btn primary" data-save>${anyLack ? '确认消费（借贷）' : '确认消费'}</button>`,
  });
  m.q('[data-cancel]').onclick = () => m.close();
  m.q('[data-save]').onclick = () => {
    const res = App.engine.consumeGood(App.db, g.id, { qty: m.q('#f-gqty').value, note: m.q('#f-gnote').value });
    if (!res.ok) return toast(res.error, 'err');
    m.close(); App.refresh(); toast('已消费，流水已入账', 'ok');
  };
}

export async function delGood(id) {
  const g = App.db.goods.find((x) => x.id === id);
  if (!g) return;
  if (!(await App.system.confirm({ title: '删除商品', message: `删除商品「${g.name}」？历史消费流水保留。` }))) return;
  const r = App.engine.deleteGood(App.db, id);
  if (!r.ok) return toast(r.error, 'err');
  App.refresh(); toast('商品已删除');
}

// ---------------- 活动：新建 / 编辑 / 完成弹窗 ----------------
// prePlanId：从「目标与计划」Tab 进来时预选该计划；presetStart：日历快捷新建预填该日
export function openActModal(editId, prePlanId, presetStart) {
  const { db, engine } = App;
  const a = editId ? db.activities.find((x) => x.id === editId) : null;
  const selected = new Set(a ? a.plan_ids : (prePlanId ? [prePlanId] : []));
  // 语境预填：新建时默认今天/上次用时/上次循环；从计划进来推导标题建议
  const prefs = Prefs.load();
  const plan = prePlanId ? db.plans.find((p) => p.id === prePlanId) : null;
  const defTitle = a ? a.title : (plan ? suggestTitle(plan.title) : '');
  const defStart = a ? (a.planned_start || (toDateInput(a.planned_date) + 'T09:00')) : (presetStart || (todayStr() + 'T09:00'));
  const defMin = a && a.planned_minutes ? a.planned_minutes : (prefs.lastMinutes ?? 60);
  const defRepeat = a ? a.repeat : (prefs.lastRepeat ?? '');
  let chosenTheme = a && a.theme ? { ...a.theme } : null;
  const plansHTML = () =>
    db.plans.map((p) =>
      `<label class="chk"><input type="checkbox" value="${p.id}" ${selected.has(p.id) ? 'checked' : ''}> ${esc(p.title)}</label>`
    ).join('') || '<div class="muted">请先创建计划</div>';
  const goalOptsHTML = (selectedId) =>
    db.goals.map((g) => `<option value="${g.id}" ${g.id === selectedId ? 'selected' : ''}>${esc(g.title)}</option>`).join('')
    || '<option value="">（请先创建目标）</option>';

  const m = openModal({
    title: a ? '编辑活动' : '新建活动',
    bodyHTML: `
      <div class="field"><label>活动名称 *</label><input id="f-aname" value="${esc(defTitle)}" placeholder="例：写 2000 字章节 1"></div>
      <div class="field"><label>备注</label><input id="f-anote" value="${esc(a?.note || '')}" placeholder="例：卡在第二章，注意节奏"></div>

      <div class="step-divider">关联计划（多选 N:M）</div>
      <div class="chk-group" id="actPlanChips">${plansHTML()}</div>
      <div class="row-gap" style="margin-top:8px">
        <button class="btn sm" data-newplan>＋ 新建计划</button>
        <button class="btn sm" data-newgoal>＋ 新建目标</button>
      </div>
      <div id="quick-create" data-enter-zone style="display:none;border:1px dashed #dfe3ea;border-radius:10px;padding:12px;margin-top:10px">
        <div id="quick-goal" style="display:none">
          <div class="step-divider">新目标</div>
          <div class="field"><label>目标名称 *</label><input id="f-qgoal" placeholder="例：写一本书"></div>
          <div class="field"><label>描述</label><input id="f-qgoaldesc"></div>
          <button class="btn sm primary" data-enter data-savegoal>保存目标</button>
        </div>
        <div id="quick-plan" style="display:none">
          <div class="step-divider">新计划</div>
          <div class="field"><label>所属目标</label><select id="f-qplangoal">${goalOptsHTML()}</select></div>
          <div class="field"><label>计划名称 *</label><input id="f-qplan" placeholder="例：每天写 2000 字"></div>
          <div class="field"><label>预算 价值元（留空 = 无限 ∞）</label><input id="f-qbudget" type="number" min="0"></div>
          <button class="btn sm primary" data-enter data-saveplan>保存计划</button>
        </div>
      </div>

      <div class="grid2">
        <div class="field"><label>计划开始时间（分钟级）</label><input id="f-ps" type="datetime-local" value="${defStart}"></div>
        <div class="field"><label>计划投入（分钟）</label><input id="f-apmin" type="number" min="0" value="${defMin}"></div>
      </div>
      <div id="atomic-preview" class="muted" style="display:none;font-size:12px;margin:2px 0 4px"></div>
      <label class="chk" id="keep-conflict-row" style="display:none;margin:0 0 8px"><input type="checkbox" id="f-keepconflict"> 坚持此时间（与冲突活动捆绑，开始时仲裁先后）</label>
      <div class="grid2">
        <div class="field"><label>循环</label><select id="f-arepeat">
          <option value="">不循环</option>
          <option value="daily" ${defRepeat === 'daily' ? 'selected' : ''}>每天</option>
          <option value="weekday" ${defRepeat === 'weekday' ? 'selected' : ''}>工作日</option>
          <option value="weekly" ${defRepeat === 'weekly' ? 'selected' : ''}>每周</option>
          <option value="monthly" ${defRepeat === 'monthly' ? 'selected' : ''}>每月</option>
        </select></div>
        <div class="field"><label>循环结束日（留空 = 一直）</label><input id="f-arepuntil" type="date" value="${a?.repeat_until || ''}"></div>
      </div>
      <div class="field"><label>卡片主题（虚化背景，可选）</label><div id="actThemePicker"></div></div>`,
    footerHTML: `<button class="btn" data-cancel>取消</button><button class="btn primary" data-save>${a ? '保存' : '创建（Planned）'}</button>`,
  });

  const quick = m.q('#quick-create');
  const qGoal = m.q('#quick-goal');
  const qPlan = m.q('#quick-plan');
  const refreshPlanChips = (selId) => { if (selId) selected.add(selId); m.q('#actPlanChips').innerHTML = plansHTML(); };
  const refreshGoalSelect = (selId) => { m.q('#f-qplangoal').innerHTML = goalOptsHTML(selId); };

  // 卡片主题选择（渐变 / 上传图片 / 无）
  const tp = m.q('#actThemePicker');
  if (tp) {
    tp.innerHTML = themePickerHTML({ chosen: chosenTheme });
    bindThemePicker(tp, {
      onPick: (t) => { chosenTheme = t; },
      onUpload: (f) => readImageAsDataURL(f, (url) => { if (url) chosenTheme = { type: 'image', url }; }),
    });
  }

  // ＋ 新建计划：无目标则先引导建目标，否则展开计划表单
  m.q('[data-newplan]').onclick = () => {
    quick.style.display = 'block';
    if (!db.goals.length) {
      qGoal.style.display = 'block'; qPlan.style.display = 'none';
      toast('请先创建目标', 'info'); m.q('#f-qgoal').focus();
    } else {
      qPlan.style.display = 'block'; qGoal.style.display = 'none';
      refreshGoalSelect(); m.q('#f-qplan').focus();
    }
  };
  // ＋ 新建目标：展开目标表单
  m.q('[data-newgoal]').onclick = () => {
    quick.style.display = 'block'; qGoal.style.display = 'block'; qPlan.style.display = 'none';
    m.q('#f-qgoal').focus();
  };
  // 保存目标 → 刷新目标下拉并自动切到计划表单
  m.q('[data-savegoal]').onclick = () => {
    const r = engine.createGoal(db, { title: m.q('#f-qgoal').value, desc: m.q('#f-qgoaldesc').value });
    if (!r.ok) return toast(r.error, 'err');
    const gid = db.goals[db.goals.length - 1].id;
    m.q('#f-qgoal').value = ''; m.q('#f-qgoaldesc').value = '';
    refreshGoalSelect(gid);
    qGoal.style.display = 'none'; qPlan.style.display = 'block';
    toast('目标已创建，可继续建计划');
    m.q('#f-qplan').focus();
  };
  // 保存计划 → 刷新计划多选并默认勾选新计划
  m.q('[data-saveplan]').onclick = () => {
    const bRaw = m.q('#f-qbudget').value.trim();
    const budget = bRaw === '' ? null : Number(bRaw);
    const r = engine.createPlan(db, { goal_id: m.q('#f-qplangoal').value, title: m.q('#f-qplan').value, budget });
    if (!r.ok) return toast(r.error, 'err');
    const pid = db.plans[db.plans.length - 1].id;
    m.q('#f-qplan').value = ''; m.q('#f-qbudget').value = '';
    refreshPlanChips(pid);
    toast('计划已创建并勾选', 'ok');
  };

  m.q('[data-cancel]').onclick = () => m.close();
  // 时间原子性实时预览：截止时刻推算 + 冲突检测（撞车时给出「坚持并捆绑」选项）
  const hm = (ms) => { const d = new Date(ms); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
  const previewAtomic = () => {
    const box = m.q('#atomic-preview');
    const row = m.q('#keep-conflict-row');
    const ps = m.q('#f-ps').value;
    const mins = Number(m.q('#f-apmin').value) || 0;
    if (!ps || mins <= 0 || isNaN(new Date(ps).getTime())) { box.style.display = 'none'; row.style.display = 'none'; return; }
    const s = new Date(ps).getTime(), e2 = s + mins * 60000;
    const hits = engine.findConflicts(db, { startMs: s, endMs: e2, excludeId: a ? a.id : null });
    box.style.display = 'block';
    if (!hits.length) {
      box.innerHTML = `🕐 ${hm(s)}–${hm(e2)} · 无冲突`;
      row.style.display = 'none';
    } else {
      box.innerHTML = `⚠ ${hm(s)}–${hm(e2)} 与 ${hits.map((h) => `「${esc(h.title)}」`).join('、')} 重叠，保存时将自动顺延`;
      row.style.display = 'block';
    }
  };
  m.q('#f-ps').addEventListener('input', previewAtomic);
  m.q('#f-apmin').addEventListener('input', previewAtomic);
  previewAtomic();
  m.q('[data-save]').onclick = () => {
    const plan_ids = [...m.qa('#actPlanChips input[type=checkbox]:checked')].map((e) => e.value);
    const payload = {
      title: m.q('#f-aname').value, note: m.q('#f-anote').value, plan_ids,
      planned_start: m.q('#f-ps').value || null,
      planned_minutes: m.q('#f-apmin').value,
      repeat: m.q('#f-arepeat').value || null,
      repeat_until: m.q('#f-arepuntil').value || null,
      theme: chosenTheme || null,
      keep_conflict: m.q('#f-keepconflict') ? m.q('#f-keepconflict').checked : false,
    };
    const r = a ? engine.updateActivity(db, a.id, payload) : engine.createActivity(db, payload);
    if (!r.ok) return toast(r.error, 'err');
    // 记住输入习惯，下次按语境预填
    Prefs.set({
      lastMinutes: Number(payload.planned_minutes) || 0,
      lastRepeat: payload.repeat || '',
    });
    m.close(); App.refresh();
    if (r.spawned) toast('已按循环生成下一期任务', 'ok');
    else if (r.shifted) toast(`⏩ 时段冲突，已自动顺延至 ${(r.to || '').replace('T', ' ')}`, 'ok');
    else if (r.bundled) toast('⚠ 已保留时间重叠并与冲突活动捆绑，开始时将仲裁先后', 'ok');
    else toast(a ? '已保存' : '活动已创建，去「开始」吧', 'ok');
  };
  // 进入即聚焦活动名称框，唤起输入
  setTimeout(() => { const el = m.q('#f-aname'); if (el) el.focus(); }, 60);
}

// 完成弹窗：同时登记 支出 + 收入 + 产出（不变量2 / 4A / 10B）
export function openCompleteModal(activityId) {
  const { db } = App;
  const a = db.activities.find((x) => x.id === activityId);
  if (!a) return;
  // 语境预填：有按任务计时 → 支出用「时间」并填已计分钟；否则用上次支出资源
  const prefs = Prefs.load();
  const tracked = App.engine.trackedMinutes(db, a.id);
  const timeRes = db.resources.find((r) => r.name === '时间');
  const active = db.resources.filter((r) => r.status === 'Active');
  const defExpenseRes = (tracked > 0 && timeRes) ? timeRes.id
    : (prefs.lastExpenseRes && active.some((r) => r.id === prefs.lastExpenseRes) ? prefs.lastExpenseRes
      : (active[0] ? active[0].id : ''));
  const resOpts = (sel) => active
    .map((r) => `<option value="${r.id}" ${r.id === sel ? 'selected' : ''}>${esc(r.name)}（余额 ${fmtNum(App.engine.balanceOf(db, r.id))}）</option>`).join('');
  // 语境提速：收入金额/产出标题/tags 按上次或活动语境预填，用户只需微调
  const defIncomeAmt = prefs.lastIncomeAmount || '';
  const defOutTitle = a.title;
  const defTags = prefs.lastOutputTags || '';
  const recentTags = [...new Set(db.outputs.slice(-12).flatMap((o) => o.tags || []))].slice(0, 8);

  const m = openModal({
    title: `完成活动 · 收支闭环（不变量2）`,
    width: 560,
    accent: 'warn',
    bodyHTML: `
      <div class="callout warn">「${esc(a.title)}」进入 Completed 需登记 <b>支出/收入</b> 至少一笔，并挂 <b>产出</b>。可同时填收支两栏。</div>
      ${tracked > 0 ? `<div class="callout">⏱ 已按任务计时 <b>${tracked}</b> 分钟，支出金额已预填，可按需调整。</div>` : ''}
      <div class="step-divider step-1">① 支出（消耗 · 可空）</div>
      <div class="grid2">
        <div class="field"><label>资源</label><select id="f-ce_res">${resOpts(defExpenseRes)}</select></div>
        <div class="field"><label>金额 &gt; 0</label><input id="f-ce_amt" type="number" min="0" step="0.01" value="${tracked > 0 ? tracked : defIncomeAmt}"></div>
      </div>
      <div class="field"><label>备注</label><input id="f-ce_note" placeholder="例：写作消耗"></div>
      <div class="step-divider step-1">② 收入（获得 · 可空）</div>
      <div class="grid2">
        <div class="field"><label>资源</label><select id="f-ci_res">${resOpts(prefs.lastIncomeRes)}</select></div>
        <div class="field"><label>金额 &gt; 0</label><input id="f-ci_amt" type="number" min="0" step="0.01" value="${defIncomeAmt}"></div>
      </div>
      <div class="field"><label>备注</label><input id="f-ci_note" placeholder="例：收到认可回充"></div>
      <div class="step-divider step-2">③ 产出（10B / 11B 自由标签）</div>
      <div class="field"><label>产出标题 *</label><input id="f-cout" value="${esc(defOutTitle)}"></div>
      <div class="field"><label>产出 tags（逗号分隔）</label><input id="f-ctags" value="${esc(defTags)}" placeholder="写作,交付">
        ${recentTags.length ? `<div class="tag-suggest">${recentTags.map((t) => `<button type="button" class="tag-chip" data-tag="${esc(t)}">${esc(t)}</button>`).join('')}</div>` : ''}
      </div>`,
    footerHTML: `<button class="btn" data-cancel>取消</button><button class="btn primary" data-save>原子提交 → Completed</button>`,
  });
  m.q('[data-cancel]').onclick = () => m.close();
  // 最近产出 tags 一键追加
  m.qa('.tag-chip').forEach((c) => {
    c.onclick = () => {
      const inp = m.q('#f-ctags');
      const cur = inp.value.split(',').map((s) => s.trim()).filter(Boolean);
      if (!cur.includes(c.dataset.tag)) { cur.push(c.dataset.tag); inp.value = cur.join(','); }
    };
  });
  m.q('[data-save]').onclick = () => {
    const tags = m.q('#f-ctags').value.split(',').map((s) => s.trim()).filter(Boolean);
    const eAmt = Number(m.q('#f-ce_amt').value);
    const iAmt = Number(m.q('#f-ci_amt').value);
    const r = App.engine.completeActivity(App.db, activityId, {
      expense: eAmt > 0 ? { resource_id: m.q('#f-ce_res').value, amount: eAmt, note: m.q('#f-ce_note').value } : null,
      income: iAmt > 0 ? { resource_id: m.q('#f-ci_res').value, amount: iAmt, note: m.q('#f-ci_note').value } : null,
      output_title: m.q('#f-cout').value, output_tags: tags,
    });
    if (!r.ok) return toast(r.error, 'err');
    // 记住收支资源/金额与产出 tags 偏好，下次按语境预填
    Prefs.set({
      lastExpenseRes: m.q('#f-ce_res').value,
      lastIncomeRes: m.q('#f-ci_res').value,
      lastIncomeAmount: iAmt > 0 ? String(iAmt) : '',
      lastOutputTags: tags.join(','),
    });
    m.close(); App.refresh(); toast('活动已完成，收支与产出已入账', 'ok');
  };
}

// ---------------- 活动看板 ----------------
// 拖拽标记：拖完不触发卡片点击进入编辑
let wasDragging = false;
let actMenuListenerBound = false;

function activityCard(App, a) {
  const { db, engine } = App;
  const pn = a.plan_ids.map((pid) => {
    const p = db.plans.find((x) => x.id === pid);
    if (!p) return '';
    const g = db.goals.find((x) => x.id === p.goal_id);
    return (g ? `${esc(g.title)}：` : '') + esc(p.title);
  }).filter(Boolean).join(' · ') || '未关联';
  const outs = db.outputs.filter((o) => o.activity_id === a.id);
  const blocked = engine.anyPlanBlocked(db, a.plan_ids);
  const tracked = engine.trackedMinutes(db, a.id);
  const hasLogs = Array.isArray(a.time_logs) && a.time_logs.length > 0;
  const plannedMin = a.planned_minutes || 0;
  const tpct = plannedMin > 0 ? Math.min(100, (tracked / plannedMin) * 100) : 0;
  const trackedLabel = tracked > 0 ? `${tracked}m` : (hasLogs ? '<1m' : '0m');

  const stateActions = {
    Planned: `<button class="btn sm primary" onclick="App.startAct('${a.id}')" ${blocked ? 'disabled title="预算耗尽"' : ''}>开始</button>`,
    Started: `<button class="btn sm primary" onclick="App.overview.openCompleteModal('${a.id}')" ${blocked ? 'disabled title="预算耗尽"' : ''}>完成</button>`,
    Completed: `<button class="btn sm" onclick="App.engine.setActivityStatus(App.db,'${a.id}','Reviewed');App.refresh()">复盘</button>`,
    Reviewed: `<button class="btn sm" onclick="App.engine.setActivityStatus(App.db,'${a.id}','Archived');App.refresh()">归档</button>`,
    Archived: '',
  }[a.status] || '';
  const pcolor = activityPlanColor(db, a.plan_ids);
  const th = themeStyle(a.theme);
  const tone = themeTone(a.theme); // 'dark' | 'light' | null(图片待采样)

  return `
    <div class="kanban-card ${blocked ? 'warned' : ''} ${th ? 'themed' : ''} ${tone === 'light' ? 'tone-light' : ''}" draggable="true" data-id="${a.id}" ${th && tone === null ? 'data-await-tone="1"' : ''} onclick="App.overview.editActivityCard('${a.id}', event)" title="点击编辑" style="border-left:4px solid ${pcolor || '#e5e8ee'}${!th && pcolor ? `;background:${hexToRgba(pcolor, 0.05)}` : ''}">
      ${th ? `<div class="kc-bg" style="background:${th}"></div>` : ''}
      <div class="kc-head">
        <span class="kc-title">${esc(a.title)}</span>
        ${badge(a.status)}
      </div>
      ${a.note ? `<div class="kc-note">📝 ${esc(a.note)}</div>` : ''}
      <div class="kc-meta">${pn}${a.actual_start ? ` · 开始 ${fmtDateTime(a.actual_start)}` : ''}${a.actual_end ? ` · 结束 ${fmtDateTime(a.actual_end)}` : ''}</div>
      ${(tracked > 0 || plannedMin > 0 || hasLogs) ? `
      <div class="kc-time-progress" title="已计时 ${trackedLabel} / 计划 ${plannedMin || '—'} 分钟">
        <div class="kc-tp-label"><span><b style="color:${pcolor || '#ff2d55'}">⏱ 已计时 ${trackedLabel}</b>${plannedMin ? ` / 计划 ${plannedMin}m` : ''}</span>${plannedMin ? `<span>${tpct >= 100 ? '100+' : Math.round(tpct)}%</span>` : ''}</div>
        ${plannedMin ? `<div class="progress"><i class="bar" style="width:${tpct}%;background:${pcolor || '#ff2d55'}"></i></div>` : ''}
      </div>` : ''}
      ${(a.planned_start || a.planned_date) ? `<div class="kc-meta muted">📅 ${a.planned_start ? `${a.planned_start.replace('T', ' ').slice(5)}${plannedEndOf(a) ? `–${plannedEndOf(a)}` : ''}` : esc(String(a.planned_date))}${a.planned_minutes ? ` · 计划 ${a.planned_minutes}m` : ''}</div>` : ''}
      ${a.repeat ? `<div class="kc-meta"><span class="badge b-purple">🔁 ${REPEAT_LABEL[a.repeat] || a.repeat}</span>${a.repeat_until ? ` 至 ${esc(a.repeat_until)}` : ''}</div>` : ''}
      ${blocked ? `<div class="kc-meta warn">⛔ 关联计划预算已耗尽</div>` : ''}
      ${outs.length ? `<div class="kc-outs">${outs.map((o) => `
        <div class="kc-out">
          <span>📄 ${esc(o.title)} ${o.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join('')} ${badge(o.status)}</span>
          ${o.status === 'Draft' ? `<button class="btn sm" onclick="App.engine.setOutputStatus(App.db,'${o.id}','Published');App.refresh()">发布</button>`
            : o.status === 'Published' ? `<button class="btn sm primary" onclick="App.engine.setOutputStatus(App.db,'${o.id}','Archived');App.refresh()">归档 → 价值流</button>` : ''}
        </div>`).join('')}</div>` : ''}
      <div class="kc-actions">
        <button class="btn sm timer-btn" onclick="App.timer.openForActivity('${a.id}')">🍅 计时</button>
        ${stateActions}
        <div class="act-menu-wrap">
          <button class="btn sm" title="更多操作" onclick="App.overview.toggleActMenu('${a.id}')">⋯</button>
          <div class="act-menu hidden" id="am-${a.id}">
            <button onclick="App.overview.openActModal('${a.id}')">编辑</button>
            <button class="danger" onclick="App.overview.delAct('${a.id}')">删除</button>
          </div>
        </div>
      </div>
    </div>`;
}

// 溢出菜单：⋯ 展开/收起（同一时刻只开一个，点别处自动关闭）
export function toggleActMenu(id) {
  const el = document.getElementById('am-' + id);
  if (!el) return;
  const willOpen = el.classList.contains('hidden');
  closeActMenus();
  if (willOpen) el.classList.remove('hidden');
}
export function closeActMenus() {
  document.querySelectorAll('.act-menu:not(.hidden)').forEach((m) => m.classList.add('hidden'));
}

// 图片主题：异步采样平均亮度，补上「白字/深字」类
function settleThemeTones(App, root) {
  root.querySelectorAll('.kanban-card[data-await-tone]').forEach((card) => {
    const a = App.db.activities.find((x) => x.id === card.dataset.id);
    if (!a || !a.theme) return;
    sampleImageTone(a.theme, (tone) => {
      if (tone === 'light') card.classList.add('tone-light');
      card.removeAttribute('data-await-tone');
    });
  });
}

// 日程/看板 并列轮播：transform 平移（无滚动事件→无渲染冲突）+ 高度过渡，下方卡片平滑跟随
let pagerResizeBound = false;
let pagerTimer = null; // 自动播放定时器
function isCarousel() { return window.matchMedia('(max-width: 860px)').matches; }
function stopPagerAutoplay() {
  if (pagerTimer) { clearInterval(pagerTimer); pagerTimer = null; }
}
// 聚焦活动 Tab 时自动播放：统一每 2 秒循环切换（带动画），离开页面/用户一动手即停
function startPagerAutoplay(pager) {
  stopPagerAutoplay();
  if (!isCarousel()) return;
  pagerTimer = setInterval(() => {
    if (!pager.isConnected || !document.body.contains(pager)) { stopPagerAutoplay(); return; }
    const items = [...pager.querySelectorAll('.dash-nav-item')];
    const cur = items.findIndex((b) => b.classList.contains('on'));
    const n = pager.querySelectorAll('.dash-page').length;
    if (cur < 0 || n < 2) return;
    goToPage(pager, (cur + 1) % n);
  }, 2000);
}
function layoutPager(pager) {
  const pages = pager.querySelectorAll('.dash-page');
  const track = pager.querySelector('.dash-track');
  if (!pages.length || !track) return;
  const n = pages.length;
  track.style.width = (n * 100) + '%';
  pages.forEach((p) => { p.style.flex = `0 0 ${100 / n}%`; p.style.minWidth = `${100 / n}%`; });
}
function goToPage(pager, idx, instant) {
  if (!isCarousel()) return; // 桌面堆叠：不做轮播
  const pages = pager.querySelectorAll('.dash-page');
  const track = pager.querySelector('.dash-track');
  if (!pages.length || !track) return;
  const n = pages.length;
  const cur = Math.max(0, Math.min(idx, n - 1));
  if (instant) track.style.transition = 'none';
  track.style.transform = `translateX(-${(cur / n) * 100}%)`;
  if (instant) { void track.offsetWidth; track.style.transition = ''; }
  // 高度 = 当前页内容 + 顶部导航高度（否则下方内容被裁/重叠）
  const navH = (pager.querySelector('.dash-nav')?.offsetHeight) || 0;
  pager.style.height = ((pages[cur].offsetHeight || pager.offsetHeight) + navH) + 'px';
  pager.querySelectorAll('.dash-nav-item').forEach((b, i) => b.classList.toggle('on', i === cur));
}
function syncPager(App, root) {
  const pager = root.querySelector('.dash-pager');
  if (!pager) return;
  layoutPager(pager);
  goToPage(pager, 0, true);
  // 左右滑动切换（到边界后回退为 Tab 切换）；用户一碰即停自动播放
  let tx = null;
  pager.addEventListener('touchstart', (e) => { stopPagerAutoplay(); if (e.touches.length === 1) tx = e.touches[0].clientX; }, { passive: true });
  pager.addEventListener('touchend', (e) => {
    if (tx === null) return;
    const dx = e.changedTouches[0].clientX - tx;
    tx = null;
    if (Math.abs(dx) <= 48) return;
    const items = [...pager.querySelectorAll('.dash-nav-item')];
    const cur = items.findIndex((b) => b.classList.contains('on'));
    const n = pager.querySelectorAll('.dash-page').length;
    const next = dx < 0 ? cur + 1 : cur - 1;
    if (next >= 0 && next < n) {
      goToPage(pager, next);
    } else if (next >= n) {
      // 右边界左滑：容器到底 → 回退为 Tab 切换（跳到下一个 Tab）
      App.setTab('goals');
    }
    // 左边界右滑：overview 是首个 Tab，无上一页可回退，忽略
  }, { passive: true });
  // 点击导航切换（同样停自动播放）
  pager.querySelectorAll('.dash-nav-item').forEach((b) => {
    b.onclick = () => { stopPagerAutoplay(); goToPage(pager, Number(b.dataset.page)); };
  });
  // 聚焦活动 Tab：自动播放（循环演示）
  startPagerAutoplay(pager);
  if (!pagerResizeBound) {
    pagerResizeBound = true;
    window.addEventListener('resize', () => {
      const p = document.querySelector('.dash-pager');
      if (!p) return;
      const cur = [...p.querySelectorAll('.dash-nav-item')].findIndex((b) => b.classList.contains('on'));
      layoutPager(p);
      goToPage(p, cur < 0 ? 0 : cur, true);
    });
  }
  // 图片主题采样后尺寸稳定：按当前页重新测量高度（不重置页码）
  setTimeout(() => {
    const cur = [...pager.querySelectorAll('.dash-nav-item')].findIndex((b) => b.classList.contains('on'));
    goToPage(pager, cur < 0 ? 0 : cur, true);
  }, 150);
}

// 点击卡片进入编辑（拖拽/点按钮不触发）
export function editActivityCard(id, ev) {
  if (wasDragging) return;
  if (ev && ev.target && ev.target.closest('button, input, select, textarea, .kc-out')) return;
  openActModal(id);
}

export async function delAct(id) {
  const a = App.db.activities.find((x) => x.id === id);
  if (!a) return;
  const im = App.engine.activityDeleteImpact(App.db, id);
  const parts = [];
  if (im.txs) parts.push(`${im.txs} 条流水`);
  if (im.outs) parts.push(`${im.outs} 个产出`);
  if (im.vfs) parts.push(`${im.vfs} 条价值流`);
  const msg = parts.length
    ? `删除活动「${a.title}」将连带删除：${parts.join('、')}。确定？`
    : `删除活动「${a.title}」？`;
  if (!(await App.system.confirm({ title: '删除活动', message: msg }))) return;
  const r = App.engine.deleteActivityCascade(App.db, id);
  if (!r.ok) return toast(r.error, 'err');
  App.refresh(); toast('已删除');
}

const COLUMNS = [
  { key: 'Planned', label: '📋 待办', match: (s) => s === 'Planned' },
  { key: 'Started', label: '⚡ 进行中', match: (s) => s === 'Started' },
  { key: 'Done', label: '✅ 已完成 / 复盘 / 归档', match: (s) => ['Completed', 'Reviewed', 'Archived'].includes(s) },
];

// 已完成列防撑爆：默认只显最近完成的 3 条，点按钮展开/收起（内存态，刷新保留）
const DONE_PREVIEW = 3;
let doneExpanded = false;

function kanbanHTML(App) {
  return COLUMNS.map((col) => {
    let items = App.db.activities.filter((a) => col.match(a.status));
    if (col.key === 'Done') {
      items = [...items].sort((x, y) => (y.actual_end || y.created || 0) - (x.actual_end || x.created || 0));
    }
    const shown = (col.key === 'Done' && !doneExpanded) ? items.slice(0, DONE_PREVIEW) : items;
    const hidden = items.length - shown.length;
    const more = (col.key === 'Done' && (hidden > 0 || doneExpanded)) && items.length > DONE_PREVIEW
      ? `<button class="btn sm" style="margin:8px auto 0;display:block;width:auto" onclick="App.overview.toggleDone()">${doneExpanded ? '⬆ 收起，只看最近 ' + DONE_PREVIEW + ' 条' : `⬇ 展开更早的 ${hidden} 条`}</button>`
      : '';
    return `
      <div class="kanban-col" data-col="${col.key}">
        <div class="kanban-head">
          ${col.label} <span class="cnt">${items.length}</span>
          <button class="btn sm" title="快速添加待办" onclick="App.overview.openActModal()">＋</button>
        </div>
        <div class="kanban-body">${shown.map((a) => activityCard(App, a)).join('') || '<div class="kanban-add">＋ 点击添加待办</div>'}${more}</div>
      </div>`;
  }).join('');
}

export function toggleDone() {
  doneExpanded = !doneExpanded;
  App.refresh();
}

function setupDrag(App) {
  const content = document.getElementById('content');
  let dragId = null;
  // 点溢出菜单外部 → 关闭菜单（仅注册一次）
  if (!actMenuListenerBound) {
    actMenuListenerBound = true;
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.act-menu, .act-menu-wrap')) closeActMenus();
    });
  }
  // 点击看板列空白处 → 快速添加待办
  content.querySelectorAll('.kanban-col').forEach((col) => {
    col.onclick = (e) => {
      if (e.target.closest('.kanban-card, .kanban-head, button, input, select, textarea')) return;
      App.overview.openActModal();
    };
  });
  content.querySelectorAll('.kanban-card').forEach((c) => {
    c.ondragstart = () => { dragId = c.dataset.id; c.classList.add('dragging'); };
    c.ondragend = () => { c.classList.remove('dragging'); dragId = null; content.querySelectorAll('.kanban-col').forEach((x) => x.classList.remove('drag-over')); };
  });
  content.querySelectorAll('.kanban-col').forEach((col) => {
    col.ondragover = (e) => { e.preventDefault(); col.classList.add('drag-over'); };
    col.ondragleave = () => col.classList.remove('drag-over');
    col.ondrop = (e) => {
      e.preventDefault(); col.classList.remove('drag-over');
      if (!dragId) return;
      const a = App.db.activities.find((x) => x.id === dragId);
      if (!a) return;
      const target = col.dataset.col;
      const r = (fn) => { const res = fn(); if (res && !res.ok) toast(res.error, 'err'); else App.refresh(); };
      if (target === 'Started') {
        if (a.status === 'Planned') { App.startAct(a.id); return; }
      } else if (target === 'Done') {
        if (a.status === 'Started') openCompleteModal(a.id);
      }
      // 其余回退/非法拖拽：忽略（状态机铁律）
    };
  });
}

// ---------------- 价值流 ----------------
export function openFeedbackModal(vfId) {
  const v = App.db.valueflows.find((x) => x.id === vfId);
  if (!v) return;
  const out = App.db.outputs.find((o) => o.id === v.output_id);
  const st = App.engine.vfStatus(App.db, v);
  const m = openModal({
    title: '录入价值流反馈（16BC 闭环）',
    accent: 'ok',
    bodyHTML: `
      <div class="callout">产出「${esc(out?.title || v.output_id)}」· 当前 ${badge(st)}${st === 'Overdue' ? '（已逾期，可补录）' : ''}</div>
      <div class="grid2">
        <div class="field"><label>给予方</label><input id="f-vg" value="${esc(v.giver || '')}" placeholder="例：我"></div>
        <div class="field"><label>接收方</label><input id="f-vr" value="${esc(v.receiver || '')}" placeholder="例：读者"></div>
      </div>
      <div class="field"><label>反馈内容</label><textarea id="f-vfb" rows="3" placeholder="外部反响 / 自我复盘"></textarea></div>
      <label class="chk"><input type="checkbox" id="f-vrec" checked> 回充资源 +10 价值元（决策 15C）</label>`,
    footerHTML: `<button class="btn" data-cancel>取消</button><button class="btn primary" data-save>闭环</button>`,
  });
  m.q('[data-cancel]').onclick = () => m.close();
  m.q('[data-save]').onclick = () => {
    const r = App.engine.closeValueflow(App.db, v.id, {
      feedback: m.q('#f-vfb').value, recharge: m.q('#f-vrec').checked,
    });
    if (!r.ok) return toast(r.error, 'err');
    if (m.q('#f-vg').value.trim()) v.giver = m.q('#f-vg').value.trim();
    if (m.q('#f-vr').value.trim()) v.receiver = m.q('#f-vr').value.trim();
    m.close(); App.refresh(); toast('价值流已闭环', 'ok');
  };
}

function vfRow(App, v) {
  const out = App.db.outputs.find((o) => o.id === v.output_id);
  const st = App.engine.vfStatus(App.db, v);
  const who = [v.giver, v.receiver].filter(Boolean).join(' → ');
  return `
    <div class="vf-row">
      <div class="grow">
        <div>📤 ${esc(out?.title || v.output_id)} ${badge(st)}</div>
        <div class="muted">${who ? esc(who) + ' · ' : ''}期望反馈 ${fmtDate(v.expected)}</div>
        ${v.feedback ? `<div class="muted">💬 ${esc(v.feedback)}</div>` : ''}
      </div>
      ${st !== 'Closed' ? `<button class="btn sm primary" onclick="App.overview.openFeedbackModal('${v.id}')">录入反馈</button>` : ''}
    </div>`;
}

// ---------------- 主渲染 ----------------
export function render(App, el) {
  const { db, engine } = App;
  const blocked = db.plans.filter((p) => engine.isPlanBlocked(db, p.id));
  const overdue = db.valueflows.filter((v) => engine.vfStatus(db, v) === 'Overdue');

  el.innerHTML = `
    <div class="dash-pager" id="dash-pager">
      <div class="dash-nav">
        <button type="button" class="dash-nav-item on" data-page="0">📅 当日日程</button>
        <button type="button" class="dash-nav-item" data-page="1">📋 活动看板</button>
      </div>
      <div class="dash-track">
        <section class="dash-page">
          <div id="calendar-section"></div>
        </section>
        <section class="dash-page">
          <div class="card">
            <div class="card-head">
              <h3>活动看板</h3>
              <div class="row-gap">
                <span class="muted">五态：Planned → Started → Completed → Reviewed → Archived · 卡片可编辑/删除 · 拖拽流转</span>
                <button class="btn sm primary" onclick="App.overview.openActModal()">＋ 活动</button>
              </div>
            </div>
            <div class="kanban">${kanbanHTML(App)}</div>
          </div>
        </section>
      </div>
    </div>

    <section class="row-layout">
      <div class="card grow">
        <div class="card-head">
          <h3>资源状态</h3>
          <div class="row-gap">
            <span class="muted">余额 = 初始 + Σ(debit−credit) · 不变量1</span>
            <button class="btn sm" onclick="App.overview.openResModal()">＋ 资源</button>
          </div>
        </div>
        <div class="res-grid">${db.resources.map((r) => resourceCard(App, r)).join('')}</div>
      </div>
      <div class="card narrow">
        <div class="card-head">
          <h3>兑换规则</h3>
          <button class="btn sm" onclick="App.overview.openRuleModal()">＋ 新增</button>
        </div>
        ${db.rules.map((r) => ruleRow(App, r)).join('') || empty('暂无规则')}
      </div>
    </section>

    <section class="row-layout">
      <div class="card grow">
        <div class="card-head">
          <h3>🛍️ 商店 · 快速消费</h3>
          <div class="row-gap">
            <span class="muted">LifeUp 式一键消费 · 点击商品直接扣减余额</span>
            <button class="btn sm" onclick="App.overview.openGoodModal()">＋ 商品</button>
          </div>
        </div>
        <div class="goods-grid">${db.goods.map((g) => goodCard(App, g)).join('') || empty('暂无商品', '添加商品后即可一键快速消费')}</div>
      </div>
    </section>

    <section class="row-layout">
      <div class="card grow">
        <div class="card-head"><h3>价值流</h3><span class="muted">产出归档自动生成 · Pending → Closed / Overdue</span></div>
        ${db.valueflows.map((v) => vfRow(App, v)).join('') || empty('暂无价值流', '产出「归档」后自动生成')}
      </div>
      <div class="card narrow">
        <div class="card-head"><h3>系统反馈</h3></div>
        ${blocked.length ? blocked.map((p) => `
          <div class="fb warn"><b>⛔ 预算硬约束（不变量4）</b><p>「${esc(p.title)}」已耗 ${fmtNum(engine.planCost(db, p.id))}/${fmtNum(p.budget)}，新活动禁止开始/完成。</p></div>`).join('') : ''}
        ${overdue.length ? `<div class="fb warn"><b>⏰ 价值流逾期（16C）</b><p>${overdue.length} 条待补录反馈，可手动闭环。</p></div>` : ''}
        ${!blocked.length && !overdue.length ? '<div class="fb ok"><b>✓ 全部不变量满足</b><p>同惠链路正常，账目自洽。</p></div>' : ''}
      </div>
    </section>
  `;
  calendar.renderSection(App, el.querySelector('#calendar-section'));
  setupDrag(App);
  settleThemeTones(App, el);
  syncPager(App, el);
}

``



================================================
FILE: C:\Users\qu\Desktop\物理科学与技术论题\TS2\personal-erp\src\views\setup.js
================================================

``javascript
// ============================================================
// views/setup.js
// 首次启动「初始化资源」：不预设任何资源，由用户在此配置账户。
// 至少添加 1 个资源后才能进入主界面。
// ============================================================
import { esc, fmtNum, toast } from '../ui/helpers.js';

// 快捷建议（仅填充表单，不自动创建）
const QUICK = [
  { name: '价值元', unit: '价值元', initial: 1000 },
  { name: '时间', unit: '小时', initial: 168 },
  { name: '精力', unit: '点', initial: 100 },
  { name: '金钱', unit: '元', initial: 5000 },
];

export function render(App, el) {
  const { db } = App;
  el.innerHTML = `
    <div class="card setup-card">
      <div class="setup-logo">P</div>
      <h2 class="setup-title">初始化个人经济系统</h2>
      <p class="muted setup-sub">先建立你的资源账户（价值元 / 时间 / 精力 / 金钱…），可随时在「活动」页增删。点下方建议快捷填入。</p>

      <div class="row-gap setup-quick">
        ${QUICK.map((q) => `<button class="btn sm" data-quick="${esc(q.name)}" data-unit="${esc(q.unit)}" data-init="${q.initial}">${esc(q.name)}</button>`).join('')}
      </div>

      <div class="grid2">
        <div class="field"><label>资源名称 *</label><input id="s-name" placeholder="例：价值元"></div>
        <div class="field"><label>单位</label><input id="s-unit" placeholder="点 / 小时 / 元"></div>
      </div>
      <div class="field"><label>初始余额</label><input id="s-init" type="number" value="0" step="0.01"></div>
      <button class="btn primary" id="s-add">＋ 添加资源</button>

      <div id="s-list" class="setup-list"></div>

      <div class="setup-foot">
        <button class="btn primary" id="s-done" ${db.resources.length ? '' : 'disabled'}>完成初始化，开始使用 →</button>
      </div>
    </div>
  `;

  const list = el.querySelector('#s-list');
  const done = el.querySelector('#s-done');
  const renderList = () => {
    list.innerHTML = db.resources.map((r) => `
      <div class="row-gap setup-item">
        <span>${esc(r.name)} <span class="muted">${esc(r.unit)} · 初始 ${fmtNum(r.initial)}</span></span>
        <button class="btn sm danger" data-del="${r.id}">移除</button>
      </div>`).join('') || '<div class="muted" style="text-align:center;padding:8px">尚未添加资源</div>';
    done.disabled = !db.resources.length;
    list.querySelectorAll('[data-del]').forEach((b) => {
      b.onclick = () => { App.engine.deleteResource(db, b.dataset.del); renderList(); };
    });
  };

  el.querySelectorAll('[data-quick]').forEach((b) => {
    b.onclick = () => {
      el.querySelector('#s-name').value = b.dataset.quick;
      el.querySelector('#s-unit').value = b.dataset.unit;
      el.querySelector('#s-init').value = b.dataset.init;
    };
  });

  el.querySelector('#s-add').onclick = () => {
    const r = App.engine.createResource(db, {
      name: el.querySelector('#s-name').value,
      unit: el.querySelector('#s-unit').value,
      initial: el.querySelector('#s-init').value,
    });
    if (!r.ok) return toast(r.error, 'err');
    el.querySelector('#s-name').value = '';
    el.querySelector('#s-unit').value = '';
    el.querySelector('#s-init').value = '0';
    renderList();
    toast('资源已添加', 'ok');
  };

  done.onclick = () => { App.render(); }; // 已有资源 → 进入主界面
  renderList();
}

``



================================================
FILE: C:\Users\qu\Desktop\物理科学与技术论题\TS2\personal-erp\src\views\stats.js
================================================

``javascript
// ============================================================
// views/stats.js
// 「统计」Tab —— 核算层（原「账本」）
//   KPI / 资源余额趋势 / 计划投入 / 活动状态分布 / 流水账本 / 价值流汇总
// 流水绝对不可变（不变量5）：无编辑无删除，只有冲正。
// ============================================================
import { esc, fmtNum, fmtDateTime, badge, openModal, toast, empty, resColor } from '../ui/helpers.js';
import { Prefs } from '../store/prefs.js';
import { themeStyle, themePickerHTML, bindThemePicker, readImageAsDataURL } from '../ui/themes.js';

// ---------- 全局外观主题（图片 / 渐变） ----------
export function setGlobalTheme(theme) {
  Prefs.set({ globalTheme: theme || null });
  App.applyGlobalTheme();
  App.refresh();
}
export function clearGlobalTheme() {
  Prefs.set({ globalTheme: null });
  App.applyGlobalTheme();
  App.refresh();
}

// 导入确认：预览后选择「增量合并」或「全量替换」
export function doImport(db) {
  const prev = App.backup.inspect(App.db, db);
  const m = openModal({
    title: '导入数据',
    accent: 'info',
    bodyHTML: `
      <div class="callout">备份预览：<br>
        资源：新增 <b>${prev.newRes}</b> · 同名复用 <b>${prev.sameRes}</b><br>
        目标 ${prev.goals} · 计划 ${prev.plans} · 活动 ${prev.activities} · 流水 ${prev.txs} · 产出 ${prev.outputs} · 价值流 ${prev.valueflows}
      </div>
      <p class="muted">「增量合并」：同名资源复用现有账户（引用重映射），其余按 id 去重追加，不覆盖已有数据。<br>「全量替换」：用备份整体覆盖当前数据。</p>`,
    footerHTML: `
      <button class="btn" data-cancel>取消</button>
      <button class="btn primary" data-merge>增量合并</button>
      <button class="btn danger" data-replace>全量替换</button>`,
  });
  m.q('[data-cancel]').onclick = () => m.close();
  m.q('[data-merge]').onclick = () => { App.merge(db); m.close(); toast('已增量合并', 'ok'); };
  m.q('[data-replace]').onclick = () => { App.restore(db); m.close(); toast('已全量替换', 'ok'); };
}

// 立即执行一次本地备份（定时自动备份同款通道）
export async function backupNow() {
  const res = await App.backup.exportLocal(App.db);
  if (res.ok) {
    toast(`已备份到本地：${res.filename}`, 'ok');
    App.refresh();
  } else {
    toast(`备份失败：${res.error}`, 'err');
  }
}

// ---------- 局域网同步 ----------
export async function syncTest() {
  const r = await App.sync.health();
  toast(r.ok ? '连接正常' : r.error, r.ok ? 'ok' : 'err');
}

export async function syncDetect() {
  const ip = await App.sync.detectLocalIP();
  if (!ip) return toast('未能自动检测 IP，请手动填写', 'err');
  const url = `http://${ip}:6920`;
  App.sync.setServer(url);
  App.refresh();
  toast(`已填入 ${url}`, 'ok');
}

export function syncCopyCmd() {
  const cmd = App.sync.startCommand(6920);
  const done = () => toast('启动命令已复制', 'ok');
  const fail = () => toast('复制失败，请手动复制', 'err');
  if (navigator.clipboard?.writeText) navigator.clipboard.writeText(cmd).then(done, fail);
  else { const ta = document.createElement('textarea'); ta.value = cmd; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); done(); }
}

// 安卓 App 内一键启动/停止同步服务（手机当服务器）
export async function syncStart() {
  const r = await App.sync.startServer(6920);
  if (!r.ok) return toast(r.error, 'err');
  const url = `http://${r.ip}:${r.port}`;
  App.sync.setServer(url);
  App.refresh();
  toast(`服务已启动：${url}`, 'ok');
}

export async function syncStop() {
  const r = await App.sync.stopServer();
  toast(r.ok ? '服务已停止' : r.error, r.ok ? 'ok' : 'err');
  App.refresh();
}

export async function syncPush() {
  const r = await App.sync.push(App.db);
  if (r.ok) { toast('已推送到服务器', 'ok'); App.refresh(); return; }
  if (r.conflict) {
    const serverAt = r.server?.exportedAt ? fmtDateTime(new Date(r.server.exportedAt).getTime()) : '未知';
    const ok = await App.system.confirm({
      title: '同步冲突',
      message: `服务器有更新数据（${serverAt}），覆盖会丢失服务器上的变更。确定覆盖？`,
    });
    if (!ok) return;
    const f = await App.sync.pushForce(App.db);
    toast(f.ok ? '已强制覆盖服务器' : f.error, f.ok ? 'ok' : 'err');
    App.refresh();
    return;
  }
  toast(r.error, 'err');
}

export async function syncPull() {
  const r = await App.sync.pull();
  if (!r.ok) return toast(r.error, 'err');
  doImport(r.db); // 复用导入确认：增量合并或全量替换
}

// ---------- 14 天累计余额（用于趋势线） ----------
function dailySeries(db, rid, n = 14) {
  const days = [];
  const today = new Date(); today.setHours(0, 0, 0, 0);
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(today); d.setDate(d.getDate() - i);
    days.push({ key: d.getDate(), start: d.getTime(), end: d.getTime() + 864e5 });
  }
  const r = db.resources.find((x) => x.id === rid);
  let cum = r.initial;
  const series = days.map((d) => {
    let delta = 0;
    for (const t of db.txs) {
      if (t.resource_id !== rid) continue;
      if (t.created >= d.start && t.created < d.end) delta += t.debit - t.credit;
    }
    cum += delta;
    return { label: `${d.key}`, v: cum };
  });
  return series;
}

function sparkline(series, w = 240, h = 60) {
  const vals = series.map((s) => s.v);
  const min = Math.min(...vals), max = Math.max(...vals);
  const span = max - min || 1;
  const step = w / (series.length - 1 || 1);
  const pts = series.map((s, i) => {
    const x = i * step, y = h - 4 - ((s.v - min) / span) * (h - 8);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" class="spark">
    <polyline fill="none" stroke="currentColor" stroke-width="1.8" points="${pts}"/>
  </svg>`;
}

// ---------- 流水账本 ----------
export function openReverseModal(txId) {
  const t = App.db.txs.find((x) => x.id === txId);
  if (!t) return;
  const r = App.db.resources.find((x) => x.id === t.resource_id);
  const max = t.debit || t.credit;
  const m = openModal({
    title: '冲正流水（不变量5：不可 UPDATE，只能追加冲正）',
    accent: 'danger',
    bodyHTML: `
      <div class="callout">原流水：${esc(r?.name || '')} ${t.debit ? '+' + t.debit : '-' + t.credit} · ${esc(t.note || t.source_type)}（${t.id}）</div>
      <div class="field"><label>冲正金额（默认全额 ${fmtNum(max)}）</label><input id="f-ramt" type="number" min="0" step="0.01" value="${max}"></div>
      <div class="field"><label>原因</label><input id="f-rreason" placeholder="例：记错了"></div>`,
    footerHTML: `<button class="btn" data-cancel>取消</button><button class="btn primary" data-save>生成冲正流水</button>`,
  });
  m.q('[data-cancel]').onclick = () => m.close();
  m.q('[data-save]').onclick = () => {
    const r = App.engine.reverseTx(App.db, txId, {
      amount: m.q('#f-ramt').value, reason: m.q('#f-rreason').value,
    });
    if (!r.ok) return toast(r.error, 'err');
    m.close(); App.refresh(); toast('冲正已入账，余额自动回补');
  };
}

function txRow(App, t) {
  const r = App.db.resources.find((x) => x.id === t.resource_id);
  const isRev = !!t.reversal_of;
  const amount = t.debit ? `+${fmtNum(t.debit)}` : `-${fmtNum(t.credit)}`;
  return `
    <div class="tx-row ${isRev ? 'rev' : ''}">
      <div class="grow">
        <div class="tx-main"><span class="res-dot" style="background:${r?.color || resColor(t.resource_id)}"></span>
          <b>${esc(r?.name || '?')}</b>
          <span class="amount ${t.debit ? 'pos' : 'neg'}">${amount}</span>
          ${badge(t.source_type)}
          ${isRev ? '<span class="badge b-red">已冲正</span>' : ''}
        </div>
        <div class="muted">${esc(t.note || '')} · ${fmtDateTime(t.created)}</div>
      </div>
      ${!isRev ? `<button class="btn sm danger" onclick="App.stats.openReverseModal('${t.id}')">冲正</button>` : ''}
    </div>`;
}

// ---------- 主渲染 ----------
export function render(App, el) {
  const { db, engine } = App;
  const prefs = Prefs.load();
  const lastBackupTs = Number(prefs.lastAutoBackup) || 0;
  const lastBackupLabel = lastBackupTs ? fmtDateTime(lastBackupTs) : '从未';
  const lastSyncTs = Number(prefs.lastSyncAt) || 0;
  const lastSyncLabel = lastSyncTs ? fmtDateTime(lastSyncTs) : '从未';
  const nActive = db.activities.length;
  const nStarted = db.activities.filter((a) => a.status === 'Started').length;
  const nPlansActive = db.plans.filter((p) => p.status === 'Active').length;
  const nVfPending = db.valueflows.filter((v) => engine.vfStatus(db, v) !== 'Closed').length;
  const nToday = db.activities.filter((a) => {
    const d = a.actual_start ? new Date(a.actual_start) : (a.planned_date ? new Date(a.planned_date + 'T00:00') : null);
    if (!d) return false;
    const t = new Date();
    return d.getFullYear() === t.getFullYear() && d.getMonth() === t.getMonth() && d.getDate() === t.getDate();
  }).length;

  // 计划投入（横向条形）
  const maxCost = Math.max(1, ...db.plans.map((p) => engine.planCost(db, p.id)));
  const planBars = db.plans.map((p) => {
    const cost = engine.planCost(db, p.id);
    const w = (cost / maxCost) * 100;
    const blocked = engine.isPlanBlocked(db, p.id);
    return `
      <div class="hbar-row">
        <span class="hbar-label">${esc(p.title)}</span>
        <div class="hbar"><i class="${blocked ? 'danger' : ''}" style="width:${w}%"></i></div>
        <span class="hbar-val">${fmtNum(cost)}${p.budget !== null ? `/${fmtNum(p.budget)}` : ''}</span>
      </div>`;
  }).join('');

  // 活动状态分布
  const stCount = {};
  db.activities.forEach((a) => { stCount[a.status] = (stCount[a.status] || 0) + 1; });
  const maxSt = Math.max(1, ...Object.values(stCount));
  const stBars = Object.entries(stCount).map(([st, c]) => `
    <div class="hbar-row">
      <span class="hbar-label">${badge(st)}</span>
      <div class="hbar"><i style="width:${(c / maxSt) * 100}%"></i></div>
      <span class="hbar-val">${c}</span>
    </div>`).join('') || empty('暂无活动');

  // 资源余额 + 趋势
  const resCharts = db.resources.map((r) => {
    const b = engine.balanceOf(db, r.id);
    const series = dailySeries(db, r.id);
    return `
      <div class="trend-card">
        <div class="trend-head"><b>${esc(r.name)}</b><span class="amount ${b < 0 ? 'neg' : ''}">${fmtNum(b)} ${esc(r.unit)}</span></div>
        <div class="spark-wrap">${sparkline(series)}</div>
        <div class="muted" style="font-size:11px">近 14 天余额趋势 · 初始 ${fmtNum(r.initial)}</div>
      </div>`;
  }).join('');

  // 价值流汇总
  const vfRows = db.valueflows.map((v) => {
    const out = db.outputs.find((o) => o.id === v.output_id);
    const st = engine.vfStatus(db, v);
    return `
      <div class="vf-sum-row">
        <span class="grow">${esc(out?.title || v.output_id)} ${v.giver && v.receiver ? `（${esc(v.giver)} → ${esc(v.receiver)}）` : ''}</span>
        ${badge(st)}
        ${st !== 'Closed' ? `<button class="btn sm primary" onclick="App.overview.openFeedbackModal('${v.id}')">反馈</button>` : ''}
      </div>`;
  }).join('');

  el.innerHTML = `
    <section class="kpi-row">
      <div class="kpi"><div class="kpi-v">${nActive}</div><div class="kpi-l">活动总数</div></div>
      <div class="kpi"><div class="kpi-v">${nStarted}</div><div class="kpi-l">进行中</div></div>
      <div class="kpi"><div class="kpi-v">${nPlansActive}</div><div class="kpi-l">活跃计划</div></div>
      <div class="kpi"><div class="kpi-v">${nToday}</div><div class="kpi-l">今日活动</div></div>
      <div class="kpi"><div class="kpi-v">${nVfPending}</div><div class="kpi-l">待反馈价值流</div></div>
    </section>

    <div class="card">
      <div class="card-head"><h3>资源余额趋势</h3><span class="muted">不变量1：余额 = 初始 + Σ(debit−credit)</span></div>
      <div class="trend-grid">${resCharts}</div>
    </div>

    <section class="row-layout">
      <div class="card grow">
        <div class="card-head"><h3>计划累计投入</h3><span class="muted">19BC 预算对照（红色=硬约束触发）</span></div>
        ${planBars || empty('暂无计划')}
      </div>
      <div class="card narrow">
        <div class="card-head"><h3>活动状态分布</h3><span class="muted">五态 8C</span></div>
        ${stBars}
      </div>
    </section>

    <div class="card">
      <div class="card-head"><h3>资源流水账本</h3><span class="muted">绝对不可变 · 更正只能追加冲正（不变量5 / 6B）</span></div>
      <div class="ledger">${db.txs.slice().reverse().map((t) => txRow(App, t)).join('') || empty('暂无流水')}</div>
    </div>

    <div class="card">
      <div class="card-head"><h3>价值流汇总</h3><span class="muted">14C 双向交换 · 15C 回充 · 16BC 闭环</span></div>
      ${vfRows || empty('产出归档后自动生成价值流')}
    </div>

    <div class="card">
      <div class="card-head"><h3>外观主题（全局背景）</h3><span class="muted">图片或渐变虚化铺满；每张任务卡片可单独设置主题背景</span></div>
      <div class="theme-preview" id="theme-preview">背景预览</div>
      <div id="theme-picker"></div>
      <div class="row-gap" style="margin-top:10px">
        <button class="btn sm" onclick="App.stats.clearGlobalTheme()">恢复默认</button>
        <span class="muted">当前选择会即时应用到整个应用背景</span>
      </div>
    </div>

    <div class="card">
      <div class="card-head"><h3>桌面小组件</h3><span class="muted">安卓 AppWidget · 当日日程 / 资源状态 / 目标与计划（需在安卓桌面添加）</span></div>
      <label class="row-gap" style="align-items:center"><input type="checkbox" id="w-enabled" ${App.widget.enabled() ? 'checked' : ''}> 启用桌面小组件（关闭可恢复未改前的稳态）</label>
      <label class="row-gap" style="align-items:center;margin-top:6px"><input type="checkbox" id="w-dark" ${prefs.widgetDark ? 'checked' : ''}> 深色主题（添加小组件时也可在配置页选择）</label>
      <div class="muted" style="margin-top:6px">点击小组件任意行可直接跳转 App 对应页面；当日日程显示每项已计时长。</div>
    </div>

    <div class="card">
      <div class="card-head"><h3>数据管理</h3><span class="muted">自包含单机 · 备份 = 一份 JSON，可随时还原</span></div>
      <div class="row-gap">
        <button class="btn primary" onclick="App.backup.export(App.db)">⬇ 导出备份 (JSON)</button>
        <button class="btn" onclick="App.backup.importFromFile((db)=>App.stats.doImport(db))">⬆ 导入</button>
        <button class="btn danger" onclick="App.reset()">♻ 清空并重新初始化</button>
      </div>
      <div class="muted" style="margin-top:8px">导入可选择「增量合并（同名资源复用账户）」或「全量替换」。</div>

      <div class="step-divider">定时自动备份（本地保存）</div>
      <label class="row-gap" style="align-items:center"><input type="checkbox" id="ab-enabled" ${prefs.autoBackup ? 'checked' : ''}> 启用定时自动备份</label>
      <div class="grid2" style="margin-top:8px">
        <div class="field"><label>备份频率</label><select id="ab-every">
          <option value="6" ${prefs.autoBackupEvery === 6 ? 'selected' : ''}>每 6 小时</option>
          <option value="24" ${(prefs.autoBackupEvery ?? 24) === 24 ? 'selected' : ''}>每天</option>
          <option value="168" ${prefs.autoBackupEvery === 168 ? 'selected' : ''}>每周</option>
          <option value="720" ${prefs.autoBackupEvery === 720 ? 'selected' : ''}>每月</option>
        </select></div>
        <div class="field"><label>上次备份</label><input id="ab-last" disabled value="${lastBackupLabel}"></div>
      </div>
      <div class="row-gap" style="margin-top:8px">
        <button class="btn sm" onclick="App.stats.backupNow()">立即备份（本地）</button>
        <span class="muted">安卓端保存到 Documents/backups；网页端保存在浏览器本地（保留最近 10 份）。</span>
      </div>
    </div>

    <div class="card">
      <div class="card-head"><h3>局域网同步</h3><span class="muted">FastAPI 单文件服务 · 冗余保留 10 份 · 时间戳防冲突</span></div>
      <div class="field"><label>服务器地址</label>
        <input id="sync-server" list="sync-history" value="${esc(App.sync.server())}" placeholder="http://192.168.1.100:6920">
        <datalist id="sync-history">${App.sync.history().map((h) => `<option value="${esc(h)}">`).join('')}</datalist>
      </div>
      <div class="row-gap" style="margin-top:8px">
        <button class="btn sm" onclick="App.stats.syncDetect()">🎯 自动检测</button>
        <button class="btn sm" onclick="App.stats.syncCopyCmd()">📋 复制启动命令</button>
        <button class="btn sm" onclick="App.stats.syncTest()">测试连接</button>
        <button class="btn primary" onclick="App.stats.syncPush()">⬆ 推送</button>
        <button class="btn" onclick="App.stats.syncPull()">⬇ 拉取</button>
      </div>
      ${App.sync.nativeAvailable() ? `
      <div class="row-gap" style="margin-top:8px">
        <button class="btn primary" onclick="App.stats.syncStart()">📡 启动服务（本机）</button>
        <button class="btn" onclick="App.stats.syncStop()">⏹ 停止服务</button>
        <span class="muted">安卓 App 内一键启动，手机当服务器</span>
      </div>` : ''}
      <div class="muted" style="margin-top:8px">上次同步：${lastSyncLabel}</div>
      <div class="callout" style="margin-top:8px">电脑上运行 <code>python sync_server.py --port 6920</code> 启动服务，点「自动检测」填入本机地址；手机/电脑填同一地址即可互相同步。历史地址可下拉选择。</div>
    </div>
  `;

  const wcb = el.querySelector('#w-enabled');
  if (wcb) wcb.addEventListener('change', () => { App.widget.setEnabled(wcb.checked); App.widget.refreshNative(); toast(wcb.checked ? '已启用小组件' : '已关闭小组件', 'ok'); });

  // 小组件深色主题
  const wdark = el.querySelector('#w-dark');
  if (wdark) wdark.addEventListener('change', () => { App.widget.setDarkTheme(wdark.checked); toast(wdark.checked ? '小组件已切换为深色' : '小组件已切换为浅色', 'ok'); });

  // 定时自动备份：开关 + 频率
  const ab = el.querySelector('#ab-enabled');
  if (ab) ab.addEventListener('change', () => {
    Prefs.set({ autoBackup: ab.checked });
    toast(ab.checked ? '已启用定时自动备份' : '已关闭定时自动备份', 'ok');
  });
  const abe = el.querySelector('#ab-every');
  if (abe) abe.addEventListener('change', () => { Prefs.set({ autoBackupEvery: Number(abe.value) }); });

  // 局域网同步：服务器地址
  const ss = el.querySelector('#sync-server');
  if (ss) ss.addEventListener('change', () => { App.sync.setServer(ss.value); });

  // 外观主题：选择即时预览并应用
  const picker = el.querySelector('#theme-picker');
  if (picker) {
    const preview = el.querySelector('#theme-preview');
    const cur = Prefs.load().globalTheme || null;
    picker.innerHTML = themePickerHTML({ chosen: cur });
    bindThemePicker(picker, {
      onPick: (t) => { if (preview) preview.style.background = t ? themeStyle(t) : ''; setGlobalTheme(t); },
      onUpload: (f) => readImageAsDataURL(f, (url) => {
        if (!url) return toast('图片读取失败', 'err');
        const t = { type: 'image', url };
        if (preview) preview.style.background = themeStyle(t);
        setGlobalTheme(t);
      }),
    });
  }
}

``



================================================
FILE: C:\Users\qu\Desktop\物理科学与技术论题\TS2\personal-erp\src\views\timer.js
================================================

``javascript
// ============================================================
// views/timer.js
// TikTok 风格全屏沉浸式倒计时 —— 后台安全版
// 实现要点：
//  1) 时间戳锚定：剩余时间 = endTs − now，不依赖 setInterval 精度。
//     浏览器/WebView 后台节流或暂停后，回到前台自动校正。
//  2) 原生本地通知：开始计时即在结束时刻调度通知（Android 系统级），
//     即使 App 被杀/锁屏也会在正确时刻提醒；点击/收到通知回前台即进入完成态。
//  3) 结束直接创建已完成活动（自动闭环，遵循领域规则）。
// ============================================================
import { Capacitor } from '@capacitor/core';
import { Notifications } from '../services/notifications.js';
import { System } from '../services/system.js';
import { toast } from '../ui/helpers.js';

const PRESETS = [5, 15, 25, 45, 60];
const NOTIF_ID = 1001;
const NATIVE = () => Notifications.isNative();
const TKEY = 'personal_erp_timer';

// ---- 计时状态持久化：时间戳锚定，App 被杀后重启可按 now 相对恢复 ----
// 双写：localStorage（快路径）+ 原生 SharedPreferences（抗 WebView 数据清理，
// 澎湃等 ROM 的深度清理 / System WebView 升级都可能清掉 localStorage）
function nativeTimerPlugin() {
  try {
    if (!Capacitor.isNativePlatform()) return null;
    return Capacitor.registerPlugin('Widget');
  } catch (e) { return null; }
}
function persistState({ paused = false, remainingMs: rem = null } = {}) {
  const payload = JSON.stringify({
    target: targetActivityId, sec, sessionStart,
    mode: paused ? 'pause' : 'run',
    endTs: paused ? null : endTs,
    remainingMs: paused ? rem : null,
    ts: Date.now(),
  });
  try { localStorage.setItem(TKEY, payload); } catch (e) {}
  const P = nativeTimerPlugin();
  if (P) P.setTimerState({ json: payload }).catch(() => {});
}
function clearState() {
  try { localStorage.removeItem(TKEY); } catch (e) {}
  const P = nativeTimerPlugin();
  if (P) P.setTimerState({ json: '' }).catch(() => {});
}

let sec = 25 * 60;          // 预设总时长（秒）
let remainingMs = sec * 1000; // 当前剩余（毫秒）
let endTs = 0;              // 结束时间戳（运行中有效）
let running = false;
let finished = false;
let intId = null;
let listenersReady = false;
let sessionStart = 0;       // 本次开始计时的时间戳（供「记到现在」算已用时长）

// 统一应用恢复态（restore 与 restoreNative 共用）：运行中→继续倒计时并重新调度通知；
// 已超时→标记待呈现（打开计时器时呈现）；暂停→还原剩余
function applyRestored(s) {
  targetActivityId = s.target || null;
  sec = s.sec || 25 * 60;
  sessionStart = s.sessionStart || 0;
  if (s.mode === 'pause') {
    remainingMs = Number(s.remainingMs) || sec * 1000;
    running = false; finished = false; endTs = 0;
    return;
  }
  endTs = Number(s.endTs) || 0;
  if (endTs > Date.now()) {
    running = true; finished = false;
    ensureListeners();
    scheduleNotif(new Date(endTs));
    tick(); intId = setInterval(tick, 1000);
  } else {
    running = false; finished = true; remainingMs = 0;
    cancelNotif();
  }
}

// 启动时恢复（快路径：localStorage）
export function restore() {
  let s = null;
  try { s = JSON.parse(localStorage.getItem(TKEY) || 'null'); } catch (e) {}
  if (!s || (!s.endTs && s.mode !== 'pause')) { clearState(); return; }
  applyRestored(s);
}

// 原生兜底恢复：WebView 存储被系统清理导致本地丢失时，从 SharedPreferences 回捞
export async function restoreNative() {
  const P = nativeTimerPlugin();
  if (!P || endTs || running || finished || sessionStart) return; // 本地已恢复有效状态
  try {
    const r = await P.getTimerState();
    if (!r || !r.json) return;
    let s = null;
    try { s = JSON.parse(r.json); } catch (e) { return; }
    if (!s || (!s.endTs && s.mode !== 'pause')) return;
    applyRestored(s);
  } catch (e) {}
}

let el = null;
const CIRC = 2 * Math.PI * 145;

// 从卡片绑定的目标活动（复用番茄钟做按任务计时）；null = 通用快速计时
let targetActivityId = null;

export function open() {
  targetActivityId = null;
  openTimer();
}

// 为指定活动打开番茄钟：结束时把时长记入该活动 time_logs；时长直接预填计划投入
export function openForActivity(activityId) {
  targetActivityId = activityId;
  openTimer();
  const a = App.db.activities.find((x) => x.id === activityId);
  if (a && a.planned_minutes > 0) setPreset(a.planned_minutes); // 直接把计划时间填进番茄钟
}

function openTimer() {
  if (!el) build();
  Notifications.requestPermission();
  const a = targetActivityId ? App.db.activities.find((x) => x.id === targetActivityId) : null;
  el.classList.add('show');
  // 反映当前计时状态（含被杀后 restore 的），而不是无条件重置
  reflectState();
  if (a) {
    let label = `🍅 ${a.title}`;
    if (running) label += ' · 计时中';
    else if (finished) label += ' · 已到时';
    el.querySelector('#t-name').textContent = label;
  }
}

// 把内存状态同步到 overlay 控件
function reflectState() {
  paint();
  if (running) { setGo('暂停'); setLbl('倒计时中'); el.querySelector('#t-go').style.display='inline-block'; el.querySelector('#t-reset').style.display='inline-block'; }
  else if (finished) { setGo('开始'); setLbl('完成！'); el.querySelector('#t-go').style.display='none'; el.querySelector('#t-reset').style.display='none'; el.querySelector('#t-done').classList.add('show'); }
  else { setGo(sessionStart||remainingMs!==sec*1000 ? '继续' : '开始'); setLbl(remainingMs===sec*1000?'准备开始':'已暂停'); el.querySelector('#t-reset').style.display=(sessionStart||remainingMs!==sec*1000)?'inline-block':'none'; el.querySelector('#t-done').classList.remove('show'); el.querySelector('#t-go').style.display='inline-block'; }
  syncNowBtn();
}

export function close() {
  stop();
  System.keepAwake(false);
  el.classList.remove('show');
}

// 绑定活动计时时显示「记到现在」；其余/完成态隐藏
function syncNowBtn() {
  if (!el) return;
  el.querySelector('#t-now').style.display = (targetActivityId && !finished) ? 'inline-block' : 'none';
}

// ---------------- 原生通知（后台提醒） ----------------
async function scheduleNotif(at) {
  await Notifications.schedule({ id: NOTIF_ID, title: '⏱ 计时结束', body: '时间到！回来记录这次活动吧', at });
}

async function cancelNotif() {
  await Notifications.cancel(NOTIF_ID);
}

// 一次性注册系统监听：回前台校正 + 通知触发完成
function ensureListeners() {
  if (listenersReady) return;
  listenersReady = true;
  System.onResume(() => {
    if (!running || finished) return;
    if (endTs - Date.now() <= 0) { stop(); finish(); }
    else if (el) paint();
  });
  Notifications.onReceived(() => {
    if (running && !finished) { stop(); finish(); }
  });
}

// ---------------- UI 构建 ----------------
function build() {
  ensureListeners();
  el = document.createElement('div');
  el.id = 'timerOverlay';
  el.className = 'timer-overlay';
  el.innerHTML = `
    <div class="timer-name" id="t-name">快速倒计时</div>
    <div class="timer-ring">
      <svg width="320" height="320" viewBox="0 0 320 320">
        <circle class="ring-bg" cx="160" cy="160" r="145"/>
        <circle class="ring-fg" id="t-ring" cx="160" cy="160" r="145" stroke-dasharray="${CIRC}" stroke-dashoffset="0"/>
      </svg>
      <div class="timer-num"><div class="big" id="t-big">25:00</div><div class="lbl" id="t-lbl">准备开始</div></div>
    </div>
    <div class="timer-presets" id="t-presets">
      ${PRESETS.map((m) => `<button data-min="${m}" ${m === 25 ? 'class="on"' : ''}>${m}分</button>`).join('')}
    </div>
    <div class="timer-controls">
      <button class="t-now" id="t-now" data-now style="display:none">记到现在</button>
      <button class="t-close" data-close>✕</button>
      <button class="t-go" id="t-go" data-go>开始</button>
      <button class="t-reset" id="t-reset" data-reset style="display:none">重置</button>
    </div>
    <div class="timer-done" id="t-done">
      <div class="emoji">🎉</div>
      <div class="txt">时间到！记录这次活动</div>
      <input id="t-actname" placeholder="刚才做了什么？">
      <div class="rowbtn">
        <button class="go" data-record>记录并闭环</button>
        <button class="ghost" data-dismiss>忽略</button>
      </div>
    </div>
  `;
  document.body.appendChild(el);
  el.querySelector('[data-close]').onclick = () => close();
  el.querySelector('[data-go]').onclick = toggle;
  el.querySelector('[data-reset]').onclick = resetUI;
  el.querySelector('[data-now]').onclick = recordNow;
  el.querySelector('[data-record]').onclick = record;
  el.querySelector('[data-dismiss]').onclick = dismiss;
  el.querySelectorAll('#t-presets button').forEach((b) => b.onclick = () => {
    setPreset(Number(b.dataset.min));
    el.querySelectorAll('#t-presets button').forEach((x) => x.classList.toggle('on', x === b));
  });
}

// ---------------- 状态控制 ----------------
function setPreset(min) { sec = min * 60; remainingMs = sec * 1000; sessionStart = 0; stop(); clearState(); paint(); setLbl('准备开始'); setGo('开始'); el.querySelector('#t-reset').style.display = 'none'; el.querySelector('#t-done').classList.remove('show'); syncNowBtn(); }

function resetUI() {
  sec = 25 * 60; remainingMs = sec * 1000; sessionStart = 0; stop(); clearState(); paint(); setLbl('准备开始'); setGo('开始');
  el.querySelector('#t-reset').style.display = 'none';
  el.querySelector('#t-done').classList.remove('show');
  el.querySelector('#t-name').textContent = '快速倒计时';
  el.querySelectorAll('#t-presets button').forEach((b) => b.classList.toggle('on', b.dataset.min === '25'));
  syncNowBtn();
  cancelNotif();
}

function toggle() {
  if (running) { // 暂停：剩余量持久化，被杀后可恢复
    remainingMs = endTs - Date.now();
    stop();
    cancelNotif();
    persistState({ paused: true, remainingMs });
    setLbl('已暂停'); setGo('继续');
  } else {
    running = true; finished = false;
    sessionStart = Date.now();
    endTs = Date.now() + remainingMs;
    persistState();
    scheduleNotif(new Date(endTs));
    System.keepAwake(true); // 计时期间屏幕常亮
    setGo('暂停'); setLbl('倒计时中');
    el.querySelector('#t-reset').style.display = 'inline-block';
    syncNowBtn();
    tick(); intId = setInterval(tick, 1000);
  }
}

function stop() { running = false; if (intId) { clearInterval(intId); intId = null; } }

function tick() {
  if (finished) return;
  remainingMs = endTs - Date.now();
  if (remainingMs <= 0) { stop(); finish(); return; }
  paint();
}

function paint() {
  if (!el) return; // restore 启动恢复时 overlay 可能未构建
  const total = Math.round(remainingMs / 1000);
  const m = Math.floor(total / 60), s = total % 60;
  el.querySelector('#t-big').textContent = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  el.querySelector('#t-ring').style.strokeDashoffset = CIRC * (1 - remainingMs / (sec * 1000));
}

function setLbl(t) { if (!el) return; el.querySelector('#t-lbl').textContent = t; }
function setGo(t) { if (!el) return; el.querySelector('#t-go').textContent = t; }

function finish() {
  if (finished) return;
  finished = true; running = false; stop();
  cancelNotif();
  System.keepAwake(false);
  System.vibrate(300);
  System.success();
  if (el) { // 后台到期时 overlay 未打开，UI 更新推迟到下次 openTimer 的 reflectState
    setLbl('完成！');
    el.querySelector('#t-go').style.display = 'none';
    el.querySelector('#t-reset').style.display = 'none';
    el.querySelector('#t-done').classList.add('show');
    el.querySelector('#t-actname').value = '';
    el.querySelector('#t-actname').focus();
    syncNowBtn();
  }
}

// 绑定活动计时：把当前已计时长立即写入 time_logs（不必等完整跑完）
function recordNow() {
  if (!targetActivityId || finished) return;
  if (!sessionStart) { toast('请先开始计时', 'info'); return; }
  const elapsed = Math.max(0, Math.round((Date.now() - sessionStart) / 60000));
  if (elapsed <= 0) { toast('计时不足 30 秒，暂不记录', 'info'); return; }
  const ta = App.db.activities.find((x) => x.id === targetActivityId);
  if (!ta) return;
  if (!ta.time_logs) ta.time_logs = [];
  const end = Date.now();
  ta.time_logs.push({ start: end - elapsed * 60e3, end });
  if (ta.status === 'Planned') { ta.actual_start = end - elapsed * 60e3; ta.status = 'Started'; }
  clearState();
  cancelNotif();
  close();
  App.refresh();
  toast(`已为「${ta.title}」记录 ${elapsed} 分钟`, 'ok');
}

// ---------------- 闭环入账 ----------------
function record() {
  const { db } = App;
  const minutes = Math.max(1, Math.round(sec / 60) || 1);

  // 绑定活动（按任务计时）：把本次时长记入该活动，Planned 自动转为 Started
  if (targetActivityId) {
    const ta = db.activities.find((x) => x.id === targetActivityId);
    if (ta) {
      if (!ta.time_logs) ta.time_logs = [];
      const end = Date.now();
      ta.time_logs.push({ start: end - minutes * 60e3, end });
      if (ta.status === 'Planned') { ta.actual_start = end - minutes * 60e3; ta.status = 'Started'; }
      cancelNotif();
      App.refresh();
      close();
      toast(`已为「${ta.title}」记录 ${minutes} 分钟`, 'ok');
      return;
    }
  }

  // 通用快速计时：直接创建已完成活动（自动闭环）
  const name = el.querySelector('#t-actname').value.trim() || `计时活动 ${new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`;
  const timeRes = db.resources.find((r) => r.name === '时间') || db.resources[0];
  if (!timeRes) { close(); toast('请先添加资源，再开始计时', 'err'); return; }
  const a = {
    id: 'a' + (db.seq.a = (db.seq.a || 0) + 1),
    title: name, note: '来自快速计时', plan_ids: [],
    planned_date: null, planned_minutes: minutes,
    actual_start: Date.now() - minutes * 60e3, actual_end: Date.now(),
    status: 'Completed', created: Date.now(),
  };
  db.activities.push(a);
  db.txs.push({
    id: 't' + (db.seq.t = (db.seq.t || 0) + 1), resource_id: timeRes.id, debit: 0,
    credit: minutes, source_type: 'activity', source_id: a.id, note: `计时 ${minutes} 分钟`,
    reversal_of: null, created: Date.now(),
  });
  db.outputs.push({
    id: 'o' + (db.seq.o = (db.seq.o || 0) + 1), activity_id: a.id, title: `${name} 产出`,
    tags: ['计时'], status: 'Draft', created: Date.now(),
  });
  cancelNotif();
  App.refresh();
  close();
  toast(`已记录「${name}」为已完成活动（${minutes} 分钟）`, 'ok');
}

function dismiss() {
  clearState();
  cancelNotif();
  close();
  toast('本次计时已忽略，未入账');
}

``



================================================
FILE: C:\Users\qu\Desktop\物理科学与技术论题\TS2\personal-erp\src\views\topbar.js
================================================

``javascript
// ============================================================
// views/topbar.js
// 顶栏：品牌 + 资源余额常驻（每资源独立配色圆点）+ 全局工具（计时）
// ============================================================
import { esc, fmtNum, resColor } from '../ui/helpers.js';

export function renderTopbar(App) {
  const { db } = App;
  const el = document.getElementById('topbar');
  const pills = db.resources
    .filter((r) => r.status === 'Active')
    .map((r) => {
      const b = App.engine.balanceOf(db, r.id);
      return `<span class="res-pill" style="--pill-c:${r.color || resColor(r.id)}" title="${esc(r.name)} 余额 = 初始 + Σ(debit−credit)">${esc(r.name)} <b>${fmtNum(b)}</b></span>`;
    }).join('');

  el.innerHTML = `
    <div class="brand">
      <div class="logo">P</div>
      <div>
        <h1>Personal ERP</h1>
        <div class="muted">个人经济系统 · 单机自包含</div>
      </div>
    </div>
    <div class="top-res">${pills}</div>
    <div class="actions">
      <button class="btn timer-btn" onclick="App.timer.open()">⏱ 计时</button>
    </div>
  `;
}

// Tab 导航
export function renderTabs(App) {
  const el = document.getElementById('tabs');
  const items = [
    { id: 'overview', label: '活动' },
    { id: 'goals', label: '目标与计划' },
    { id: 'stats', label: '统计' },
  ];
  el.innerHTML = items.map((t) =>
    `<button class="tab ${App.tab === t.id ? 'on' : ''}" data-tab="${t.id}">${t.label}</button>`
  ).join('');
  el.querySelectorAll('.tab').forEach((b) =>
    b.onclick = () => App.setTab(b.dataset.tab));
}

``

