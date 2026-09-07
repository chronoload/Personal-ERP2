# Personal ERP · 项目交接文档

> 更新日期：2026-08-30 ｜ 版本：release 已构建（app-release.apk，签名 personal-erp.keystore）
> 本档为发布后迭代：L4.1 agent MCP 适配器 + 目标"三级归档"交互修正 + 完成弹窗多资源收支 + UI 质感增强。

## 〇-1、本迭代要点（2026-09-06 · 移动端 md 同步根治 + 信息量压缩）

## 〇-2、Android 套壳适配审计（2026-09-06 · 已实现 5 项 + 路线图）

**已实现**：
1. **硬件返回键闭环（main.js，@capacitor/app backButton）**：返回键逐层退出浮层——通用弹窗
   → 新一天引导 → 计时浮层 → AutoPilot 三条底部条 → 快捷入账条 → 非首页 Tab 回首页 → 才退出
   应用。此前任何弹窗打开时按返回 = 直接杀 App。仅原生平台注册（web 无此实现，注册会抛
   `_pendingBack` 空指针——ErrorLog 已捕获验证过）。
2. **safe-area 全覆盖（app.css）**：viewport-fit=cover 早已设置但 CSS 从未用 env(safe-area-inset-*)，
   edge-to-edge（Android 15+/刘海屏）下内容顶进状态栏。现 topbar 顶部、底部 Tab 栏与 content
   底距、modal-mask、计时全屏、AutoPilot 三条底部条、快捷入账条全部按 inset 让位。
3. **键盘 adjustResize（Manifest）**：MainActivity 加 `android:windowSoftInputMode="adjustResize"`，
   键盘弹出时 WebView 正确压缩而不是遮挡表单。
4. **导出统一出口（services/saveFile.js）**：WebView 里 `<a download>` 是 no-op（无下载管理器
   接管）——此前 APK 上「导出 .md / 导出 PPTX」全部静默失败。现统一走 saveFile：原生落盘
   Documents/exports/<文件名> + toast 路径（文件管理器可见），web 保持 Blob 下载；二进制
   （pptx 的 zip）按 base64 落盘。已接入 workspace .md 与 downloadPptx；ICS 原本就有原生分支。
5. **可变屏占比 + 全屏编辑模式**：编辑器新增「⛶ 全屏」（按钮/Esc/硬件返回键退出）——卡片
   reparent 到 body 后 fixed 铺满视口（z=55：高于内容、低于弹窗 60/计时 90，弹窗仍可浮出），
   Vditor 高度按剩余空间实测、退出还原 440px。两个坑：① 祖先 `.dash-track` 的轮播 transform
   会劫持 fixed 包含块（顶栏盖不住）→ 必须 reparent；② reparent 后原容器查询失效 → 卡片引用
   在 render 时抓取。原「小视口压缩编辑器高度」按 User 裁决移除（编辑窗口本来就小）。
   configChanges 已含 rotation/screenSize（旋转不重建）；轮播断点 860px 覆盖手机横屏/折叠内屏。
6. **★ 夜间模式编辑器文字**：Vditor 的 dark 主题只调背景，`.vditor-reset` 基类仍是深色字
   （#24292e）→ 夜间下正文几乎不可读。app.css 显式补：正文 var(--text)、标题白、code/pre
   深底浅字、blockquote/链接配套色。**背景即时跟随**：编辑器常驻缓存，theme 只在构造时设置——
   新增 `window.__wsApplyTheme(dark)`（内部 vd.setTheme）由 applyNightTheme 调用，统计页切换
   主题即刻生效，无需重渲染。
7. **★ 活动 Tab「静默消失」根治**：轮播 `goToPage` 在容器隐藏（display:none）期间被 resize
   触发（键盘开合正好打在隐藏期）时，用 offsetHeight=0 测量并把 pager 高度**锁死为 0**——
   切回活动 Tab 整页高度为 0 = 消失。双保险：goToPage 对 `offsetParent===null` 早退（隐藏期
   不测量，保留此前正确高度）+ activateTab 激活活动页 60ms 后调 `overview.refreshPagerHeight()`
   重测自愈遗留的 0 高度。
8. **★ 编辑器缓冲区外部重置**：视图缓存让编辑器常驻，外部改库（目标页改名/删除、小组件、
   备份恢复、局域网同步）后缓冲区陈旧——下次 sync 会把外部修改**改回去**（改名被撤销）。
   新增 `bufferDirty`（input 置位 / sync 成功清零）+ `window.__wsReloadFromDb`（App.render 时
   调用）：缓冲干净才用 db 重组当前视图；有未提交编辑绝不重置（让位给用户，blur 时正常
   reconcile）。setValue 误触发的脏标记用 inputSeq 序号识别清除。

**路线图（按价值排序，均需 gradle 重建或大改，未动）**：
- 状态栏/导航栏图标颜色：装 @capacitor/status-bar，按 nightTheme 切 style（夜间+系统浅色时
  透明状态栏深色图标对比度不足）；需 npm install + gradle。
- 文件关联打开：Manifest intent-filter 注册 .json/.md，从文件管理器「打开方式」直达导入；
  需新增路由（读 intent data → importFromFile 语义）。
- PDF 导出：window.print 在 WebView 无效；做原生 printToPDF 插件或只保留 PPTX 路线。
- 系统字体缩放：Android textZoom 会放大 WebView 文本、px 布局可能溢出；尊重无障碍（现状）
  或 Java setTextZoom(100)（牺牲无障碍）或全站 rem 化（大工程）。
