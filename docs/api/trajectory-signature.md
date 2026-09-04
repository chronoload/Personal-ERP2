# Contract: trajectory-signature

> Personal ERP L4 轨迹签名产物。生产者：`encodeTrajectory(db)`、`similarity(a,b)`、`kAnonymitySuppress(profiles, k)`（`src/domain/signature.js`）。
> 编码为**事件序列**（非周期聚合——对抗评审 #3 修复：只有事件顺序才保有真时序信号），用于社区**模式匹配**（pattern-matching，**非 people-matching**）。
> 全程去身份 + k-匿名（对抗评审 #4 修复：低 n 独特轨迹 = 反指认指纹源，必须抑制）。
> MCP 工具形状（预留，不实现本仓后端）：
>   - `community.matchPatterns({signature}) → pattern-list JSON`（仅匿名模式样板，绝不返回他人身份/账本）

## 顶层

| 字段 | 类型 | 去身份 | 说明 |
|------|------|:----:|------|
| `v` | int | ✓ | 签名版本（当前 1，防演化错配） |
| `t0Week` | int | ✓ | 相对起点（周序号，绝对时间指纹已移除） |
| `len` | int | ✓ | 事件数 |
| `events[]` | object[] | ✓ | **按发生顺序**的事件序列 |
| `counts` | object | ✓ | `{ g, p, o, v }` 各类型计数 |

## events[]

| 字段 | 类型 | 说明 |
|------|------|------|
| `k` | enum | 事件类型符号（==`EV` 值，见下） |
| `wk` | int | 相对周序号（时间平移后，无绝对日期） |
| `actions` | int | goal 事件：完成/推进动作数 |
| `vf` | int | goal 事件：本期闭环价值流数 |
| `biasK` | number\|null | plan 事件：该计划偏差（L2 值；结构占位） |
| `n` | int | plan/output 事件：试验次数/产出数 |
| `tagsN` | int | output 事件：标签数（只计数，不含标签文本） |
| `closed` | int | vf 事件：是否闭环 |

**事件类型枚举（`EV`）**：`g`=目标、`p`=计划、`o`=产出、`v`=价值流闭环。

## 序列相似度

- `editDistance(a,b)`：对 `events[].k` 序列做标准编辑距离。
- `similarity(a,b) = 1 − dist/max(lenA,lenB)`，范围 0~1；1=完全相同，双空序列=1。

## k-匿名抑制（kAnonymitySuppress）

- 输入 `profiles: {sig, groupKey?}[]`，阈值 `k`（默认 5）。
- 按 `groupKey`（缺省用事件类型序列 `events[].k` 的 JSON）聚合计数；**样本数 < k 的独特签名被剔除**，不进共享谱。
- 返回 `{ shared: [...], suppressed: int }`。
- **目的**：防止独特轨迹（低 n）被用作反指认指纹；任何社区共享必须先过此函数。

## 社区匹配（L4.3 · 授权制 · 组群基础设施）

- 输入：本机**授权用户** `stripIdentity` 后签名；未授权用户不参与此层，一切单机。
- 匹配：与**匿名聚合签名谱**（已过 `kAnonymitySuppress`，k≥5）做序列相似度，返回「与你的努力节奏相似的模式样板 + 建议」。
- **提议组群（consented grouping）**：存在 ≥m 个相似模式时，向用户**提议**发起/加入共同习惯群；**仅用户确认才组群**，绝不自动拉群。
- 群内广播**去身份的模式级统计**（如「本群平均每周 4 次闭环」）；成员彼此只有化名 + 模式概貌，**无账本 / 身份访问**。
- **绝不返回他人身份 / 私人账本 / 可反指认信息**——`signature` 全程无任何 `*_id`/title/余额绝对值，叠加 k-匿名双重护栏 + 授权门槛。

## 去身份保证（L4 验收）

- `JSON.stringify(encodeTrajectory(db))` 幂等、无 `undefined`。
- 不含 `*_id` / `title` / `goal_id` / `plan_id`（正则全量扫）——测试断言应有覆盖。
- 事件类型仅枚举符号 `g/p/o/v` + 数字载荷。
