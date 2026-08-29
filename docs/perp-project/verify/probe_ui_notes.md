# UI 层与状态同步域 · 侦察验证笔记（只读狩猎，未改任何源码）

> 侦察兵报告附件。以下条目为「静态分析已锁定缺陷、但最终定性需 DOM 运行时观察」的疑点，
> 附手工复现步骤；不含自动化脚本（jsdom-free 纪律）。
> 静态可执行事实类发现直接见战报表，此处不重复。

## A. syncFromNative 疑似旧库回写覆盖原生数据（U5，推理级·链路完整）

链条：
1. `src/services/widget.js:40-56` `pullFromNative()` 把原生 db 写入
   `localStorage['personal_erp_db_v1']`，返回 `{changed:true}`。
2. `src/main.js:209-215` `if (r.changed) App.render(false)`。
3. `src/main.js:143-144` `render()` 第一行即 `saveDB(this.db)` —— 而 `this.db`
   是启动时 `loadDB()` 的旧内存对象（全仓仅 reset/restore/merge 三处重赋值 App.db）。
4. 结果：原生侧变更在落盘后 ~一帧内被旧库覆盖；随后 `Widget.refreshNative()`
   又把旧库推回原生 SharedPreferences。

复现步骤（安卓双端）：
1. 启用桌面小组件，确认 rev 同步正常。
2. 在原生小组件上执行一个非流水操作（如「开始活动」改变 activity.status）。
3. 切回 App 触发 visibilitychange → 观察 30s 内该活动状态是否被回滚为 Started 前。
4. 对照组：原生侧做纯加流水操作（注释声称 pushData 有 txs 合并通道），看是否幸存。

预期证伪方式：若实际存在我未追踪到的二次 loadDB/重赋值路径，则本条作废。

## B. AutoPilot 多条到期聚合弹窗「关闭即重开」循环（U7，推理级）

链条：`src/services/autoPilot.js:154-178`
- items.length>1 且无 `.modal-mask` 时每 tick（30s）openModal 聚合弹窗；
- 用户点 footer「关闭」（data-cancel）不记录 dismiss；
- 下一 tick 条件依旧成立 → 弹窗再次弹出，循环直至逐条「忽略」或事件过期。

复现：
1. 构造两条 planned_start 均已过期 1 分钟内、状态 Planned 且未 dismiss 的活动。
2. 等 F1 聚合弹窗出现 → 点「关闭」。
3. 停留页面 ≥30s，观察是否无交互再次弹出。

## C. 导入链注入 PoC 大纲（U1，静态可执行 · 端到端需恶意备份文件）

前置实证（均已读源确认）：
- `src/store/db.js:128-140` normalizeDB 只做 schemaVersion 迁移，零内容消毒。
- `src/domain/importMerge.js:73-84` pushNew 对非资源实体保留备份原始 id 原文。
- `src/domain/engine.js:113-138` createResource/updateResource 对 color 完全透传。

PoC 步骤：
1. 手工构造备份 JSON：某 activity 的 `"id": "\u0022 onmouseover=\u0022alert(1)"`，
   或某 resource 的 `"color": "red;background-image:url(//x)\""`.
2. 统计页 → 导入 → 全量替换（或增量合并）。
3. 进入「活动」Tab 日程区：`calendar.js:45` `data-edit="${a.id}"` 与 :53-55
   `onclick='...${a.id}'` 为裸插值 → 属性逃逸执行。
   同理 `topbar.js:14`、`stats.js:208`、`goals.js:123,127,74`、`stats.js:187`、`setup.js:49`。
4. LAN 同步拉取（stats.syncPull → doImport）为同链路的远程触发面。

对照：overview.js 全程 jsStr/safeColor/esc，证明团队知道正确姿势，其余视图漏防。

## D. 看板拖拽后误触编辑的观察窗口（U4）

`wasDragging` 声明于 overview.js:671、守卫于 :858，全仓 grep 零赋值 —— 死旗。
现代 Chromium 在 HTML5 DnD 后通常抑制 click，故多为潜伏；验证法：
1. Firefox/WebView 中拖卡片跨列释放。
2. 立即观察是否弹出新/编辑弹窗（dragend 后同元素 click 未被抑制的平台会触发）。
若复现，即为该死旗的本意场景。