- @capacitor/keyboard：键盘出现时的精细滚动/光标配合。

### 本迭代要点正文（2026-09-06 · 移动端 md 同步根治 + 信息量压缩）

- **★「分钟条目不断被重复」根治（md 同步四层修复，tests/md_sync_dup.test.js 14 条新增，全量 266 绿）**：
  1. **bindEntityLine 缺 g 标志（真正的根源机制）**：无 g 时 replace 只访问第一个同标题行——
     若它是已绑定行，后面真正的无 id 行永远轮不到补 id → 下轮 sync 再建一份 + 引擎原子性自动顺延
     （09:00→09:30→10:00…每轮一份占一个新空槽）。goal/plan 正则同样补 g；活动正则同时容忍
     行首缩进（嵌套列表）与有序列表行。
  2. **多重集对账匹配（applyViewCandidates / applyCandidates）**：无 id 行先按「规范标题+排程」
     在作用域内对账既有活动（同签名第 k 行绑第 k 个未绑定实体，boundIds 排除已绑定），命中走更新
     并回传 `createdRefs{bind:true}`；不够才新建。保留「同内容多行=多实体」语义（测试锁定），
     buffer 反复应用必然收敛（幂等）。「无 id 一律新建」旧教义正是移动端逐轮复制的语义根源，
     mdapply.test.js 对应断言已改写。
  3. **视图切换顺序修复（workspace tabs）**：旧代码先改 curView 再 sync——日视图内容被按 goal
     镜像解析，凭空创建「今日」目标/日期计划并错误归属。现先按旧视图身份落库，再切换+重排。
  4. **「未分类」往返豁免（parseMdImport pushPlan）**：serializeDbToMd 给 orphan 活动的兜底
     区段 `## 未分类` 导回时不再创建「（未分类）」目标+「未分类」计划（此前每次切 goal 视图
     都多出一套幽灵层级）；活动保持 orphan，往返幂等。
- **移动端同步触发加固（workspace.js）**：blur 在 Android WebView 不可靠（键盘收起/切后台不触发）——
  新增停手 900ms 防抖提交（input 驱动）+ visibilitychange/pagehide 强制 flush（编辑缓冲不再随
  重渲染丢失）+ sync 防重入；id 绑定回填**不看聚焦状态**（isFocused 同样会说谎，回填必达）；
  打字途中（fromInput）不弹删除确认/状态提示（推迟到失焦），防打断。IME 组合输入期间推迟提交。
  stripId/repairIdMarkers 识别并剥净全部三种 id 形态（注释/lute 链接/WYSIWYG 裸残余），
  一行多形态残留不再产生以 id 为名的垃圾或双 id 行。
  调试钩子：`window.__wsVd`（编辑器）/ `__wsSync`（驱动真实同步闭包）/ `__wsView`（当前视图）。
- **UI 信息量压缩（"专注敏捷而不是眼花缭乱"）**：
  - 轮播**自动播放移除**（每 2 秒自动翻页是眼花缭乱首因，只留手势/点导航）；
  - 活动表单分层（openActModal）——**已按 User 裁决回退（2026-09-06）**：折叠式布局对日常
    使用无增益，恢复原始一屏平铺（名称/备注/关联计划/时间/分钟/循环/结束日/预设收支/主题）；
    折叠样式 `details.modal-sec` 保留在 CSS 里备用，暂无使用方；
  - 看板卡片 meta 三行合一（归属·📅日期·🔁循环），实际起止移入 title，计时进度条只在有实际
    计时值时出现，备注单行截断（悬停看全）；
  - 编辑器卡头冗余文案删除；同步状态行安静原则（无变更/无警告时不渲染）。
- **★ 夜间模式补齐（2026-09-06 巡检）**：`.modal-panel { background:#fff }` 从无深色覆盖——
  深色块里写的 `.modal-box` 是 DOM 里不存在的类（历史笔误）→ 所有弹窗夜间态白底+浅色标题不可读。
  补齐：弹窗面板/标题、新一天引导面板（.dg-panel）、看板卡文字变量（--kc-text/--kc-sub/
  --kc-note-* 深色值，否则备注/归属在深卡上不可读）、进度条轨道、日历选中态/计数徽章、
  tag-chip、溢出菜单 hover、fb.ok、collapse-btn、勾选 chip 选中态（--primary 提对比）。
  Vditor 编辑器主题改为与 applyNightTheme 同一判据（auto+系统深色也算深），不再出现
  「页面深色、编辑器纯白」割裂。浅色模式回归已验证（完成弹窗/表单逐屏截图比对）。
- **轮播右边界滑动修复**：overview 轮播最右页继续左滑此前硬编码 `App.setTab('goals')`，
  越过「资源」直达「目标与计划」，不符滑动直觉。现经 `App.tabOrder`（main.js 暴露全局 Tab 序）
  计算下一个 Tab（活动→资源）；App 内勿再硬编码 Tab 跳转。回归：左边界右滑停留、页内滑动切页正常。
- **月视图「空白椭圆块」优化**：补位空格类名 `.cal-day.empty` 与通用占位类 `.empty`（虚线圆角
  白底）撞车，一直渲染成块状。终版方案：补位格改用独立类 **`.cal-day.cal-fill`**（不与任何
  通用类撞车）——透明背景融入面板、无 hover 高亮，但照常撑起网格 hairline（线条完整不断）；
  行首/月末补位均保留。`.cal-grid` 补深色底（此前被补位块的实心底盖住）。教训：
  通用短类名（.empty）会被无关组件意外继承，新占位类取名要带前缀。
