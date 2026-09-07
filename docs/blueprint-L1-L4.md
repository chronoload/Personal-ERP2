# Personal ERP — 智能推荐机 L1–L4 架构蓝图（Blueprint）

> **状态**: 蓝图草稿，待用户审阅与对抗性评审后才逐层实现。
> **锁定方向（用户裁决 2026-08-30）**：A 核心 + C 式匿名轨迹签名接缝；**pattern-matching（模式匹配），绝不 people-matching（不匹配真人身份、不互通私人账本）**。
> **配套范式**：单用户离线（localStorage + SharedPreferences）零后端；L1–L3 全本地；L4 为可选薄后端接缝，消费同一套契约，不重写 App 核心。

## 1. 目标（Goal）

把当前 `buildReport` 的静态周报/月报升级为一套**四层智能推荐机**：L1 报告塑型（新统计量 + 活动级明细 + 幻灯片演示 + PPTX/PDF 导出，API/MCP 契约预埋）→ L2 学习引擎（从账本/活动历史提炼特征信号）→ L3 推荐机（排程评分、空闲时段插入、反馈回报告作“教练”）→ L4 API/MCP + 社区（轨迹签名模式匹配，去身份）。

隐私铁律：**永不暴露原始账本 / 余额 / 身份**；导出去身份默认；社区只共享匿名化、归一化的**顺序模式签名**，不共享原始记录、不匹配个人身份。

## 2. 现状基线（已核实）

- `src/domain/report.js` 已具备 **v2 增量 schema**（`actDetail` / `timeBias` / `valueYield` / `schedHealth` / `budgetTrend` / `meta`），测试 167/167 绿。
- `meta` 已预埋 L2/L4 接缝：`planCompletion`、`timeBiasVector`（归一化去身份）、`trajectorySignatures`（占位）。
- `src/views/reportSlides.js` 6 页滑动 deck + `exportPDF`（print CSS）+ `exportPPTXBuild`（`src/services/pptx.js` 纯前端生成，已通过 OOXML schema 校验 0 错误）。
- 领域实体（`src/domain/entities.js`）：Activity（5 态状态机、time_logs、conflicts、retryCount、planned/actual 时间）、Plan（goal_id、budget、状态）、Goal、Output（activity_id、tags、状态）、ValueFlow（output_id、Pending/Closed/Overdue）、Resource（initial+Σd−Σc 不变量#1）、tx（resource_id、debit/credit、source_type/source_id）。

## 3. 全局约束（Global Constraints）

1. 版本地板相同：Vite + Capacitor，纯前端零后端依赖（L4 可选薄后端除外），不引入重量级框架。
2. schema 演进**增量**：v2 保 v1 键；v3 起保 v2 键；任何破坏性变更先版本化再迁移。
3. 去身份契约：导出/社区数据不得含 `title`/`note`/余额绝对值/身份；只含计数、比值、时长、归一化向量。
4. 时间注入：域函数不读系统时钟，`now` 由调用方注入（延续 `buildReport` 约定）。
5. 测试门：每层 `node --test` 全绿；域层纯函数、无 DOM，可进 node 测试。
6. 隐私红线：社区轨迹签名 = 匿名顺序模式，**pattern-matching 非 people-matching**；禁止匹配真人、禁止互通私人账本。

---
## L1 — 报告塑型（Report Refurbish）

**收尾面（用户已定的 5 类新统计量已实现于 v2）＋ API/MCP 契约**。L1 本次改动聚焦：把 v2 统计量/轨迹签名的边界定量化，保证 API 可序列化（无函数/无循环引用/纯 JSON）。

### L1 交付物
- `report.js` v2 已含 5 类新统计量；本次仅补**纯 JSON 化断言**（`JSON.stringify` 幂等）与**契约型**（类型注解注释）。
- **去身份转换 `stripIdentity(r)`**（新增，核心契约）：`meta` 里 `planCompletion`/`timeBiasVector`/`trajectorySignatures` 引用**原始内部 id**（`goal_id`/`plan_id`）——本地消费可以带 id，但**任何导出/序列化表面必须过 `stripIdentity`**：剥离全部 `*_id` 与标题，只留计数/比值/时长/归一化向量。
- `reportSlides.js` / `pptx.js`：导出已通（PPTX schema 0 错、PDF 非空）；本次补 **API 形状文档**。
- `docs/api/report-v2.md`：报告 v2 JSON 的结构化契约（字段、类型、单位、去身份字段标注），并钉死调用形状 `report.weekly({offset, now})` / `report.monthly({offset, now})` → report-v2 JSON。

