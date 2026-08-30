# Personal ERP · 项目交接文档

> 更新日期：2026-08-29 ｜ 版本：release 已构建（app-release.apk，签名 personal-erp.keystore）
> 本档为发布后二次构建：预设收支一键完成 + 自动失败接入 AutoPilot（F5）。

> ⚠️ 本仓库已功能冻结（2026-08-24）：项目迁移至 TWS2-Eco monorepo
> （apps/perp-web SolidJS 重写 + packages/perp-core TS + apps/perp-mobile）。
> 数据无缝：新 APK 覆盖安装即继承全部账本。迁移说明见 TWS2-Eco/docs/perp/MIGRATION.md。
> 以下内容仅作历史参照。

## 一、这是什么

自包含单机「个人经济系统 ERP」：把个人的时间/精力/金钱统一建模为**资源账户**，
一切行为（活动、兑换、消费）都必须经过**领域引擎**记账，形成可审计的账本。
无后端、无服务器，全部数据存 WebView localStorage + 原生 SharedPreferences 双份。

**技术栈**：Vite 6 + 原生 JS（ESM，无框架）+ Capacitor 8（Android）+ Node 内置 test runner。
**代码量级**：约 40 个源码模块，构建产物 ~136KB (gzip 42KB)。

## 二、目录结构

```
personal-erp/
├─ src/
│  ├─ main.js              # 装配根：db(store)+engine(domain)+views(ui)→window.App；render 入口
│  ├─ store/
│  │  ├─ db.js             # localStorage 持久化(personal_erp_db_v1)、seedDB、ensureSeq
│  │  └─ prefs.js          # 用户偏好(lastMinutes/lastRepeat/widgetEnabled...)
│  ├─ domain/              # ★ 纯函数领域层（UI 只准调这里）
│  │  ├─ entities.js       # 实体工厂 newActivity/newTx...（字段契约注释齐全）
│  │  ├─ engine.js         # 引擎：createActivity/startActivity/completeActivity/
│  │  │                    #   时间原子性(activityWindow/findConflicts/findFreeSlot/applyAtomicity)
│  │  │                    #   循环任务 spawnRecurrence、商品 consumeGood、备份合并
│  │  ├─ importMerge.js    # 备份增量合并（同名资源复用、按 id 去重、引用重映射）
│  │  └─ rules?            # 兑换规则等常量（ACTIVITY_TRANSITIONS 等）
│  ├─ views/               # 视图层（每个 Tab 一个模块，onclick 走全局 App.*）
│  │  ├─ overview.js       # 活动 Tab：资源卡/看板(五态)/表单(openActModal 含原子性预览)/价值流
│  │  ├─ calendar.js       # 日历+当日日程 agendaRow（时间段显示、⚠冲突标记）
│  │  ├─ goals.js / stats.js / setup.js（首次引导）/ dayGuide.js（新一天五步向导）
│  │  ├─ timer.js          # 全屏番茄钟：时间戳锚定 + 原生通知 + 跨进程双写持久化
│  │  └─ topbar.js         # 顶栏（计时按钮红色 .timer-btn）
│  ├─ services/
│  │  ├─ backup.js         # 导出/导入/自动备份 ⚠ 见「已知问题#1」
│  │  ├─ widget.js         # 小组件数据桥（pushData/pullFromNative，rev 修订号）
│  │  ├─ notifications.js / system.js（震动/常亮/onResume）/ scheduler.js（定时任务）
│  │  └─ sync.js           # 局域网同步客户端（配 sync_server.py FastAPI 单文件）
│  └─ ui/helpers.js        # openModal/toast/badge/esc 等 UI 原语
├─ android/app/src/main/java/com/personal/erp/
│  ├─ MainActivity.java    # 启动页（erpLaunchTab 事件跳转小组件点击）
│  ├─ widget/              # WidgetPlugin(setTimerState/getTimerState/pushData/getData)
│  │                       # WidgetStore(SharedPreferences "CapacitorStorage")、四类 WidgetProvider
│  │                       # WidgetActionReceiver（桌面独立操作广播）
│  └─ sync/SyncPlugin.java + MiniHttpServer.java（安卓端内置 HTTP 接收服务）
├─ tests/domain.test.js    # 领域层测试 38 条（node --test）
├─ scripts/timer_persist_check.py 等辅助脚本
├─ android/personal-erp.keystore  # ★ 发布签名（密码在 build.gradle 明文，勿丢）
└─ 启动.bat                # 一键 npm run dev
```