- 验证：`node --test` 266/266 绿；`vite build` 过；真机浏览器（420px 视口）冒烟——干净库下
  6 轮恶劣同步 + day→goal→day 切换往返 + 追加同步，活动恒 1 份、goals/plans 恒 0，行正确回填 id。
- 打包：`npm run build` → `npx cap sync android` → `gradlew assembleRelease`（三步曲照旧）。

## 〇、本迭代要点（2026-08-30）

- **L4.1 agent MCP 适配器（`src/services/agentMCP.js`，契约** **`docs/api/mcp-agent.md`）**：
  6 只只读工具（report.weekly/monthly / learn.features / recommend.next / recommend.slot / community.matchPatterns），
  结果信封 `{ok, tool, version, data|error, warnings?}` 永不抛异常；
  去身份边界（stripIdentity/stripFeatureIdentity/k-匿名）与授权门槛（communityAuth）齐备；
  存储接缝 `loadDb()/loadPrefs()/loadAnonSpectrum()` 注入式，node 可测。
  已按契约对齐：recommend.next 的 limit=1~~20/k=0~~10、recommend.slot 的 freeMinutes **必填**、
  候选映射含 plannedStart/deadline、community 输出严格遵循 §3.6 `PatternList`
  （patterns/localSignature/groupProposal/suppressed）并附 k-匿名抑制警告。
  测试 `tests/agentMCP.test.js` 13 条，全量 200 绿。

- **目标"三级归档"交互**：目标/计划/活动三级统一「归档 = 从主视图降级」；
  目标卡片操作外露保留（＋计划/编辑/删除），状态/归档收进**长按目标卡片**弹菜单（500ms，短按仍收起/展开）。

- **完成弹窗收支多资源化**：支出/收入改为行式列表（资源+金额+备注+移除），与预设收支/改账同构。

- **UI 质感增强（CSS）**：收支行轻卡片底、输入焦点光晕、分区虚线、提醒条渐变、弹窗层次阴影（含深色同步）。

- **L3 智能推荐接入 App（活动级顺序转移推荐 → 一键新建，2026-08-30）**：AutoPilot 新增 F6 推荐条——**活动级**：从「已完成活动」（无论是否挂计划）按完成时间排序，学**活动模板间**转移关联（做完 A 通常接着做 B）。
  `suggestNextActivities(db,{k=3,minTransitions=1})`（`src/domain/recommend.js`）：活动模板 = 标题去尾随数字归一（「写作 2」→「写作」）；连续相邻相同模板（循环连做）跳过；返回前 k 个最强后继（转移关联降序，同级更久没做优先）。
  **触发降级**：无转移关联时降级为「最近完成过的活动模板」（`degraded:true`，transCount=完成次数），冷启动/稀疏数据也有推荐可弹（修复「使用中从不触发」）。
  F6 推荐条：「💡 接下来「阅读」…」+「↻ i/k 换一个」+「一键新建」（预填标题/时段/时长，不强制挂计划，`openActModal` 支持 `presetTitle`/`presetMinutes`）+「×」（当天忽略该活动模板）。
  不限次数（User 裁决取消每周上限）；设置「智能推荐」开关（`smartRecommend`，默认开，可彻底关闭）。
  测试 `tests/recommend.test.js` 活动级/降级/top-k 共 8 条，全量 208 绿。社区化（L4）本轮**未接入 App**（按用户裁决暂缓，域层/适配器/契约已就绪）。