### L1 验收
- `node --test` 167/167 全文绿；`JSON.stringify(buildReport(db))` 不抛、无 `undefined` 泄露。
- `JSON.stringify(stripIdentity(buildReport(db)))` 不含任何 `_id` / title / 余额绝对值（正则断言）——防 L4 契约继承原始 id 泄漏。
- 导出 PPTX 过 `officecli validate` 0 错；PDF 非空多页。

---
## L2 — 学习引擎（Learning Engine）→ 推荐机核心

**职责**：在账本 + 活动历史上提取**跨期的、顺序性的**特征信号，作为 L3 评分的输入，同时产出可去身份供 L4 的签名。

### L2.1 特征提取器（`src/domain/learn.js`，纯函数）
输入：`db` + 窗口区间列表（近 N 周）。输出：`FeatureSet`。

```js
// 返回：归一化特征（去身份，纯数字）
function extractFeatures(db, { weeks = 8, now = Date.now() } = {}) → {
  // completion: 按计划/目标的完成率（复用 buildReport.meta.planCompletion 的跨期累计版）
  // timeBias: 按计划的 计划分钟 vs 实际分钟 比值（聚合多期 → 稳定偏差系数 biasK 每计划）
  // yield: 按目标/计划的 价值流数 per 投入分钟（yieldDensity 跨期平滑）
  // sched: 冲突率、守约率、（timedActs : flexibleActs 占比）
  // budget: 计划预算消耗率（spend/budget）、资源 rechargeRatio 均值
  // 序列：每期 {biasK, yieldD, completionRate, schedHealth} 的时序，供 L4 签名
}
```

### L2.2 时间偏差模型（biasK）
对每个计划维护 `biasK = ΣactualMin / ΣplannedMin`（跨期），L3 用它把“计划分钟”校正为“更可能实际分钟”再做排程。
- **冷启动**：无实际数据计划 biasK=1，但必须带 `n=0` 置信权重，L3 不得信任低 n 的 biasK。
- **孤儿清理**：计划被删除/归档后，其累计 biasK 条目要随计划生命周期清理，防止死键堆积。
- 产出 `learn.biasModel`：`[{ planId, biasK, n }]`（**L3 消费；计划名不在此，仅 id+数字；n 为置信权重，L3 评分按 n 降权**）。
- **精度红线**：`FeatureSet` 用**浮点全精度**重算，不消费 `yieldDensity`（`×1000` 取整的展示值）——展示值喂给 L3 评分会失真；L3 一律用 learn 层未取整特征。

### L2 验收
- 新增 `tests/learn.test.js`：无数据 → biasK=1 且 n=0（L3 不信任）；单计划多期 → biasK 收敛；计划删除 → 条目清理；签名纯数字去身份断言。
- `node --test` 全绿（167 + 新增）。

---
## L3 — 推荐机（Recommendation Engine）

**职责**：消费 L2，排序“下一步做什么”、把任务插入空闲时段，反馈回 L1 作“教练”表面。

### L3.1 排程评分 `scheduleScore(planState, feats)`（`src/domain/recommend.js`，纯函数）
对每个候选（待办活动/计划），算一个 0~100 分：
- 完成率权重、时间偏差校正后的预估投入、价值产出密度、离截止日紧迫度、与已有排程冲突度。
- **探索/利用平衡（blocker 修复）**：纯贪婪评分会“总推荐完成率高任务”而饿死新计划——这违背“管理得更聪明”的初衷。
  必须加：① 低试验次数（低 n）候选的**探索加成**（UCB 式，`bonus ∝ sqrt(ln(total)/n)`）；② **最低推荐保证**（每周期至少浮现 N 个未完成/低 n 候选，防新任务永不出头）。
- 输出 `scored`：`[{ activityId, plannedStart, score, reasons[], trials }]`（`trials` = L2 侧统计到的该候选试验次数，供探索加成）。

### L3.2 空闲时段建议 `slotIntoFreeTime(timetable, candidates)` 
输入当前日历占用 + L2 biasK，输出“本周末可用 N 分钟建议插入活动 X”。去身份（不落库个人信息）。