## 三、领域模型（接手必读）

### 实体关系
Goal 1:N Plan M:N Activity 1:1 Output 0:1 ValueFlow；Resource 与 Tx(流水) 构成账本；
Goods（商品）含 costs[] 多资源成本，快速消费生成 credit 流水。

### 活动六态状态机（2026-08 形式化扩展，解耦）
`Planned → Started → Completed → Reviewed → Archived` + `Failed` 终态（显式失败，不堆积）
转移表 `ACTIVITY_TRANSITION_TABLE` 为单一真源（显式规则，无隐藏魔法）：
`Planned: [Started, Failed]` → `Started: [Completed, Failed]` → `Completed: [Reviewed]` → `Failed: []` → `Reviewed: [Archived]`
- 完成（completeActivity）必须**同时**登记至少一笔收支流水 + 一个产出（不变量2），否则拒绝
- 预算耗尽的计划冻结其活动开始/完成（不变量4）
- 失败（failActivity）：超时未完成 -> Failed + cleanConflicts；若 `repeat` 则快进衍生下一期（与 Completed 同轨，快进语义跳过已逝日期），Failed 本体保留审计但 UI 过滤；若非循环则自动 re-init 回 `Planned`（retryCount 递增，可立即重试），杜绝列表堆积
- 循环衍生守卫（解耦）：仅 `Completed` 与 `Failed(循环)` 触发生成，`Planned` 未完成不生成，杜绝空转

### 形式化任务状态机（解耦模块 `src/domain/taskStateMachine.js`，镜像 Python 规范）
`TaskState: PENDING/SCHEDULED/RUNNING/WAITING_RETRY/PAUSED/SUCCEEDED/FAILED/TIMEOUT` + `TRANSITION_TABLE` + `Lease` 防重入 + `SequentialBehaviour/ParallelBehaviour` 组合（Composite Pattern），用于复杂工作流（如每日总结=拉代码→跑测试→生成报告），与 Activity 机完全解耦、互不冲突。

### 六条全局不变量（engine 强制，测试覆盖）
1. 余额 = initial + Σdebit − Σcredit（冲正也是真实分录）
2. Complete 必带流水与产出
3. Output Archived 自动生成 ValueFlow(Pending, +7天)
4. 计划预算硬约束
5. 冲正生成新流水且余额回补
6. Failed 不堆积且仅 Completed/Failed(循环) 衍生下一期（解耦：未完成不产生成）

### 时间原子性（2026-08-23 新增）
- 有 `planned_start` 且时长>0 的活动占固定时段，**一律禁止重叠**
- 新字段：`planned_end`（由起始+时长推算）、`conflicts[]`（捆绑对手 id）
- 冲突默认**自动顺延**到最近空闲槽（当天扫间隙→次日同时刻，上限30天）
- 表单勾选「坚持此时间」→ 不顺延，双方互写 conflicts（捆绑）
- startActivity 遇排队捆绑对 → 返回 `conflict_choice` 结构化数据，UI 弹三选一
  （先做这个=对手顺延 / 让对方先=自己改约 / 取消）。统一入口 `App.startAct(id)`
- 弹性活动（无开始时间或 0 分钟）不参与冲突；已完成活动是历史事实不拦路

### 计时器跨进程持久化（timer.js）
- 时间戳锚定 endTs−now，后台节流免疫
- **双写**：localStorage(`personal_erp_timer`) + 原生 SharedPreferences（经 Widget.setTimerState）
- 启动 restore() 快路径 + restoreNative() 兜底（WebView 数据被 ROM 清理时从原生回捞）
- paint/setLbl/setGo/finish 均有 el 判空守卫（overlay 未构建时不炸）