- **Markdown 双向速录 + 单一文本编辑器（mdimport + mdapply + mdviews + workspace，2026-08-30）**：JSON 仍是唯一存储，md 是可手打/可交换的视图面。
  `src/domain/mdimport.js`：`parseMdImport`（手打 md → 候选，规则 v1：frontmatter default / #目标 / ##计划 / ##日期组 / -\[ ]活动（兼容 lute 大写 \[X]）/ @时间词·时长 / (计划)归属 / 状态词(进行中/失败/归档) / #标签 / \[x]；隐藏式 id 绑定 `<!--id:xxx-->` 兼容 lute 链接式 `[!--id:x--](!--id:x--)`）+ `serializeDbToMd`（mirror 完整镜像）+ `serializeEntityLine`/`replaceEntityLine`（单行局部替换）。
  `src/domain/mdapply.js`：候选 → db（**id 绑定更新——改名不断链**；**无 id 一律新建（db 授 seq id，弃内容推导 hash id——同一内容多行是独立实体，绝不冲突）**；**稳健化** **`hardenActivities`** **三层防御**——D1 空标题行（回车空项）不落库、D2 相邻内容完全相同行合并（回车/复制误操作）、D3 同 id 重复行忽略（编辑器复制隐藏 id）；`view:` 标记走**视图局部同步**——只更新带 id 活动、无差异不触碰、视图内新行新建并回补 id、范围内缺失即删（scope=视图日期组∪未排程，范围外不碰）；状态对齐走状态机不绕过，失败记 `statusFails` 供回滚/唤起完成面板）。
  **编辑器 = 单一 Vditor 4**（`src/views/workspace.js`，活动 Tab「📝 编辑器」卡片）：只有一个文本编辑兼展示器，无任何其他交互组件（vim/终端式）。「视图」= 对 db 的一次重排（`src/views/mdviews.js` 组织器：🗂目标层级 / 📅日 / 🗓周 / 📆月），切换即把 db 组织成另一份 md 填进同一编辑器；日/周/月视图支持 **‹ 今天 › 日期导航**（日 ±1 天 / 周 ±1 周 / 月 ±1 月，锚点跨 render 保留）。**同步模型 = 失焦提交（blur）**：编辑器是纯编辑缓冲，编辑中系统**绝不 setValue / 不写 db**（input 仅只读更新预览），失焦才一次性 parse→reconcile→落库→回填；切视图/导航前先 `sync()` 落库再重排——杜绝 input 重入导致的跳顶/光标丢失/覆盖输入。**视图局部增删**——无 id 新行 → 新建并回补隐藏式 id（bindEntityLine 按 occurrence 绑定，防同标题多行漏绑）；范围内缺失即删（作用域限定视图覆盖日期组 ∪ 未排程，范围外不碰），确认后落盘；**空标题带 id 残留行（回车副本）→ ghostIds 标记存在，不触发缺失即删误删**。**指令顺序宽容**——活动行 `(计划)/#标签/(状态)` 在 @ 前后均可剥离、不混入活动名。**完成态认真处理**——勾选 \[x] 非法流转 → **唤起完成面板**（openCompleteModal 原子完成：Planned 先 start 再登记收支产出完成），填了就完成、取消才回滚该行；Completed 不回退。`sanitize:false` + CSS 隐藏 lute 渲染的 id 链接。「导出 .md」归一化回可读注释。Vditor 引入使主 bundle 增至 \~570KB（gzip 160KB）。
  测试 `mdimport` 15 + `mdapply` 16 + `mdview` 7，全量 248 绿。

> ⚠️ 本仓库已功能冻结（2026-08-24）：项目迁移至 TWS2-Eco monorepo
> （apps/perp-web SolidJS 重写 + packages/perp-core TS + apps/perp-mobile）。
> 数据无缝：新 APK 覆盖安装即继承全部账本。迁移说明见 TWS2-Eco/docs/perp/MIGRATION.md。
> 以下内容仅作历史参照。

## 一、这是什么

自包含单机「个人经济系统 ERP」：把个人的时间/精力/金钱统一建模为**资源账户**，
一切行为（活动、兑换、消费）都必须经过**领域引擎**记账，形成可审计的账本。
无后端、无服务器，全部数据存 WebView localStorage + 原生 SharedPreferences 双份。

**技术栈**：Vite 6 + 原生 JS（ESM，无框架）+ Capacitor 8（Android）+ Node 内置 test runner。
**代码量级**：约 40 个源码模块，构建产物 \~136KB (gzip 42KB)。

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
Goods（商品）含 costs\[] 多资源成本，快速消费生成 credit 流水。

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
  （native\_txs 防覆盖机制：桌面产生的流水 id 回合进 JS 库）

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

- **周期编辑三态（新，2026-08-30，对标 Google/Outlook）**：循环活动编辑弹窗新增「编辑范围」——全部 / 此期及后续 / 仅此期。engine `updateSeries`：`all`=普通整系列更新；`following`=当期与其后全部期次日期整体平移（保持原间隔，repeat\_until 超越则截断但保留当期）；`only`=当期摘出为独立单次活动（例外），系列保留其余期次，摘空则退化为非循环空壳。守卫：非循环拒绝 / Started 只允许 all / 当期 done 只允许 all。S12 测试 6 条。

- **周视图时间网格（新，2026-08-30）**：日历卡片月/周切换（`calMode`）。周视图 = 7 列 × 6:00\~23:00 时间轴（40px/h），时间定位色块（计划色左边条；done=绿淡/skipped=灰删除线/future=虚线半透明），全天/弹性活动收顶部条区；点表头选日、点空白时间格 = 该日该钟点新建（预填 HH:00）、点色块 = 编辑；下方保留当日日程表。深色主题同步覆盖。

- **ICS 导出（新，2026-08-30，仅导出）**：`src/services/ics.js` `buildICS` 纯函数 + `ICS.export`。循环系列展开 occurrences\[] 为多 VEVENT（保留历史），Planned→TENTATIVE / done→CONFIRMED / skipped·Failed→CANCELLED；有时间为本地浮时（DTSTART/DTEND），无时间为全天（次日 DTEND）；SUMMARY/DESCRIPTION/CATEGORIES 转义；75 字节行折叠。统计页「数据管理」新增「📅 导出日历 (ICS)」：native 存 Documents/exports，web 触发下载。单机闭环不回导（往返丢账本字段）。

- **视图瘦身 + 三级归档降级（2026-08-30）**：归档 = 从主视图降级，收进「已归档」折叠区，三级统一：

  - 活动（Activity）Archived → 看板 Done 列移除，收进「📦 已归档」折叠区（只读不可拖回）；日历 byDay 跳过；计划内活动列表过滤 + 「📦 已归档（N）」折叠区

  - 计划（Plan）Archived → 目标下收进「📦 已归档计划（N）」折叠区（默认收起）

  - 目标（Goal）Archived → 收进「📦 已归档（N）」目标折叠组（默认收起）；状态菜单收进目标卡片「⋯」弹窗（不挤占卡片位置，含 状态/归档/恢复）；目标轻态机 Active→Completed→Archived（`setGoalStatus`），旧库 status 幂等回落 Active

  - 计划内活动列表默认前 20 条 + 「展开剩余 N 条 ▾」（防撑爆）

