# MCP Agent Surface — Personal ERP

> AI agent 驱动 L1→L4 管线的 MCP 工具面。单用户离线（Vite + Capacitor），localStorage 持久化。所有工具只读、无副作用、幂等。
> 数据形状契约（字段级）：[report-v2](./report-v2.md)、[feature-set](./feature-set.md)、[recommendation](./recommendation.md)、[trajectory-signature](./trajectory-signature.md)。

---

## 1. 工具结果信封

每个工具**必须**返回以下 JSON 信封，**永不抛异常**：

```ts
type Envelope = {
  ok: boolean
  tool: string          // 精确工具名，如 "report.weekly"
  version: "1.0"
  data?: unknown        // ok=true 时存在
  error?: {             // ok=false 时存在
    code: ErrorCode
    message: string     // 人类可读，agent 可展示
  }
  warnings?: string[]   // 非致命提示，≤5 条，每条 ≤200 字符
}
```

### 错误码

| code | 含义 | 典型触发 |
|------|------|---------|
| `ERR_VALIDATION` | 输入校验失败 | 缺必填、类型错、offset > 0 |
| `ERR_NO_DATA` | 空库 + 需有数据才有意义的工具 | （report 工具不触发此码，空库仍出报告） |
| `ERR_AUTH_DENIED` | 未授权调用授权功能 | `community.*` 未通过授权门 |
| `ERR_INTERNAL` | 适配层兜底 | 纯函数不应触发 |

**不变量**：`JSON.stringify(result)` 稳定无 `undefined`；`ok=true` ⇒ `data` 存在；`ok=false` ⇒ `error` 存在且 `code` 枚举受限。

---

## 2. 存储接缝

```ts
type Ctx = {
  loadDb: () => object       // normalizeDB 后的 db 快照
  loadPrefs: () => object    // Prefs.load() 结果
}
```

**浏览器默认**：

```js
import { loadDB } from '../store/db.js'
import { Prefs } from '../store/prefs.js'
export const browserCtx = {
  loadDb: () => loadDB(),
  loadPrefs: () => Prefs.load(),
}
```

**Node 测试**：注入内存 fake loader，不 import 浏览器模块。`ctx.loadDb()` 在每次工具调用时按需执行（lazy），不缓存。适配层只做 `ctx → 纯函数 → Envelope` 编排，不含业务逻辑。

---

## 3. 工具 I/O 契约

### 3.1 `report.weekly`

| 参数 | 类型 | 默认 | 校验 |
|------|------|------|------|
| `offset` | int | `0` | ≤0 整数 |
| `now` | ISO 8601 string | 当前时间 | 合法日期 |

内部：`buildReport(ctx.loadDb(), { period:'week', offset, now }) → stripIdentity()`

输出 data：[report-v2](./report-v2.md) 去身份 JSON（`period/offset/start/end/label/activity/ledger/plan/balance/vf/actDetail/timeBias/valueYield/schedHealth/budgetTrend/meta`）。

空库 → `ok:true` + `warnings:["数据为空"]`（不报 `ERR_NO_DATA`，报告层设计空库出报告）。

### 3.2 `report.monthly`

同 `report.weekly`，`period='month'`。

### 3.3 `learn.features`

| 参数 | 类型 | 默认 | 校验 |
|------|------|------|------|
| `weeks` | int | `8` | 1~52 |

内部：`extractFeatures(ctx.loadDb()) → stripFeatureIdentity()`

输出 data：[feature-set](./feature-set.md) 去身份 JSON（`biasRate/completion/yield/sched/budget`）。

> `weeks` 预留为未来窗口裁剪接口；当前版本对全量历史提取，传入不报错。

### 3.4 `recommend.next`

| 参数 | 类型 | 默认 | 校验 |
|------|------|------|------|
| `limit` | int | `5` | 1~20 |
| `k` | int | `2` | 保底浮现数，0~10 |
| `now` | ISO 8601 string | 当前时间 | 合法日期 |

