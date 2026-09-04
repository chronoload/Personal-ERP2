# Contract: report-v2

> Personal ERP 周报/月报 v2 结构化契约。L1 产物。生产者为 `buildReport(db, {period, offset, now})`（`src/domain/report.js`）。
> **导出/API/MCP/社区共享表面必须经 `stripIdentity(r)`**（同一模块）——本页 `de-id ✓` 标注的字段是去身份后仍保留的；`de-id ✗` 的字段仅本地（在设备上）可见，任何序列化前被剥离。
> MCP 工具形状（预留）：`report.weekly({offset:int, now?:string})` / `report.monthly({offset:int, now?:string})` → 本文档 JSON（已过 `stripIdentity`）。

## 顶层

| 字段 | 类型 | 单位 | de-id | 说明 |
|------|------|------|:----:|------|
| `period` | `'week'\|'month'` | — | ✓ | 周期类型 |
| `offset` | int | — | ✓ | 0=当前期，负前 |
| `start`/`end` | int | ms | ✓ | 周期边界 `[start,end)` |
| `label` | string | — | ✓ | 可读周期文本（如 `8月24日 ~ 8月30日`） |<!-- 非身份 -->

## activity（活动汇总）

| 字段 | 类型 | de-id | 说明 |
|------|------|:----:|------|
| `completed` / `started` / `failed` / `created` | int | ✓ | 本期各状态计数 |
| `daily` | `{ 'Y-M-D': int }` | ✓ | 每日完成分布 |

## ledger（收支流水）

| 字段 | 类型 | de-id | 说明 |
|------|------|:----:|------|
| `incomeTotal` / `expenseTotal` | number | ✓ | 收入/支出总额 |
| `revCount` / `n` | int | ✓ | 冲正数 / 本期流水数 |
| `rows[]` | — | ✓ | 每资源净变动（去身份：只剩单位+数值） |
| `rows[].unit` | string | ✓ | 资源单位（如 元/h，非身份） |
| `rows[].debit/credit/net` | number | ✓ | 净得/净耗/净变动 |

## plan（计划本期投入）

| 字段 | 类型 | de-id | 说明 |
|------|------|:----:|------|
| `rows[].spend` | number | ✓ | 本期计划投入 |
| `rows[].budget` | number\|null | ✓ | 计划预算（去身份后保留，非身份） |

> 去身份前每行含 `id`/`title`（✗），仅本地可见，序列化剥离。

## balance（余额变化）

| 字段 | 类型 | de-id | 说明 |
|------|------|:----:|------|
| `rows[].unit` | string | ✓ | 单位 |
| `rows[].net` | number | ✓ | 期末−期初净变化 |

> **余额绝对值 `before`/`after`（✗）为隐私核心，去身份默认剥离**，只保留净变化 `net`。

## vf（价值流）

| 字段 | 类型 | de-id | 说明 |
|------|------|:----:|------|
| `created` / `pending` / `closed` | int | ✓ | 本期新增/待反馈/已闭环 |

## actDetail（活动级明细，每活动一条）

| 字段 | 类型 | de-id | 说明 |
|------|------|:----:|------|
| `status` | string | ✓ | 活动状态 |
| `planned_minutes` / `actual_minutes` | int | ✓ | 计划/实际投入分钟 |
| `biasRatio` | number\|null | ✓ | actual/planned 比值 |
| `goal_count` | int | ✓ | 归因目标数 |
| `ledgerAttach` | `{debit,credit,n}` | ✓ | 挂账净额 |
| `outputCount` / `vfYield` | int | ✓ | 产出数/价值流数 |
| `failed` | bool | ✓ | 是否失败 |
| `retryCount` / `conflictCount` | int | ✓ | 重试/冲突数 |

> 身份字段 `id`/`title`/`plan_ids`/`goal_ids`（✗）序列化前剥离；`goal_count` 保留计数。

## timeBias（时间估计偏差）

| 字段 | 类型 | de-id | 说明 |
|------|------|:----:|------|
| `byPlan[]` | — | ✓ | 每计划偏差（**不含 plan_id/title ✗**） |
| `byPlan[].actsWithActual` | int | ✓ | 有实际数据的活动数 |
| `byPlan[].totalPlannedMin`/`totalActualMin` | int | ✓ | 累计计划/实际分钟 |
| `byPlan[].ratio` | number\|null | ✓ | actual/planned |
| `overall` | 同上 | ✓ | 全局汇总 |

## valueYield（价值产出）

| 字段 | 类型 | de-id | 说明 |
|------|------|:----:|------|
| `byGoal[]` / `byPlan[]` | — | ✓ | 按目标/计划聚合（**不含 *_id ✗**） |
| `[].actsEnded` / `spentMinutes` | int | ✓ | 已结束活动数/投入分钟 |
| `[].vfCount` / `outputCount` | int | ✓ | 价值流/产出数 |
| `[].yieldDensity` | number | ✓ | vfCount/spentMinutes（×1000 展示值；**L2/L3 评分须用学习层浮点全精度，不消费此取整值**） |

## schedHealth（排程健康）

| 字段 | 类型 | de-id | 说明 |
|------|------|:----:|------|
| `actsWithConflict` / `totalConflicts` | int | ✓ | 冲突活动数/总冲突 |
| `timedActs` / `flexibleActs` | int | ✓ | 定时/灵活活动占比 |
| `adheredActs` | int | ✓ | 守约活动数 |

## budgetTrend（预算资源趋势）

| 字段 | 类型 | de-id | 说明 |
|------|------|:----:|------|
| `resources[]` | — | ✓ | 每资源（**不含 id/name/before/after ✗**） |
| `resources[].unit` | string | ✓ | 单位 |
| `resources[].net/debit/credit` | number | ✓ | 净/得/耗 |
| `resources[].rechargeRatio` | number\|null | ✓ | debit/(debit+credit) |
| `plans[]` | — | ✓ | 每计划预算（**不含 plan_id/title ✗**） |
| `plans[].budget/spend/remaining` | number\|null | ✓ | 预算/花费/剩余 |
| `plans[].overspend` | bool | ✓ | 超支 |
| `overspendCount` | int | ✓ | 超支计划数（去身份后纯计数） |

## meta（L2/L4 接缝）

| 字段 | 类型 | de-id | 说明 |
|------|------|:----:|------|
| `planCompletion[]` | — | ✓ | 完成率数组（**去身份前以 plan_id 为键 ✗，序列化转纯数组**） |
| `planCompletion[].done/failed/total/rate` | int/number | ✓ | 计数与完成率 |
| `timeBiasVector[]` | `[number,number,number]` | ✓ | 归一化偏差三元组（纯数字，L3 排程学习） |
| `trajectorySignatures[]` | — | ✓ | L4 轨迹签名（**去掉 gid ✗**） |
| `trajectorySignatures[].actsEnded/vf/yieldDensity` | int/number | ✓ | 匿名聚合 |

## 去身份保证（L1 验收）

- `JSON.stringify(stripIdentity(buildReport(db)))` 幂等、无 `undefined`。
- 正则全量扫描不含：`*_id` / `title` / `name` / `before` / `after`（余额绝对值）。
- `keepIdentity:true` 时原样返回（仅本地在设备上，不序列化）。