- **预设收支一键完成（新，2026-08-29，多资源版）**：活动可预设 `preset_expenses/preset_incomes`（多资源数组，同 Goods.costs\[]），计划可设 `default_expenses/default_incomes`（新建该计划下活动自动继承，快照式）；
  有预设的 Started 活动点「完成」= 一键入账（产出标题=活动名，不变量2 天然满足），入账后弹轻确认条「已入账 支出X/收入Y \[有要改的吗]\[关闭]」；
  「有要改的吗」→ 改账弹窗（多行多资源）→ `amendActivityLedger` 走冲正语义重记（不变量5，审计留痕）。无预设活动走原表单，零回归。
  引擎新入口：`quickCompletePreset` / `amendActivityLedger` / `sanitizePresets`。schema 升 v3（v2 单资源字段自动迁移为单元素数组）。

- **自动失败接入 AutoPilot（F5，修「超时未完成却不失败」）**：Started 且超出 计划时长+宽限期(`Prefs.failGraceMin`，默认30分钟) 仍未完成 → `failActivity`；
  循环→衍生下一期，非循环→re-init 回 Planned（retryCount 递增可重试）。幂等静默，timer-overlay 时跳过。此前 `failActivity` 仅有引擎+测试、App 内无任何调用方。

- **周报 · 月报（新，2026-08-29）**：`src/domain/report.js` 纯函数 `buildReport`（周期=周一\~周日 / 自然月，offset 支持历史期次）；
  模块可配置（活动汇总/收支流水/计划投入/余额变化/价值流，`Prefs.reportModules`）；统计页「📊 周报·月报」卡片手动查看 + 每周日/每月末 20:00 通知提醒（`Scheduler.syncPeriodicReportReminders`，`Prefs.reportRemind` 可关）。

- **★ 原生插件注册修复（Capacitor 8 时序根因，2026-08-29）**：`BridgeActivity.onCreate` 内同步建桥（`super.onCreate → this.load() → bridgeBuilder.create()`）。此前 `MainActivity.onCreate` 在 `super.onCreate()` 之后调 `registerPlugin(...)`——桥已创建，插件只进 builder 从不生效 → JS `registerPlugin('Sync')` 永远「not implemented in Android」。正确做法：**在本类重写** **`load()`，在** **`super.load()`（真正建桥）之前注册**三个插件（Widget/Sync/Timer）。启动/回前台 extra 改由 `load()` 触发的 `onNewIntent(getIntent())` 统一处理，不再在 onCreate 重复。

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

- **★ 循环任务改为「系列容器 + 期次数组」模型（2026-08-29 定稿）**：一条活动 = 一个循环，内部 `occurrences[]` 存全部期次（`{date, status: pending|done|skipped, completedAt?}`）；列表/日历只出现这一条（不再生成 N 份副本 → 列表不爆炸、删除即删整个系列、批量问题消失）。完成/失败一期 → 标记该期次并把 `planned_date` 原地推进到下一 pending 期次（weekday 跳过周末由 `nextOccurrenceDate` 处理）；到 repeat\_until 全部完成后系列终态。无 until 默认 30 期，可随时「⋯ → 续生成后续 30 期」（`extendRecurrence` 追加期次并解除 until）。卡片显示 `M/N 期` 进度，「⋯ → 📅 期次」弹窗查看各期状态。engine：`buildOccurrenceDates/currentOccurrence/advanceRecurrence/seriesProgress/extendRecurrence`；`completeActivity/failActivity` 内做推进。**编辑清空计划时间不再产生「无当前期」悬空**：`updateActivity` 对循环系列回落首个 pending 期次（`fallbackSeriesDate`），非循环仍清空（S10 测试）。非循环活动失败仍自动 re-init 回 Planned（可重试）不变。

- **小组件同步加固（2026-08-29）**：`refreshNative` 去掉 `enabled()` 门槛（桌面直接添加小组件也能拿到核心数据，不必先进 App 设置开开关）；回前台（`syncFromNative`）立即推送最新 db 到小组件；JS `setEnabled` 同步写原生 `widgetEnabled`，保持两端一致。此前「小组件不同步/无法与核心配合」根因=插件未注册（见上），已一并修复。

- **自动备份「去假」：本地备份清单 + 一键恢复（2026-08-29）**：此前自动/立即备份虽落盘，但 App 内无清单无恢复入口（安卓端文件在 app 私有 Documents，用户文件管理器常不可见）→ 观感=假备份。现 `Backup.listLocalBackups()`（native 读 Documents/backups 目录 / web 读 localStorage 历史）+ `readLocalBackup()`；统计页「数据管理」新增「本地备份清单」：列出备份并可一键恢复（走 doImport 增量合并/全量替换）。

- **看板按计划过滤（新，2026-08-29）**：活动看板上方新增过滤条「全部 / 未关联 / 各计划」，点选后按计划过滤五态看板（`kanbanPlanFilter` 内存态，`App.overview.setKanbanPlanFilter`）。

- 形式化状态机解耦（Activity 六态 + TaskState 八态 + TRANSITION\_TABLE 单一真源 + Lease + Sequential/Parallel Behaviour，`taskStateMachine.js` 独立模块，与现有五机零冲突，139 用例全绿）

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
4. 【P2】dayGuide/overview 的 kc-meta 显示 planned\_end 尚未接入的部分入口
5. 【P2】keystore 密码移出 build.gradle（环境变量/local.properties）