内部两步：
1. `feats = stripFeatureIdentity(extractFeatures(ctx.loadDb()))`
2. 从 db 提取 Planned/InProgress 活动 → 映射为候选 → `recommendNext(candidates, feats, { now, limit, k })`

**候选映射**（适配层）：

| 候选字段 | db 来源 |
|---------|--------|
| `activityId` | `a.id` |
| `planId` | `a.plan_ids[0]` |
| `plannedStart` | `a.planned_start` |
| `deadline` | 关联 plan 的 deadline |
| `plannedMinutes` | `a.planned_minutes` |
| `n` | `feats.biasModel` 中该 planId 的 `n` |
| `conflictsCount` | `a.conflicts.length` |

输出 data：[recommendation](./recommendation.md) JSON 数组，每项含 `activityId/score/reasons/estMinutes/n/guaranteed`。无待办 → `data: []`。

### 3.5 `recommend.slot`

| 参数 | 类型 | 必填 | 默认 | 校验 |
|------|------|:----:|------|------|
| `freeMinutes` | int | **是** | — | >0, ≤1440 |
| `freeFrom` | ISO 8601 string | 否 | 当前时间 | 合法日期 |
| `limit` | int | 否 | `5` | 1~20 |

内部：
1. 全量评分 → `recommendNext(candidates, feats, { limit: 99 })`
2. 构建单一时段 `[{ start: freeFromMs, end: freeFromMs + freeMinutes*60000 }]`
3. `slotIntoFreeTime(slots, scored, { now })`

输出 data：`{ activityId, slotStart(ms), score }[]`（按时段升序）。

### 3.6 `community.matchPatterns`（授权门控）

| 参数 | 类型 | 默认 | 校验 |
|------|------|------|------|
| `k` | int | `5` | k-匿名阈值，2~50 |

内部：
1. 授权门检查（见 §4）
2. `localSig = encodeTrajectory(ctx.loadDb())`
3. `spectrum = ctx.loadAnonSpectrum?.() ?? []`
4. 谱线附加 `similarity(localSig, sig)` → `kAnonymitySuppress(profiles, k)`
5. 返回相似的模式级统计

**签名谱注入**：

```ts
type CommunityCtx = Ctx & {
  loadAnonSpectrum?: () => { sig: Signature, groupKey?: string }[]
}
```

- 浏览器默认：`loadAnonSpectrum` 未实现 → 返回空谱 + `warnings`。
- 谱数据**必须**已过 `kAnonymitySuppress` 处理；工具内再做一次是双重护栏。

输出 data：

```ts
type PatternList = {
  patterns: {
    similarity: number         // 0~1
    eventSequence: string      // 事件类型序列，如 "gpovgp"
    groupKey: string
    sampleCount: int
  }[]
  localSignature: {
    v: number
    len: number
    counts: { g, p, o, v }    // 各类型计数
    eventSequence: string
  }
  groupProposal?: {
    candidatePatterns: number
    threshold: number
    consentRequired: true      // 永远为 true
  }
  suppressed: number           // k-匿名抑制数
}
```

---

## 4. 授权门

`community.*` 工具受授权保护。判定：

```
auth = ctx.loadPrefs().communityAuth   // boolean，默认 false
```

- `auth === true` → 放行。
- 否则 → 立即返回：

```json
{
  "ok": false, "tool": "community.matchPatterns", "version": "1.0",
  "error": { "code": "ERR_AUTH_DENIED",
             "message": "社区匹配功能需要授权。请在设置中开启「社区参与」选项后重试。" }
}
```

**组群 consent 机制**：`groupProposal` 中 `consentRequired` **永远为 `true`**。工具**绝不**自动创建群/广播/加入。组群需要**单独写入工具**（不在本只读工具面内）+ 显式 `groupConsent: true`（默认 false）。提议仅返回候选模式数量，由上层 UI 决定展示。

---

## 5. 幂等性与安全

| 性质 | 保证 |
|------|------|
| 只读 | 不写 localStorage、不修改 db |
| 幂等 | 相同输入 → 相同 JSON |
| 无 undefined | `JSON.stringify` 稳定 |
| 无身份泄漏 | report/learn 经 `stripIdentity`/`stripFeatureIdentity`；community 经 k-匿名 |
| 错误不抛出 | 全部 `ok:false` + 稳定 code |
| 去身份不可绕过 | 适配层无 `keepIdentity:true` 暴露给调用方 |