### 小组件桥（Capacitor 8 无自动 localStorage 同步）
- JS→原生：Widget.pushData({db,prefs}) 写 SharedPreferences("CapacitorStorage")
- 桌面独立操作→WidgetStore.writeDB 自动 rev+1 → JS pullFromNative 回读合并
  （native_txs 防覆盖机制：桌面产生的流水 id 回合进 JS 库）
- RemoteViews 安全边界：仅 LinearLayout/TextView/ProgressBar + drawable 资源引用；
  颜色值直接写 background 在澎湃 HyperOS 会加载失败（血泪教训）

## 四、常用命令

```bash
npm run dev        # 开发（http://localhost:5173）
npm test           # 领域层测试（node --test tests/*.test.js，139 条）
npm run build      # 产出 dist/
npx cap sync android   # dist → android assets（build 后必跑！）
cd android && gradlew assembleDebug    # 调试包
cd android && gradlew assembleRelease  # 签名发布包 → app/release/app-release.apk
```

⚠️ 改了 src 之后打包三步缺一不可：`npm run build` → `npx cap sync android` → `gradlew assemble*`。

## 五、当前状态（截至本档更新）

### 已完成并验证（2026-08-30 更新）
- **夜间主题（新，2026-08-30）**：`Prefs.nightTheme`（auto 跟随系统 / light / dark），`App.applyNightTheme()` 写 `<html data-theme>` + 同步 `theme-color`；系统深浅偏好变化实时跟随（仅 auto）；统计页「外观主题」卡片内三态切换（不新增顶栏按钮）。CSS 暗色覆盖全量补齐（含周视图），修正历史笔误 `#3a4cal→#3a4a66`。
- **周期编辑三态（新，2026-08-30，对标 Google/Outlook）**：循环活动编辑弹窗新增「编辑范围」——全部 / 此期及后续 / 仅此期。engine `updateSeries`：`all`=普通整系列更新；`following`=当期与其后全部期次日期整体平移（保持原间隔，repeat_until 超越则截断但保留当期）；`only`=当期摘出为独立单次活动（例外），系列保留其余期次，摘空则退化为非循环空壳。守卫：非循环拒绝 / Started 只允许 all / 当期 done 只允许 all。S12 测试 6 条。
- **周视图时间网格（新，2026-08-30）**：日历卡片月/周切换（`calMode`）。周视图 = 7 列 × 6:00~23:00 时间轴（40px/h），时间定位色块（计划色左边条；done=绿淡/skipped=灰删除线/future=虚线半透明），全天/弹性活动收顶部条区；点表头选日、点空白时间格 = 该日该钟点新建（预填 HH:00）、点色块 = 编辑；下方保留当日日程表。深色主题同步覆盖。
- **ICS 导出（新，2026-08-30，仅导出）**：`src/services/ics.js` `buildICS` 纯函数 + `ICS.export`。循环系列展开 occurrences[] 为多 VEVENT（保留历史），Planned→TENTATIVE / done→CONFIRMED / skipped·Failed→CANCELLED；有时间为本地浮时（DTSTART/DTEND），无时间为全天（次日 DTEND）；SUMMARY/DESCRIPTION/CATEGORIES 转义；75 字节行折叠。统计页「数据管理」新增「📅 导出日历 (ICS)」：native 存 Documents/exports，web 触发下载。单机闭环不回导（往返丢账本字段）。
- **视图瘦身 + 三级归档降级（2026-08-30）**：归档 = 从主视图降级，收进「已归档」折叠区，三级统一：
  - 活动（Activity）Archived → 看板 Done 列移除，收进「📦 已归档」折叠区（只读不可拖回）；日历 byDay 跳过；计划内活动列表过滤 + 「📦 已归档（N）」折叠区
  - 计划（Plan）Archived → 目标下收进「📦 已归档计划（N）」折叠区（默认收起）
  - 目标（Goal）Archived → 收进「📦 已归档（N）」目标折叠组（默认收起）；状态菜单收进目标卡片「⋯」弹窗（不挤占卡片位置，含 状态/归档/恢复）；目标轻态机 Active→Completed→Archived（`setGoalStatus`），旧库 status 幂等回落 Active
  - 计划内活动列表默认前 20 条 + 「展开剩余 N 条 ▾」（防撑爆）