## 六、已知问题与事故记录（★ 重要）

### #1 备份导出乱码（已定位根因，未修）

**现象**：手机导出的备份 json 是二进制乱码，两份文件头完全一致（确定性损坏）。
**根因**：`backup.js` 的 `Filesystem.writeFile({data: json, ...})` **没传** **`encoding`**。
Capacitor 官方语义：不指定 encoding 时 data 按 **base64 解码**写入二进制。
JSON 不是合法 base64 → Android Base64.decode 跳过非法字符后解码 → 输出高熵二进制。
**修复**（一行）：三处 writeFile 都加 `encoding: Encoding.UTF8`（import { Encoding } from '@capacitor/filesystem'）。
**建议加固**：写入后立即 readFile 回读比对长度；导入 parse 失败时检测二进制特征给友好提示。

### #2 数据抢救（进行中，方法已验证）

- 损坏文件 = base64\_decode(JSON 合法字符流)，**反向 base64 编码即可还原文本**：
  `cipher.toString('base64')` 得到的是「原 JSON 去掉所有非 \[A-Za-z0-9+/=] 字符」的流。
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

- 时间格式三种并存：planned\_date=`YYYY-M-D`(非补零)、planned\_start/end=`YYYY-MM-DDTHH:MM`、
  actual\_\*=毫秒时间戳（dateKey/datePartFromDatetime 负责互转）

- 测试基座：`freshDB()=seedDB()` 种子库；引擎断言风格 `assert.equal(r.ok,true)`

- 打包前检查清单：npm test 绿 → build 无错 → cap sync → gradle → 用 apksigner verify 抽查签名

## 八、给接手人的三句话

1. **领域层是宪法**：任何新功能先把规则写进 engine.js + 测试，UI 只是壳。
2. **双端一致性**：凡是涉及 localStorage 的能力，都要考虑 WebView 存储被 ROM 清理的风险，
   重要状态走原生 SharedPreferences（参考 timer.js 双写模式）。
3. **打包三步曲别偷懒**：build → sync → gradle，漏一步就是「功能在 dev 有、APK 里没有」。

## 九、下一代蓝图（2026-08-30 立项 · 路线决策 + L1 报告重构蓝图）

> 本仓库已功能冻结并迁移 TWS2-Eco，但以下「智能推荐机」路线作为**前瞻蓝图**记录于此，
> 供后续在 TWS2-Eco 落地时作规格依据。此处只落决策与契约，不推代码。

### 路线决策（已锁定）

- **A 核心**：在单用户离线本仓内自底向上建 L1→L3（报告塑型 → 学习引擎 → 推荐机），
  全部**本地、可离线、零后端**。每个接口从第一天起按 **API/MCP 就绪契约**设计，为 L4 预埋接缝。

- **L4 社交接缝（C 口径）**：社区学习用**匿名化轨迹签名（trajectory signature）做**模式匹配，
  **不做人找人（people-matching）**。隐私姿态：**永不暴露原始账本、余额、身份**；只共享
  压缩的、归一化、去身份的『目标→计划→产出』价值流模式序列（保序但剥离时间戳与身份）。

- **唯一遗留产品决策**（非技术）：L4 是「模式匹配（学习）」还是「人匹配（社交）」——现定为前者。

### 四层架构（严格依赖序）

| 层  | 名称   | 内容                                              | 产出/契约                    |
| -- | ---- | ----------------------------------------------- | ------------------------ |
| L1 | 报告塑型 | 周/月报重构：新统计量 + 活动级明细 + 幻灯片（App内滑动 + 导出 PPTX/PDF） | report schema v2 + 幻灯片接口 |
| L2 | 学习引擎 | 从账本/活动历史提取特征信号（完成率、时间偏差、价值产出）                   | feature vector 契约        |
| L3 | 推荐机  | 消费 L2 排名 next-action、空槽调度、反馈回 L1（教练闭环）          | recommendation I/O 契约    |
| L4 | 社区接缝 | 匿名轨迹签名 → 模式匹配学习（未来）                             | signature + 聚合契约（预埋）     |

> **完整四层架构蓝图见** **`docs/blueprint-L1-L4.md`**（含 2026-08-30 对抗性评审结论：L1 去身份转换 `stripIdentity`、L3 探索/利用平衡、L4 事件序列签名 + k-匿名、MCP 工具 I/O 钉死）。**L1–L4 已全部实现**（见下「L2–L4 落地」），进入对接/演示阶段。

### L1 报告重构蓝图（本期焦点，已确认需求）

**形式**：App 内可滑动的幻灯片 deck **+** 导出 PowerPoint(PPTX)/PDF。
**新增统计量**（五个全部入选，超出当前 活动汇总/收支/计划投入/余额/价值流 五模块）：

1. **活动级明细（exact acts level）**：每活动一行——计划分钟 vs 实际分钟、完成/失败、
   目标贡献、挂账收支（该活动花/得了什么）。「更聪明地管理」的核心明细层。
2. **时间估计偏差（planned vs actual）**：每计划 实际/计划 分钟比，暴露长期高估/低估
   排程（→ L3 更聪明地排期）。
3. **价值流产出（value-flow yield）**：按目标/计划的 产出(Output/ValueFlow) / (投入用时+资源)，
   「是否值得做这件事」的量化。