---

## 6. 示例调用流

### 6a. Agent 打开周报

```jsonc
// Request
{ "tool": "report.weekly", "params": {} }

// Response
{
  "ok": true, "tool": "report.weekly", "version": "1.0",
  "data": {
    "period": "week", "offset": 0, "start": 1756329600000, "end": 1756934400000,
    "label": "8月27日 ~ 9月2日",
    "activity": { "completed": 12, "started": 5, "failed": 1, "created": 3,
                  "daily": { "2026-8-28": 4, "2026-8-29": 3 } },
    "ledger": { "incomeTotal": 450, "expenseTotal": 200, "revCount": 2, "n": 18,
                "rows": [{ "unit": "价值元", "debit": 450, "credit": 200, "net": 250, "n": 18 }] },
    "plan": [{ "spend": 150, "budget": 500 }],
    "balance": [{ "unit": "价值元", "net": 250 }],
    "vf": { "created": 8, "pending": 3, "closed": 5 }
  }
}
```

### 6b. Agent 请求推荐（含保底浮现）

```jsonc
{ "tool": "recommend.next", "params": { "limit": 3, "k": 1 } }

{
  "ok": true, "tool": "recommend.next", "version": "1.0",
  "data": [
    { "activityId": "a17", "score": 78.5,
      "reasons": ["截止紧迫(2天)", "完成率高(0.83)", "新任务（探索机会）"],
      "estMinutes": 45, "n": 0, "guaranteed": true },
    { "activityId": "a23", "score": 71.2,
      "reasons": ["价值产出密度高", "少试(1)，给予探索"],
      "estMinutes": 30, "n": 1, "guaranteed": false },
    { "activityId": "a09", "score": 65.0,
      "reasons": ["完成率高(0.91)", "预计投入≈60min(biasK 1.2)"],
      "estMinutes": 60, "n": 8, "guaranteed": false }
  ]
}
```

### 6c. 未授权 → 授权后匹配

```jsonc
// 未授权调用
{ "tool": "community.matchPatterns", "params": {} }
→ { "ok": false, "error": { "code": "ERR_AUTH_DENIED", "message": "社区匹配功能需要授权…" } }

// 用户开启授权后
{ "tool": "community.matchPatterns", "params": { "k": 5 } }
{
  "ok": true, "tool": "community.matchPatterns", "version": "1.0",
  "data": {
    "patterns": [
      { "similarity": 0.87, "eventSequence": "gpovgpov", "groupKey": "[\"g\",\"p\",\"o\",\"v\"]", "sampleCount": 12 },
      { "similarity": 0.72, "eventSequence": "gpgpov", "groupKey": "[\"g\",\"p\"]", "sampleCount": 8 }
    ],
    "localSignature": { "v": 1, "len": 24, "counts": { "g": 8, "p": 6, "o": 5, "v": 5 },
                        "eventSequence": "gpovgpovgpgpov" },
    "groupProposal": { "candidatePatterns": 2, "threshold": 2, "consentRequired": true },
    "suppressed": 3
  },
  "warnings": ["3 个模式因 k-匿名阈值不足被抑制"]
}
```

---

## 7. 纯函数索引

| 工具 | 纯函数 | 模块 |
|------|-------|------|
| `report.weekly/monthly` | `buildReport()` → `stripIdentity()` | `src/domain/report.js` |
| `learn.features` | `extractFeatures()` → `stripFeatureIdentity()` | `src/domain/learn.js` |
| `recommend.next` | `extractFeatures()` + `stripFeatureIdentity()` + `recommendNext()` | `src/domain/learn.js` + `recommend.js` |
| `recommend.slot` | 同上 + `slotIntoFreeTime()` | 同上 |
| `community.matchPatterns` | `encodeTrajectory()` + `similarity()` + `kAnonymitySuppress()` | `src/domain/signature.js` |