- **预设收支一键完成（新，2026-08-29，多资源版）**：活动可预设 `preset_expenses/preset_incomes`（多资源数组，同 Goods.costs[]），计划可设 `default_expenses/default_incomes`（新建该计划下活动自动继承，快照式）；
  有预设的 Started 活动点「完成」= 一键入账（产出标题=活动名，不变量2 天然满足），入账后弹轻确认条「已入账 支出X/收入Y [有要改的吗][关闭]」；
  「有要改的吗」→ 改账弹窗（多行多资源）→ `amendActivityLedger` 走冲正语义重记（不变量5，审计留痕）。无预设活动走原表单，零回归。
  引擎新入口：`quickCompletePreset` / `amendActivityLedger` / `sanitizePresets`。schema 升 v3（v2 单资源字段自动迁移为单元素数组）。
- **自动失败接入 AutoPilot（F5，修「超时未完成却不失败」）**：Started 且超出 计划时长+宽限期(`Prefs.failGraceMin`，默认30分钟) 仍未完成 → `failActivity`；
  循环→衍生下一期，非循环→re-init 回 Planned（retryCount 递增可重试）。幂等静默，timer-overlay 时跳过。此前 `failActivity` 仅有引擎+测试、App 内无任何调用方。
- **周报 · 月报（新，2026-08-29）**：`src/domain/report.js` 纯函数 `buildReport`（周期=周一~周日 / 自然月，offset 支持历史期次）；
  模块可配置（活动汇总/收支流水/计划投入/余额变化/价值流，`Prefs.reportModules`）；统计页「📊 周报·月报」卡片手动查看 + 每周日/每月末 20:00 通知提醒（`Scheduler.syncPeriodicReportReminders`，`Prefs.reportRemind` 可关）。
