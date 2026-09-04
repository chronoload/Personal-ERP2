# Personal ERP · 个人经济系统

> **自包含单机「个人经济系统 ERP」**：把个人的时间 / 精力 / 金钱统一建模为**资源账户**，
> 一切行为（活动、兑换、消费）都必须经过**领域引擎**记账，形成可审计的账本。
> 无后端、无服务器，全部数据存 WebView `localStorage` + 原生 `SharedPreferences` 双份。

---

## ✨ 这是什么

Personal ERP 是一个**严格账簿**的个人管理系统。它的核心不是「记待办」，而是：

- 把时间 / 精力 / 金钱都当成**可度量的资源货币**
- 每次行动（开始一个活动、兑换、消费）都**必产生流水**，账实相符
- 由**领域引擎**强制六条**全局不变量**，普通 CRUD 修不掉的漏洞在这里被挡在门外

一句话：**这是「个人经济系统」，不只「个人待办清单」。**

---

## 🧱 技术栈

| 层       | 选型                                           |
| -------- | ---------------------------------------------- |
| 构建     | Vite 6 + 原生 JS（ESM，无框架）                |
| 移动端   | Capacitor 8（Android）                         |
| 测试     | Node 内置 test runner（`node --test`）       |
| 代码量级 | 约 40 个源码模块，构建产物 ~136KB（gzip 42KB） |
| 编辑器   | Vditor 4（Markdown 速录）                      |

---

