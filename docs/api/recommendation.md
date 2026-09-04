# Contract: recommendation

> Personal ERP L3 推荐机产物。生产者：`scheduleScore(cand, feats, opts)` / `recommendNext(candidates, feats, opts)` / `slotIntoFreeTime(slots, candidates, opts)`（`src/domain/recommend.js`）。
> 消费 L2 `feature-set`。输出 `recommendation` JSON（**默认已去身份**：只含 `activityId` 占位 + 纯数字分数/原因，不含 title/账本/余额）。
> MCP 工具形状（预留，不实现本仓）：
>   - `recommend.next({limit?:int, k?:int, now?:string}) → [推荐项]`
>   - `recommend.slot({freeFrom:string, freeMinutes:int, limit?:int}) → [建议插入项]`

## 顶层（recommendation）

| 字段 | 类型 | 去身份 | 说明 |
|------|------|:----:|------|
| `[]` 数组 | — | ✓ | 按评分降序的推荐项 |
| `[].activityId` | string | ✓(引用键) | 候选活动标识（本地消费用；对外序列化可再哈希化，见 L4） |
| `[].score` | number (0~100) | ✓ | 综合评分 |
| `[].reasons[]` | string[] | ✓ | 人类可读理由（只含度量词，无身份） |
| `[].estMinutes` | int | ✓ | biasK 校正后的预计投入分钟 |
| `[].n` | int | ✓ | 该候选试验次数（探索权重） |
| `[].guaranteed` | bool | ✓ | 是否经「保底浮现」 |

## 评分组成（scheduleScore）

| 部件 | 权重 | 说明 |
|------|:----:|------|
| `completion` | 0.20 | 计划级完成率（L2 completion.byPlan.rate） |
| `yield` | 0.20 | 价值产出密度（L2 `yieldDensityFull` **浮点全精度**，绝不用 ×1000 展示值） |
| `urgency` | 0.25 | 截止紧迫度（已逾期=1 → 14 天后≈0） |
| `bias` | 0.10 | biasK 校正后预计投入合理性 |
| `conflict` | 0.15 | 冲突惩罚（每处 −40% 该部件） |
| `exploration` | (+ ≤0.12) | **UCB 探索加成**：`c·√(ln(totalTrials+1)/(n+1))`，低 n 候选获探索分，防饿死新计划 |

> 输出含 `parts{completion,yield,urgency,bias,conflict,exploration}` 供可解释性/调试（MCP 层可选暴露）。

## 保底浮现（minRecommendGuarantee）

- `k`（默认 2）：前 k 个低试验（`n≤2`）候选被强制拉到 `score≥60`，标记 `guaranteed:true`。
- **目的**：防止「总推荐高完成率任务」永远压住新计划（Blocker #2 的工程落地）。

## slotIntoFreeTime（建议插入）

| 字段 | 类型 | 说明 |
|------|------|------|
| 输入 `slots[]` | `{start(ms), end(ms)}` | 空闲时段 |
| 输入 `candidates[]` | `{activityId, duration(min), deadline, conflicts, score}` | 候选 |
| 输出 `[]` | `{activityId, slotStart(ms), score}` | 已分配（冲突避让、按时段升序） |

## 去身份保证

- 输出不含 `title` / 余额 / 流水 / 任何私人文本。
- `activityId` 为本地引用键；跨边界共享时经 L4 `stripIdentity` 风格哈希/编号占位。
- `JSON.stringify(recommendNext(...))` 幂等、无 `undefined`。