- **★ 原生插件注册修复（Capacitor 8 时序根因，2026-08-29）**：`BridgeActivity.onCreate` 内同步建桥（`super.onCreate → this.load() → bridgeBuilder.create()`）。此前 `MainActivity.onCreate` 在 `super.onCreate()` 之后调 `registerPlugin(...)`——桥已创建，插件只进 builder 从不生效 → JS `registerPlugin('Sync')` 永远「not implemented in Android」。正确做法：**在本类重写 `load()`，在 `super.load()`（真正建桥）之前注册**三个插件（Widget/Sync/Timer）。启动/回前台 extra 改由 `load()` 触发的 `onNewIntent(getIntent())` 统一处理，不再在 onCreate 重复。
- **番茄钟控制栏 + 铃声（新，2026-08-29）**：新原生插件 `TimerPlugin`（`@CapacitorPlugin(name="Timer")`）+ `TimerControlReceiver`：`showControls({title,remainingMs,running})` 控制栏**常驻通知**（⏸暂停/▶继续/⏹结束），按钮经 receiver 回前台触发 `window` 事件 `timerControl`；`ring()/stopRing()` 到时播放系统闹铃（循环）+震动直到用户处理。JS `timer.js` 增 `syncControls()` 随 开始/暂停/继续/完成/终止/恢复 同步控制栏，`finish()` 触发 `ringNow()`，`timerControl` 事件驱动暂停/继续/结束。Manifest 补 `POST_NOTIFICATIONS`/`VIBRATE` + receiver。
- **通知栏活时钟 + 权限（2026-08-29）**：`tick()` 每秒调 `syncControls()` → 控制栏常驻通知实时倒计时（活的时钟，不只开始/暂停时刷新）；开始计时时再 `Notifications.requestPermission()`（首次弹系统框，已拒/已授权静默）。注意：Android 13+ 通知必须用户授权，ROM 若静默拒收需去系统设置开启。
- **原生插件诊断（2026-08-29）**：`SyncPlugin.ping()` + `sync.js diag()`（返回 platform/native/UA/ping 结果）；统计页同步卡新增「🧪 插件自检」按钮，真机一键确认桥是否连上原生插件（排查「not implemented in Android」）。已用字节码级校验确认编译产物 MainActivity.class 含 `registerPlugin`+三插件引用。
- **局域网同步「failed to fetch」修复（2026-08-29）**：Android 9+ 默认禁明文 http，`fetch(http://192.168.x.x:6920)` 报 `Failed to fetch`。Manifest `<application android:usesCleartextTraffic="true">` 放行局域网明文（自包含单机局域网同步所必需）。
- **控制栏广播加固（2026-08-29）**：`timer.js` 在模块加载时即 `ensureListeners()`（不再等计时 overlay 首次打开），通知栏 暂停/继续/结束 按钮的 broadcast → `timerControl` 事件任何时刻都有处理器。
- **★ 通知恒显「00:00」根因（2026-08-29）**：Capacitor `PluginCall.getLong` 只认 `Long` 实例，而桥把 JS 数字（如 1500000）反序列化为 `Integer` → `getLong("remainingMs",0L)` 恒回默认 0 → 通知栏倒计时永远是 00:00。修复：`TimerPlugin.showControls` 用 `Number` 安全读取（`(Number)opt("remainingMs")`）。教训：**自研插件读数字参数优先 getInt/getDouble/Number 转换，别用 getLong**。
- **HUD 侧边栏（新，2026-08-29）**：`src/views/hud.js` 可开关浮层（`Prefs.hudEnabled`），右上角常驻显示 目标→计划→活动 层级树（HUD 感，半透明深色、可滚动、层级可展开/收起：目标默认展开、计划默认收起、每计划活动限 20 条防撑爆——预生成循环可能上百期）。顶栏 ☰ 切换 / 面板 ✕ 关闭；点击活动行直接打开编辑弹窗；每次 App.render 自动同步数据。顶栏批量按钮改名「⚡ 创建」并改为黑色。
- **App.refresh 收编（2026-08-29）**：① 轮播页跨渲染保留（`pagerPage`）——任何 `App.refresh()` 不再跳回日历/重放动画；② 看板自身按钮（复盘/归档/输出发布/续生成/展开收起）改用 `App.overview.refreshBoard()`（就地重渲染看板，不整页重建）；③「⚡ 批量」按钮从看板卡头移到顶栏。
- **编辑弹窗加删除（2026-08-29）**：`openActModal` 编辑态页脚新增「删除」（走 `delAct` 二次确认），日历里也能直接删活动，不必切回看板。
- **看板「今日」模式（2026-08-29）**：过滤条新增「📅 今日」切换（`App.overview.setKanbanToday`），只看今天到期/开始的五态活动，可与计划过滤叠加。
- **流水账本防撑爆（2026-08-29）**：统计页流水默认只显最近 20 条 + 「⬇ 展开更早的 N 条」（`App.stats.toggleLedger`），避免长账本撑爆页面（与看板 Done 列同款模式）。
- **★ 循环任务改为「系列容器 + 期次数组」模型（2026-08-29 定稿）**：一条活动 = 一个循环，内部 `occurrences[]` 存全部期次（`{date, status: pending|done|skipped, completedAt?}`）；列表/日历只出现这一条（不再生成 N 份副本 → 列表不爆炸、删除即删整个系列、批量问题消失）。完成/失败一期 → 标记该期次并把 `planned_date` 原地推进到下一 pending 期次（weekday 跳过周末由 `nextOccurrenceDate` 处理）；到 repeat_until 全部完成后系列终态。无 until 默认 30 期，可随时「⋯ → 续生成后续 30 期」（`extendRecurrence` 追加期次并解除 until）。卡片显示 `M/N 期` 进度，「⋯ → 📅 期次」弹窗查看各期状态。engine：`buildOccurrenceDates/currentOccurrence/advanceRecurrence/seriesProgress/extendRecurrence`；`completeActivity/failActivity` 内做推进。**编辑清空计划时间不再产生「无当前期」悬空**：`updateActivity` 对循环系列回落首个 pending 期次（`fallbackSeriesDate`），非循环仍清空（S10 测试）。非循环活动失败仍自动 re-init 回 Planned（可重试）不变。
- **小组件同步加固（2026-08-29）**：`refreshNative` 去掉 `enabled()` 门槛（桌面直接添加小组件也能拿到核心数据，不必先进 App 设置开开关）；回前台（`syncFromNative`）立即推送最新 db 到小组件；JS `setEnabled` 同步写原生 `widgetEnabled`，保持两端一致。此前「小组件不同步/无法与核心配合」根因=插件未注册（见上），已一并修复。
- **自动备份「去假」：本地备份清单 + 一键恢复（2026-08-29）**：此前自动/立即备份虽落盘，但 App 内无清单无恢复入口（安卓端文件在 app 私有 Documents，用户文件管理器常不可见）→ 观感=假备份。现 `Backup.listLocalBackups()`（native 读 Documents/backups 目录 / web 读 localStorage 历史）+ `readLocalBackup()`；统计页「数据管理」新增「本地备份清单」：列出备份并可一键恢复（走 doImport 增量合并/全量替换）。
- **看板按计划过滤（新，2026-08-29）**：活动看板上方新增过滤条「全部 / 未关联 / 各计划」，点选后按计划过滤五态看板（`kanbanPlanFilter` 内存态，`App.overview.setKanbanPlanFilter`）。
- 形式化状态机解耦（Activity 六态 + TaskState 八态 + TRANSITION_TABLE 单一真源 + Lease + Sequential/Parallel Behaviour，`taskStateMachine.js` 独立模块，与现有五机零冲突，139 用例全绿）
- 任务失败不堆积：超时未完成 -> Failed 并从列表移除；循环任务自动快进衍生下一期，非循环自动 re-init 回 Planned（`failActivity`/`reinitFailedActivity`）
- 时间原子性全套（domain 9 用例 + UI 冒烟 16 断言全过）
- 计时器原生双写 + 状态机重置修复（`record`/`dismiss` 补 `abortSession+clearState`，杜绝 finished 残留导致后续无法计时）
- 已完成看板列防撑爆（默认最近 3 条，展开按钮）
- 商品多资源成本、局域网同步(FastAPI 单文件 + 安卓内置 HTTP)、新一天引导向导、
  循环任务补设、小组件四件套（今日/资源/目标/商品）、深色主题、卡片主题背景