## 📁 目录结构

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
│  │  ├─ report.js         # 周报/月报（纯函数 buildReport，L1 去身份契约）
│  │  ├─ learn.js          # L2 学习引擎（extractFeatures → FeatureSet）
│  │  ├─ recommend.js      # L3 推荐机（scheduleScore / slotIntoFreeTime / UCB 探索）
│  │  ├─ signature.js      # L4 轨迹签名（encodeTrajectory / k-匿名抑制）
│  │  └─ taskStateMachine.js # 解耦任务状态机（PENDING...TIMEOUT + Lease）
│  ├─ views/               # 视图层（每个 Tab 一个模块，onclick 走全局 App.*）
│  │  ├─ overview.js       # 活动 Tab：资源卡/看板(五态)/表单(含原子性预览)/价值流
│  │  ├─ calendar.js       # 日历+当日日程（时间段显示、⚠冲突标记）+ 周视图时间网格
│  │  ├─ goals.js / stats.js / setup.js（首次引导）/ dayGuide.js（新一天五步向导）
│  │  ├─ timer.js          # 全屏番茄钟：时间戳锚定 + 原生通知 + 跨进程双写持久化
│  │  ├─ workspace.js      # 单一 Vditor 编辑器（Markdown 双向速录）
│  │  ├─ mdviews.js        # md 组织器（🗂目标 / 📅日 / 🗓周 / 📆月）
│  │  ├─ reportSlides.js   # L1 智能简报 6 页滑动 deck + PPTX/PDF 导出
│  │  └─ topbar.js         # 顶栏（计时按钮红色 .timer-btn）
│  ├─ services/
│  │  ├─ backup.js         # 导出/导入/自动备份 ⚠ 见「已知问题#1」
│  │  ├─ widget.js         # 小组件数据桥（pushData/pullFromNative，rev 修订号）
│  │  ├─ ics.js            # ICS 日历导出（循环系列展开 occurrences）
│  │  ├─ pptx.js           # 纯前端 .pptx 生成（OOXML + ZIP 容器，零依赖）
│  │  ├─ agentMCP.js       # L4.1 agent MCP 适配器（6 只只读工具，去身份边界）
│  │  ├─ notifications.js / system.js / scheduler.js / sync.js
│  └─ ui/helpers.js        # openModal/toast/badge/esc 等 UI 原语
├─ android/app/src/main/java/com/personal/erp/
│  ├─ MainActivity.java    # 启动页（erpLaunchTab 事件跳转小组件点击）
│  ├─ widget/              # WidgetPlugin / WidgetStore(SharedPreferences) / 四类 WidgetProvider
│  └─ sync/                # SyncPlugin.java + MiniHttpServer.java（安卓内置 HTTP 接收）
├─ tests/*.test.js         # 领域层测试（node --test，目前 248 条全绿）
├─ docs/                   # 契约文档（api/）、蓝图、perp-project 产物
├─ android/personal-erp.keystore  # ★ 发布签名（密码在 build.gradle 明文，勿丢）
├─ HANDOVER.md             # 项目交接文档（接手必读，含已知问题与事故记录）
└─ 启动.bat                # 一键 npm run dev
```

---

## 📦 安装与启动

```bash
npm install          # 安装依赖
npm run dev          # 开发（http://localhost:5173）
npm test             # 领域层测试（node --test tests/*.test.js，248 条）
npm run build        # 产出 dist/
```

### 打包（Android APK）

> ⚠️ 改了 `src` 之后打包三步缺一不可：`npm run build` → `npx cap sync android` → `gradlew assemble*`。

```bash
npm run build
npx cap sync android
cd android && gradlew assembleDebug     # 调试包
cd android && gradlew assembleRelease   # 签名发布包 → app/release/app-release.apk
```

---

## 🔒 领域模型

```
Goal 1:N Plan M:N Activity 1:1 Output 0:1 ValueFlow
Resource 与 Tx(流水) 构成账本
Goods（商品）含 costs[] 多资源成本，快速消费生成 credit 流水
```

### 活动六态状态机

```
Planned → Started → Completed → Reviewed → Archived  +  Failed(终态，不堆积)
```

转移表 `ACTIVITY_TRANSITION_TABLE` 为单一真源（显式规则，无隐藏魔法）。

### 六条全局不变量（engine 强制，测试覆盖）

1. **余额** = `initial + Σdebit − Σcredit`（冲正也是真实分录）
2. **Complete 必带流水与产出**（否则拒绝）
3. **Output Archived 自动生成 ValueFlow(Pending, +7天)**
4. **计划预算硬约束**（预算耗尽 → 冻结活动开始/完成）
5. **冲正生成新流水且余额回补**（绝对禁止 UPDATE/DELETE）
6. **Failed 不堆积**（仅 Completed/Failed(循环) 衍生下一期）

### 时间原子性

有 `planned_start` 且时长 > 0 的活动占固定时段，**一律禁止重叠**；冲突默认自动顺延到最近空闲槽（上限 30 天），也可「坚持此时间」捆绑仲裁。

### 计时器跨进程持久化

时间戳锚定 `endTs−now`，**double-write** 到 `localStorage` + 原生 `SharedPreferences`；启动 `restore()` 快路径 + `restoreNative()` 兜底（抗 ROM 清理）。

---

## 📊 智能推荐机 L1–L4（前瞻蓝图，已落地）

四层严格依赖：L1 报告塑型 → L2 学习引擎 → L3 推荐机 → L4 社区接缝。

| 层 | 名称     | 内容                                                                                 | 契约                                 |
| -- | -------- | ------------------------------------------------------------------------------------ | ------------------------------------ |
| L1 | 报告塑型 | 周/月报 + 活动级明细 + 6 页滑动 deck + PPTX/PDF 导出 + `stripIdentity` 去身份      | `docs/api/report-v2.md`            |
| L2 | 学习引擎 | `extractFeatures` → biasK 模型（n 置信权重）+ UCB 探索                            | `docs/api/feature-set.md`          |
| L3 | 推荐机   | `scheduleScore` 0~100 + `slotIntoFreeTime` 空闲插入 + opt-in 弹窗（可关/可停用） | `docs/api/recommendation.md`       |
| L4 | 社区接缝 | 匿名轨迹签名（事件序列编码 + k-匿名抑制）· pattern-matching 非 people-matching      | `docs/api/trajectory-signature.md` |

> 完整蓝图见 `docs/blueprint-L1-L4.md`（含对抗性评审 8 项修复）。
> 隐私铁律：**永不暴露原始账本 / 余额 / 身份**；导出去身份默认；社区只共享匿名化归一化的顺序模式签名。

---

## 🧪 测试

```bash
npm test   # node --test tests/*.test.js，目前 248 条全绿
```

覆盖：领域层引擎 38 条、时间原子性、`report`/`learn`/`recommend`/`signature`、`agentMCP` 13 条、`mdimport`/`mdapply`/`mdview`、任务状态机等。

---

## ⚠️ 已知问题（重要，见 HANDOVER.md §六）

1. **同文件并行编辑竞态**：同一文件的多处局部替换会「后写覆盖先写」→ **要么一次全量 Write，要么严格串行**。

---

## 📜 设计约定速查

- **UI 层禁止直改 db**，一切写操作走 `App.engine.*`，返回 `{ok,error}` 统一处理
- 领域层是宪法：任何新功能先把规则写进 `engine.js` + 测试，UI 只是壳
- **双端一致性**：重要状态走原生 SharedPreferences（参考 timer.js 双写模式）
- **打包三步曲别偷懒**：build → sync → gradle

---
