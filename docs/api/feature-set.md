# Contract: feature-set

> Personal ERP L2 学习引擎产物。生产者为 `extractFeatures(db)`（`src/domain/learn.js`）。
> **导出/API/MCP/社区共享表面必须经 `stripFeatureIdentity(f)`**（同一模块）——本页 `de-id ✓` 字段是去身份后保留；`de-id ✗`（planId/goalId）仅 L3 同进程消费，序列化前剥离。
> MCP 工具形状（预留）：`learn.features({weeks?:int}) → feature-set JSON`（已过 `stripFeatureIdentity`）。

## 顶层

| 字段 | 类型 | de-id | 说明 |
|------|------|:----:|------|
| `biasModel[]` | — | ✗(planId) → ✓(`biasRate`) | 时间偏差模型（L3 主输入） |
| `completion` | object | ✗(键) → ✓ | 完成率（按计划/目标） |
| `yield` | object | ✗(键) → ✓ | 价值产出（按计划/目标） |
| `sched` | object | ✓ | 排程健康 |
| `budget` | object | ✗(planId) → ✓ | 预算消耗趋势 |

> 去身份导出形态为 `stripFeatureIdentity` 输出：`biasRate` 取代 `biasModel`，`byPlan/byGoal` 的 id 键被剥除，`budget.overspendCount` 纯计数。

## biasModel（raw，L3 消费）→ biasRate（de-id）

| 字段 | 类型 | de-id | 说明 |
|------|------|:----:|------|
| `planId` | string | ✗ | 本地内部 id（仅 L3 同进程用） |
| `biasK` | number | ✓ | `ΣactualMin/ΣplannedMin`（**浮点全精度，未取整**） |
| `n` | int | ✓ | 置信权重（有实际数据的活动数）；冷启动 `n=0` |

去身份 `biasRate[].{biasK, n}`：只保留偏差分布，不暴露哪个计划。

## completion

| 字段 | 类型 | de-id | 说明 |
|------|------|:----:|------|
| `byPlan[].planId` | string | ✗ | 内部 id |
| `byPlan[].done/failed/total` | int | ✓ | 完成/失败/总活动 |
| `byPlan[].rate` | number | ✓ | done/total |
| `byGoal[]` | 同上 | ✗(goalId)/✓ | 按目标聚合 |

## yield

| 字段 | 类型 | de-id | 说明 |
|------|------|:----:|------|
| `byPlan[]/byGoal[].planId\|goalId` | string | ✗ | 内部 id |
| `[].actsEnded` | int | ✓ | 已结束活动数 |
| `[].spentMinutes` | int | ✓ | 投入分钟 |
| `[].vfCount` / `[].outputCount` | int | ✓ | 价值流/产出数 |
| `[].yieldDensityFull` | number | ✓ | `vfCount/spentMinutes`（**浮点全精度；L3 评分用此值，勿用 report 的 ×1000 取整展示**） |

> 精度红线：`yieldDensityFull` 未取整；`report.valueYield[].yieldDensity` 是 ×1000 展示值，L3 **严禁**消费展示值。

## sched

| 字段 | 类型 | de-id | 说明 |
|------|------|:----:|------|
| `actsWithConflict` / `totalConflicts` | int | ✓ | 冲突活动数/总冲突 |
| `timedActs` / `flexibleActs` | int | ✓ | 定时/灵活活动占比 |
| `adheredActs` | int | ✓ | 守约数（计划日当天实际开始） |
| `total` | int | ✓ | 活动总数 |

## budget

| 字段 | 类型 | de-id | 说明 |
|------|------|:----:|------|
| `byPlan[].planId` | string | ✗ | 内部 id |
| `byPlan[].budget/spend/remaining` | number\|null | ✓ | 预算/花费/剩余 |
| `byPlan[].overspend` | bool | ✓ | 超支 |
| `overspendCount`（de-id） | int | ✓ | 超支计划数（纯计数） |

## 去身份保证（L2 验收）

- `JSON.stringify(stripFeatureIdentity(f))` 幂等、无 `undefined`。
- 不带任何 `planId`/`goalId`；只含枚举键 + 数字/比值/时长。
- `keepIdentity` 不存在于此层：L3 消费 `extractFeatures` 原值（含 planId），导出一律 `stripFeatureIdentity`。