### 待办 / 未验证（接手优先级从高到低）
1. **【P0】修复备份导出根因** —— 见 #1，一行改动
2. **【P1】真机「活动无法创建」** —— 见 #5，web 端已证未复现，需真机 logcat 确认
3. 【P1】数据抢救收尾：解析器 `tests/salvage_parse.mjs` 已就绪但未调通（见 #2）
4. 【P2】dayGuide/overview 的 kc-meta 显示 planned_end 尚未接入的部分入口
5. 【P2】keystore 密码移出 build.gradle（环境变量/local.properties）

## 六、已知问题与事故记录（★ 重要）

### #1 备份导出乱码（已定位根因，未修）
**现象**：手机导出的备份 json 是二进制乱码，两份文件头完全一致（确定性损坏）。
**根因**：`backup.js` 的 `Filesystem.writeFile({data: json, ...})` **没传 `encoding`**。
Capacitor 官方语义：不指定 encoding 时 data 按 **base64 解码**写入二进制。
JSON 不是合法 base64 → Android Base64.decode 跳过非法字符后解码 → 输出高熵二进制。
**修复**（一行）：三处 writeFile 都加 `encoding: Encoding.UTF8`（import { Encoding } from '@capacitor/filesystem'）。
**建议加固**：写入后立即 readFile 回读比对长度；导入 parse 失败时检测二进制特征给友好提示。

### #2 数据抢救（进行中，方法已验证）
- 损坏文件 = base64_decode(JSON 合法字符流)，**反向 base64 编码即可还原文本**：
  `cipher.toString('base64')` 得到的是「原 JSON 去掉所有非 [A-Za-z0-9+/=] 字符」的流。
  结构键名、数字、ID、时间戳、英文值全部完好；**中文字符串值永久丢失**（不在字母表内）。