### L3.3 推荐表面（opt-in 弹窗，User 定调「适时弹、可关掉、不招人烦」）
推荐不是常驻轰炸，而是**可关闭的一次性弹窗**，默认开启但用户可随时降级：
- **首访询问**：首次推荐出现前询「要试试智能推荐吗？」→ 同意则默认开启，拒绝则该周期不打扰。
- **适时弹**：只在**回报工作台打开 / 结束一次活动**等天然时机弹一次，不打断输入。
- **可关掉**：每次弹窗右上「×」关闭本次；弹窗内「提醒方式」可降级为「仅角标」或「彻底关闭」。
- **勿扰时段**：可设勿扰时间/频率上限（如每周最多 3 次），超限只留哑角标。
- **彻底停用**：设置里一键完全停用，此后永不弹（尊重“觉得烦就关掉”）。
- 所有偏好存 `localStorage`（离线、不失联、不落服务器）。

### L3 验收
- `tests/recommend.test.js`：评分单调性、冲突惩罚、biasK 校正生效、空候选幂等。
- 纯函数无 DOM，可进 node 测试；`node --test` 全绿。

---
## L4 — API/MCP 接缝 + 社交广播 / 共同习惯群基础设施（授权制·consented grouping）

**接缝原则**：L1–L3 的接口以 **API/MCP 可序列化契约**从第一天就定型（纯 JSON）、不绑定后端；L4 = 可选薄后端消费同一契约。App 保持单用户离线。

**L4 定位（User 定调，2026-08-30）**：L4 是可选的**社交广播 / 共同习惯群基础设施**，不是常驻功能——
- **授权制**：只有**主动授权**的用户才参与共享/广播；未授权用户一切照旧单机离线。
- **先模式匹配，再提议组群（与 pattern-matching 兼容）**：先按轨迹签名找「与你努力节奏相似」的匿名模式样板块；用户**决定是否**据此发起/加入群（consented grouping，绝不自动拉群）。
- **群 = 同类习惯的人自愿组**：群内只广播/共享**去身份的模式级信息**（如「本群平均每周 4 次闭环」），永不暴露成员账本/身份。
- **fail-safe**：无授权、无相近模式、或 k-匿名被触发时，L4 静默退化为「单人教练」，核心管理不受影响。

### L4.1 契约（`docs/api/*.md`）
- `report-v2`（L1 产物，经 `stripIdentity`）、`feature-set`（L2 产物）、`recommendation`（L3 产物）、`trajectory-signature`（L4 产物）四份 JSON 契约，全部去身份可序列化。
- MCP 工具形状（预留，不实现，**钉死精确 I/O**）：
  - `report.weekly({offset:int, now?:string}) → report-v2 JSON`
  - `report.monthly({offset:int, now?:string}) → report-v2 JSON`
  - `learn.features({weeks?:int}) → feature-set JSON`
  - `recommend.next({limit?:int}) → recommendation JSON`
  - `recommend.slot({freeMinutes:int}) → slot-advice JSON`
  - `community.matchPatterns({signature}) → pattern-list JSON`（仅匿名模式样板）

### L4.2 轨迹签名（核心创新，C 式中路径 + 时序）
`meta.trajectorySignatures`（existing）扩展为**事件序列编码**，而非周期聚合——只有事件顺序才保有 L4 要的真时序信号（Q3 修复：周期分桶仍是边际分布，会退回聚合）：
```js
// 事件链：goal→plan→output→vf 的**发生顺序**，时间平移到相对周期，身份剥离
signature = {
  v: 1,                                   // 签名版本（防演化错配）
  t0: 相对周期起点(周序号),                 // 绝对时间指纹已移除
  events: [                               // 按发生顺序，只含类型+数值
    { k:'g', actions:a, vf:v },           // goal 事件
    { k:'p', biasK, n },                  // plan 事件（biasK 为 L2 值）
    { k:'o', n },                         // output 事件
    { k:'v', closed:true },               // vf 闭环
  ],
}
```
- 去身份：只含枚举符号（k）+ 计数/比值；**无任何 `*_id` / title / 余额绝对值**（经 `stripIdentity`）。
- 时间平移：所有字符串型 `_id` 不出现；日期偏移到相对周序号。
- 签名相似度：`editDistance(events.map(e=>e.k))` 做序列对齐 + 数值向量加权，返回相似度 0~1。