4. **排程健康（conflicts/shifts）**：本期因冲突自动顺延次数、损失/找回的空闲、时间窗守约率。
5. **预算/资源趋势 vs 计划预算**：各资源余额期初→期末、vs 计划预算超支告警、充/耗比。

**契约预埋**：L1 的 report 输出须同时发出 **feature vector / 轨迹签名** 所需字段（见 L2/L4），
使后续无需返工。当前 `report.js buildReport` 为纯函数（时间 by 注入，无 DOM/系统时钟），
L1 重构须延续此纯度；偏移支持已存在（offset 历史期次）。

### 设计约束（沿用本仓纪律）

- 领域层纯函数 + 测试（`report.js` 同理，先写测试后实现）

- UI 只调 `App.report.*`，不直改 db；幻灯片交互在视图层

- 导出走 officecli 能力（PPTX）或打印样式页（PDF），不引入重型依赖

### L1 实施落地（2026-08-30 完成 · 本仓内，供 TWS2-Eco 迁移时对齐）

**domain（`src/domain/report.js`，纯函数，additive 保留 v1 键）**：`buildReport` 新增

- `actDetail[]`：活动级明细（`planned_minutes`/`actual_minutes`/`biasRatio`/`goal_ids`/
  `ledgerAttach{debit,credit,n}`/`outputCount`/`vfYield`/`failed`/`retryCount`/`conflictCount`）。
  实际耗时优先 `time_logs` 求和，回退 `actual_end-actual_start`，无则 0；弹性活动（`planned_minutes=0`）`biasRatio=null`。
  本期信号 = 实际结束/开始/创建任一在期。

- `timeBias`：`{byPlan:[{plan_id,title,actsWithActual,totalPlannedMin,totalActualMin,ratio}], overall}`，
  仅统计 `planned>0 && actual>0` 的活动。

- `valueYield`：`{byGoal[], byPlan[]}`，每项 `{goal_id|plan_id, outputCount, vfCount, actsEnded, spentMinutes, yieldDensity}`；
  只计已结束（Completed/Failed）的投入。

- `schedHealth`：`{actsWithConflict, totalConflicts, timedActs, flexibleActs, adheredActs}`。

- `budgetTrend`：`{resources:[{id,name,unit,before,after,net,debit,credit,rechargeRatio}], plans:[{plan_id,title,budget,spend,remaining,overspend}], overspend[]}`；
  资源净额含冲正（t4 反冲）；计划 spend 仅计活动挂账 credit（冲正不计）。

- `meta`（L2/L4 特征种子，去身份）：`planCompletion`、`timeBiasVector`（归一化数字向量）、`trajectorySignatures`（占位数组）。

**测试**：`tests/report_v2.test.js` 6 项全绿；全套 `167/167` 通过。

**视图（`src/views/reportSlides.js`，浏览器模块，不 import 进 node 测试）**：

- `openSlidesReport()` 打开 6 页可滑动 deck（①总览②活动明细③时间偏差④价值产出⑤排程健康⑥预算趋势），
  复用 `.dash-pager/.dash-track/.dash-page/.dash-nav` CSS（窄屏滑动，桌面纵向堆叠）；pager 逻辑自包含于本模块。

- `exportPDF()`：打印样式（`@media print` 追加至 `app.css`，一页一页 `break-after: page`）。

- `exportPPTXBuild()`：**纯前端生成真实 .pptx**（见下），安卓 / web 通用，**不依赖 officecli**。

**PPTX 纯前端生成（`src/services/pptx.js`，零依赖）**：

- **为何不用 officecli**：安卓 webview / 移动端没有桌面 CLI，`officecli` 方案在移动端是死路。
  故改为浏览器内直接产出 `.pptx`（OOXML 也是 zip）。

- **实现**：`CompressionStream('deflate-raw')` 手写 ZIP 容器 + CRC32，组装 OOXML 标准 10+ 部件
  （`[Content_Types].xml`、`_rels/.rels`、`ppt/presentation.xml`、`slideMasters/slideLayouts/theme/slides`）。
  标题形状带 `p:ph type="title"` 占位符（officecli/PowerPoint 正确识别标题页）。

- **数据形态**：`reportSlides.buildDeck(r, label)` 把聚合报告翻成 6 页 `{title, lines}` 文本，
  内容与屏上幻灯片一致，**去身份**（只含计数/比值/时长，无原始流水/余额/身份）。

- **验证**：officecli 校验输出 6 页、标题全部识别、中文正常。移动端一键下载真 `.pptx`。

- `scripts/export_report_pptx.js`（桌面 officecli 编译脚本）降级为**可选桌面通道**，非唯一出口。

**接线**：`App.reportSlides` 暴露于 `main.js`；`stats.js` 周报/月报卡片新增「📊 智能简报」按钮。

#### L1 阶段二·去身份转换 + 契约定型（2026-08-30，蓝图批准后补）

- **`stripIdentity(r, {keepIdentity=false})`**（`src/domain/report.js`）：把 `buildReport` 输出转成「纯数字可序列化」导出面——
  剥离全部 `*_id`/`id`/`title`/`name`/余额绝对值(`before`/`after`)/`meta` 原始计划键，只留计数/比值/时长/净变化(`net`)/单位。
  任何 导出/API/MCP/社区共享 表面必须经它（防内部原始 id 泄漏，对抗评审 #1）；`keepIdentity:true` 原样返回（本地在设备用）。