- 工具链（tests/ 下）：`salvage_small.mjs/salvage_all.mjs`（还原字符流）→
  `_recovered_big.txt`(55万字符) 已生成 → `salvage_parse.mjs`（schema 状态机重建 JSON，
  **尚未调通**，resources 循环有 bug，接手人从此处继续）。
- 用户侧两份源文件：`C:\Users\qu\Desktop\发报接收和收件站\PersonalERP_backup_20260823*.json`

### #3 同文件并行编辑竞态（工程纪律）
对同一文件在一个批次里发多个局部替换，会随机出现「后写覆盖先写」导致部分修改静默丢失
（本项目至少发生 4 次，曾误判为 Vite 缓存/编辑器缓冲区）。
**纪律：同一文件的多处修改要么一次全量 Write，要么严格串行逐个确认落盘。**

### #4 澎湃 HyperOS 兼容
RemoteViews 颜色值 background 必须用 drawable 引用；WebView localStorage 可能被深度清理
（计时器因此做了原生双写）；Splash 主题会导致配置页白屏乱码（AppTheme.Config 已隔离）。

### #5 真机「活动无法创建」—— 已排查未复现（移交真机验证）
**现象**：用户报告「最新版根本创建不了活动」（release 包，澎湃 HyperOS 真机），无报错细节。
**已做排查（web 端全链路复现，结论=未复现）**：
- Playwright 空库全流程：引导页 → 建资源 → openActModal 表单 → 保存 → 入库/落盘 5/5 通过
- 连续创建 10 个活动全部成功、零 console/pageerror
- 领域层 createActivity 测试 9 条全绿（含原子性顺延分支）
- 关联线索：用户同期备份文件损坏（见 #1），且导入坏备份失败后 App 数据可能处于异常态；
  用户随后已卸载 App。两者是否因果相关**无法确认**（坏备份导入路径有 try/catch 兜底 toast，
  理论上不会破坏 db，但未在真机复现）
**给接手人的排查清单（真机 adb logcat 复现优先）**：
1. 确认装的是新 release（21:54/21:59 后的包），旧 debug 签名冲突会直接装不上或行为异常
2. logcat 抓 `Uncaught|TypeError|ReferenceError`，重点看 openActModal 内 `#atomic-preview`
   （新加实时预览代码）与 `App.startAct` 是否抛错
3. 检查手机本地是否有旧版本 localStorage 残留（`personal_erp_db_v1` 结构旧字段缺失，
   如 activity 无 `conflicts`/`planned_end` 字段 → 渲染/原子性代码 `a.conflicts||[]` 有兜底，
   但 `activityWindow`/`findConflicts` 对 null 字段有 `(a&&a.planned_start)` 防御，理论安全）
4. 若复现：优先怀疑**跨版本升级数据**（老库缺新字段）而非新建空库；新建空库路径已被
   Playwright 覆盖为绿色

## 七、设计约定速查

- UI 层禁止直改 db，一切写操作走 `App.engine.*`，返回 `{ok,error}` 统一处理
- 内联 onclick 全局调用约定：`App.overview.openActModal()` / `App.startAct(id)` / `App.timer.openForActivity(id)`
- 时间格式三种并存：planned_date=`YYYY-M-D`(非补零)、planned_start/end=`YYYY-MM-DDTHH:MM`、
  actual_*=毫秒时间戳（dateKey/datePartFromDatetime 负责互转）
- 测试基座：`freshDB()=seedDB()` 种子库；引擎断言风格 `assert.equal(r.ok,true)`
- 打包前检查清单：npm test 绿 → build 无错 → cap sync → gradle → 用 apksigner verify 抽查签名

## 八、给接手人的三句话

1. **领域层是宪法**：任何新功能先把规则写进 engine.js + 测试，UI 只是壳。
2. **双端一致性**：凡是涉及 localStorage 的能力，都要考虑 WebView 存储被 ROM 清理的风险，
   重要状态走原生 SharedPreferences（参考 timer.js 双写模式）。
3. **打包三步曲别偷懒**：build → sync → gradle，漏一步就是「功能在 dev 有、APK 里没有」。