### L4.3 社区匹配（仅模式，非真人 · 授权制组群）+ k-匿名
- 输入：本机授权用户 `stripIdentity` 后的轨迹签名。
- **k-匿名抑制（Q4 修复，防反指认）**：任何聚合单元（某 biasK 组合 / 某 events 子序列）若样本数 `n < k`（默认 k=5），一律抑制/置空，不进入共享签名谱——低 n 的独特轨迹正是反指认指纹源。
- 匹配：与**匿名聚合签名谱**做序列相似度，返回“与你的努力节奏相似的**模式样板** + 建议”。
- **提议组群（consented grouping）**：当存在 ≥m 个相似模式时，向用户提议「是否发起/加入一个共同习惯群」；**仅用户确认才组群**，绝不自动拉群。群内广播去身份的模式级统计，成员对彼此只有化名+模式概貌，无账本/身份访问。
- **绝不返回他人身份 / 私人账本 / 可反指认信息**（`stripIdentity` + k-匿名双重护栏 + 授权门槛）。

### L4 验收（接缝层）
- 契约 JSON 序列化幂等、去身份断言（**无 `*_id` / title / 余额绝对值**，正则全量扫）。
- 签名事件序列可计算编辑距离相似度（`tests/signature.test.js`）。
- **k-匿名**：构造 n<k 的独特签名 → 断言被抑制不进入共享谱（`tests/signature.test.js`）。
- **独立部署单元**：L4 后端/社区消费层是**独立的 opt-in 单元**，绝不被 import 进主离线 bundle（体积 + 隐私面双重约束）；本仓库只交付契约与签名生成，不交付后端本体。

---
## 实现顺序与依赖

```
L1（报告塑型收尾，契约定型） → L2（学习引擎） → L3（推荐机） → L4（签名 + 契约/MCP 预留）
   每次交付：node --test 全绿 + HANDOVER 更新 + 契约文档更新
```

## 非目标（Non-goals）
- 不实现后端/账号/同步（L4 仅为契约接缝 + 授权组群基础设施的预留）。
- **不做 people-matching / 身份互通**：永不返回/暴露成员私人账本或可反指认信息；群内成员彼此只有化名 + 模式概貌。
- **永不自动拉群**：组群一律用户主动确认（consented grouping）——先模式匹配，再**提议**组群，只有授权用户才参与。
- 不在本次引入机器学习框架——特征提取 + 评分纯手写零依赖。
- **推荐不招人烦**：opt-in 弹窗可关、可降级、可彻底停用（L3.3）。

---
## 对抗性评审结论（lead 自审，映射到上文各修复）

| # | 发现 | 严重度 | 修复落点 |
|---|------|--------|----------|
| 1 | `meta` 里 `trajectorySignatures`/`planCompletion`/`timeBiasVector` 直接暴露 `goal_id`/`plan_id` 原始内部 id；去身份契约被绕过 | **blocker** | L1 新增 `stripIdentity(r)`，一切导出/序列化表面必须过它；meta 仅本地带 id |
| 2 | L3 纯贪婪评分会饿死低完成率/新计划，违背“管理更聪明”本意 | **blocker** | L3 加 UCB 式探索加成 + 最低推荐保证 |
| 3 | `trajectorySignatures` 原为每目标聚合 → 时序列丢失，会退回边际分布 | major | L4.2 改为**事件序列编码**（按发生顺序），相似度用编辑距离 |
| 4 | 独特低 n 轨迹 = 反指认指纹 | major | L4.3 加 **k-匿名抑制**（n<k 置空），加 `stripIdentity` 双护栏 |
| 5 | 展示值 `yieldDensity`（×1000 取整）喂给 L3 会失真 | major | L2 精度红线：学习层浮点全精度重算，不消费展示取整值 |
| 6 | L2 biasK 冷启动/计划删除 → 死键/无置信 | minor | L2.2 加 `n` 置信权重、冷启动 biasK=1+n=0、孤儿清理 |
| 7 | MCP 工具 I/O 未钉死 → 后接仍可能返工 | minor | L4.1 钉死 6 个工具精确 I/O 签名 |
| 8 | L4 薄后端如混入离线 bundle → 体积+隐私双风险 | minor | L4 明确为独立 opt-in 部署单元，绝不 import 进主 bundle |

**裁决（lead）**：上述 blocker 已在这份蓝图内化解；L1–L4 已按蓝图实现并验证（`187/187` 全绿）。产品方向上，社区层按 User 2026-08-30 定调收敛为：**推荐 opt-in 弹窗**（可关可停用）+ **L4 授权制社交广播/共同习惯群基础设施**（只模式匹配、先提议后组群、绝不 people-matching、绝不自动拉群、未授权用户完全单机）。