- **契约**：`docs/api/report-v2.md` 钉死 report-v2 每字段 类型/单位/`de-id ✓|✗` 标注 + MCP 工具形状（`report.weekly|monthly({offset,now})`）。

- **测试**：新增 2 项（去身份无泄漏 + keepIdentity 原样），递归扫描器断言导出面无任何 `*_id`/title/name/before/after。

- **验证**：全套 `169/169` 通过；`vite build` 成功；导出面 JSON.stringify 幂等无 undefined。

#### L2–L4 落地（2026-08-30，蓝图批准后逐层实现）

**L2 学习引擎（`src/domain/learn.js`）**：

- `extractFeatures(db)` → `FeatureSet`：`biasModel[{planId, biasK, n}]`（浮点全精度、n 置信、冷启动 biasK=1+n=0、孤儿计划清理）、`completion`、`yield`（`yieldDensityFull` 未取整，精度红线）、`sched`、`budget`。

- `stripFeatureIdentity(f)` 去身份导出（剥 planId/goalId 键 → 纯计数数组）。

- 契约 `docs/api/feature-set.md`；MCP `learn.features({weeks})`。

**L3 推荐机（`src/domain/recommend.js`）**：

- `scheduleScore(cand, feats)` → 0\~100（完成率/价值密度/紧迫/冲突 + **UCB 探索加成** `c·√(ln(Σn)/(n+1))`）。

- `minRecommendGuarantee(scored, k)` 保底浮现低 n 新任务到 ≥60（Blocker #2 防饿死新计划落地）。

- `recommendNext()`（排序+探索+保底+limit）、`slotIntoFreeTime()`（空闲时段冲突避让）。

- 契约 `docs/api/recommendation.md`；MCP `recommend.next|slot`。

**L4 社区接缝（`src/domain/signature.js`）**：

- `encodeTrajectory(db)` → **事件序列签名**（g/p/o/v + wk 相对周，无 `*_id`/title/余额，防反指认）。

- `similarity(a,b)` 编辑距离相似度 0\~1；`kAnonymitySuppress(profiles, k=5)` 抑制低 n 独特签名（Blocker #4）。

- 契约 `docs/api/trajectory-signature.md`；MCP `community.matchPatterns`（仅模式匹配，非 people-matching）。

- **独立 opt-in 单元**：L4 后端不在本仓实现，绝不 import 进主离线 bundle。

**产品方向定调（User 2026-08-30，文档已更新，代码不动）**：

- **推荐 opt-in 弹窗**：适时弹、可关、可降级「仅角标」、可设勿扰/频率上限、可**彻底停用**（L3.3，偏好存 localStorage）。

- **L4 = 授权制社交广播 / 共同习惯群基础设施**：只有授权用户参与；**先模式匹配，再提议组群**（consented grouping，绝不自动拉群）；群内只广播去身份模式级统计；未授权用户完全单机。仍无 people-matching / 身份互通。

**验证**：全套 `187/187` 通过（169 + 6 learn + 8 recommend + 4 signature）；`vite build` 成功。

**导出“空文件/文件已损坏”根因修复（2026-08-30）**：

- **症状**：网页端导出 PPTX 尺寸正确但 PowerPoint 报“文件已损坏”；PDF 打印预览空白。

- **PPTX 根因（3 类 OOXML 规范违例）**：

  1. `SLIDE_RELS(i)` 让每页 slide 引用 `slideLayout${i+1}.xml`，但只生成了 `slideLayout1.xml`——
     第 2\~6 页引用了不存在的布局，PowerPoint 严格校验必报损坏。改为所有页统一引用 `slideLayout1`。
  2. `a:rPr sz` 用了错误的单位（`sz="16"`/`sz="28"`，而 DrawingML 是**百分之一磅**，必须 ≥100），
     改为 `sz="1600"`(16pt)/`sz="2800"`(28pt)。
  3. `docProps/app.xml` 空 `HeadingPairs`/`TitlesOfParts` 违反 schema（要求含 `vt:vector`），已移除（二者可选）。

  - 另补 `docProps/core.xml`+`app.xml` 及它们的内容类型与根 rels（缺 core props 也会触发修复提示）；

  - 形状 `cNvPr id` 由随机改为**自增唯一**（重复 id 也会被 PowerPoint 标记）。

  - **教训**：officecli 旧 `view/get/query` 解析宽容，读得动但**未做 schema 校验**，因此漏报；
    需用 `officecli validate <file>`（完整 OOXML schema）或自写“每条 .rels Target 必须解析到真实部件”的严格检查。

- **PDF 根因**：旧打印样式用 `visibility:hidden` 遮罩 + `#report-print{position:absolute; inset:0}` ——
  遮罩不释放版面导致大量空白页，absolute+inset:0 把内容裁成单页。改为 `body>*:not(#report-print){display:none}` 隔离 +
  wrapper/每页 `position:static` 流入文档流，`page-break-after` 自然分页，无空白页。

- **验证**：`officecli validate` + 自写严格校验器均 **0 错误**；真实无头 Chromium 驱动 UI 导出
  `.pptx`（11.6KB）与 `Page.printToPDF` 渲染的 PDF（399KB）均非空；`node --test` 167/167 绿。

**契约预埋已兑现**：`meta` 含 L2 feature vector（`timeBiasVector`）与 L4 `trajectorySignatures` 占位（仅聚合，去身份）。
