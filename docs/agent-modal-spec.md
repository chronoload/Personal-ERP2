# 应用内原生 Agent · 系统规格（v0.1 草案）

> 状态：待共识。本文只描述「做成什么样」，不写实现步骤。
> 目标代码线：`personal-erp-ui-projection`（本地主维护线）。

---

## 1. 一句话定义

在 Personal ERP 内部跑一个**只以模态存在**的 Agent：不新增页面、不占版面，入口是顶栏右侧一个小圆钮；点开即对话，工具调用与审批都在模态里发生，关掉模态任务仍在后台继续，需要你决策时自己弹出来。

## 2. 目标与非目标

**目标**

1. Agent 能读写本应用的数据（目标 / 计划 / 活动 / 流水 / 日记），走与 MCP 完全相同的工具层（`mcp/tools.mjs`）。
2. 纯模态交互：对话、工具执行过程、审批、结果回看全部是浮层。
3. 用户不主动打开时，界面上除了一个小按钮没有任何 Agent 痕迹。
4. 所有写操作都可预期、可中断、可撤销。
5. 对话可回看，关掉再打开能接上。

**非目标（v1 不做）**

- 独立 Agent 页面 / 侧边常驻面板 / 多会话并行。
- 语音输入输出、图片理解、多模态。
- 自定义提示词市场、Agent 人格配置。
- 修改历史数据（工具层本身只支持追加，Agent 也不越权）。
- 云端同步对话记录。

## 3. 体验原则

| 原则 | 落地 |
|---|---|
| 无感 | 未打开时只有一个 28px 圆钮；无角标、无自动弹出（除审批） |
| 模态唯一 | 不新增 Tab、不占内容区；对话结束即消失 |
| 永不打断写字 | 日记/编辑器聚焦时，审批模态延后到失焦或退出全屏再弹 |
| 一切可回退 | 写操作先预览、再倒计时执行、30 分钟内可撤销 |
| 状态透明 | 每次工具调用都在对话流里留一条可展开的记录（参数/结果/耗时） |

## 4. 入口与浮层结构

### 4.1 入口

- 位置：顶栏右侧动作区，`⚡ 创建 / ☰ / ⏱` 之前或之后的一个圆钮 `✦`（最终位置实现时按视觉平衡定，规格只要求「顶栏右侧动作区」）。
- 紧凑顶栏（compact）与侧边 dock 模式下同样存在。
- 未配置模型：按钮仍显示，点开是配置引导模态（baseUrl / API Key / 模型名 / 测试连接）。
- 设置里提供「隐藏 Agent 入口」开关（默认关），隐藏后仅能通过设置页打开。

### 4.2 浮层容器（关键约束）

现有 `openModal()` 是**单模态**：每次调用都会覆盖 `#modal-root`，第二个模态会顶掉第一个（待排程面板踩过这个坑）。Agent 需要「对话模态 + 审批模态 + 结果卡」并存，因此：

- 新增独立浮层根 `#agent-root`（与 `#modal-root` 平级，z-index 高于普通模态）。
- Agent 内部的模态自己管理栈与返回，不复用 `#modal-root` 的覆盖语义。
- 审批层永远在最上；关闭审批回到对话，对话状态不丢。

### 4.3 三种浮层

| 浮层 | 触发 | 关闭后 |
|---|---|---|
| 对话主模态 | 点 `✦` | 任务继续在后台跑 |
| 审批模态 | 写工具即将执行 | 视为拒绝（超时同拒绝），任务继续或收敛 |
| 结果/回看卡 | 任务结束、或从历史里点开 | 无副作用 |

对话主模态结构：
```
┌ Agent ─────────────────────── ✕ ┐
│ 状态条：思考中 / 调用 erp.add_activity / 等待审批 / 完成
│ ── 消息流（可滚动）────────────── │
│   user: …
│   assistant: …（含工具调用折叠块）
│   tool: erp.activities → 12 条（点击展开）
│   审批记录：已允许（可撤销）
│ ── 输入区 ─────────────────── │
│ [多行输入]              [发送]  │
│ 快捷：今天该做什么 / 记一笔 / 周复盘 │
└───────────────────────────────┘
```

## 5. 状态模型（LangDriven）

对象即实体，消息即状态转移；以下均落 `db.agent`。

```
AgentSession  { id, title, status, createdAt, updatedAt, model, turns, lastError }
  status ∈ idle | thinking | calling_tool | awaiting_approval | done | failed | cancelled

AgentMessage  { id, sessionId, role, content, createdAt, toolCallId? }
  role ∈ user | assistant | tool | system

ToolCall      { id, sessionId, messageId, name, args, status, result?, startedAt, finishedAt }
  status ∈ proposed | running | ok | error | rejected

Approval      { id, toolCallId, risk, preview, createdAt, expiresAt, decision }
  decision ∈ pending | allowed | rejected | expired | auto

UndoRecord    { id, toolCallId, sessionId, snapshotRef, createdAt, expiresAt, undone }
```

状态机（会话级）：
```
idle → thinking → calling_tool → thinking … → done
                        ↓
               awaiting_approval →（允许）calling_tool
                                 →（拒绝/超时）thinking（把拒绝结果回灌给模型）
任意状态 → cancelled（用户中止） / failed（网络或模型错误）
```

**关键不变量**

1. 同一会话同一时刻最多一个 `calling_tool`。
2. `awaiting_approval` 时禁止继续请求模型。
3. 任何写工具的 `ToolCall` 必须有对应 `Approval`（`auto` 也算一条）。
4. `UndoRecord` 过期后不可再撤销，UI 必须隐藏入口。

## 6. 模型接入

- 协议：OpenAI 兼容 `POST {baseUrl}/chat/completions`，支持 `tools`（function calling）与 `tool_choice: auto`。
- 配置项（设置页「Agent」卡片）：`baseUrl`、`apiKey`、`model`、`temperature`（默认 0.3）、`maxTurns`（默认 8）。
- 传输：Capacitor `CapacitorHttp`（原生请求，绕开 WebView CORS）；Tauri 桌面走普通 `fetch`。
- 非流式（v1）：一次请求拿完整回复；等待期间状态条显示「思考中」并有中止按钮。流式（SSE）列入 v1.1。
- 密钥：存在 `Prefs`（localStorage/SharedPreferences 明文）。**风险已知**：root 设备或备份可读。v1 接受，设置页明示；后续可换原生加密存储。
- 失败处理：超时 60s、2 次重试、仍失败则 `failed` 并在对话里给出可读原因（不回滚已完成的工具调用）。

## 7. Agent 循环

1. 组装 messages：system 提示 + 最近 N 轮（默认 12 条，超出按摘要裁剪）+ 历史工具结果摘要。
2. 请求模型 → 若返回 `tool_calls`：
   - 只读工具：直接执行，结果入消息流，继续循环。
   - 写工具：生成审批 → 执行/拒绝 → 结果入消息流，继续循环。
3. 无工具调用：把 assistant 文本作为最终回答，`done`。
4. 达到 `maxTurns`：停止并提示「本轮到此为止，可以继续说」。
5. 用户点「停止」：中止当前请求与后续循环，已完成的操作保留（可撤销）。

工具白名单直接映射 `mcp/tools.mjs` 的 10 个工具：`erp.status / goals / activities / transactions / journal / add_goal / add_plan / add_activity / add_tx / append_journal`。

### 7.1 数据接缝（进程内直调）

- 新增 `src/services/agentTools.js`：把 `App.db` 包成 `mcp/tools.mjs` 需要的 `ctx`：
  - `read()` 返回内存库（用 Proxy 把 `mcp.enabled` 视为 true —— 该开关只约束**外部**访问，不约束用户主动发起的应用内 Agent）。
  - `append(db)` = `saveDB(App.db)` + `App.refresh()` + 生成撤销快照。
- 不走 6920 端口、不依赖「外部访问」开关、不经过文件落盘，写完立即反映到界面。

## 8. 工具执行与审批

### 8.1 分级

| 级别 | 工具 | 行为 |
|---|---|---|
| 读 | status / goals / activities / transactions / journal | 自动执行，不打扰 |
| 写 | add_goal / add_plan / add_activity / add_tx / append_journal | 必须审批 |

### 8.2 审批模态

- 标题：`将要执行：新增活动`。
- 内容：结构化预览（不是原始 JSON）——活动名、时间、时长、所属计划；流水则显示资源、方向、金额。
- 倒计时：**5 秒**，环形倒计时，结束后按「允许」处理并记录 `decision=auto`。
- 按钮：`允许` / `拒绝` / `本会话内不再询问这类操作`（仅当前会话有效，不写全局）。
- 关闭 / 返回键 / 超时 = 拒绝；拒绝原因以 `tool` 消息回灌模型，让它换个做法。
- 同一轮出现多个写调用：排队，逐个审批；可「允许剩余全部」。

### 8.3 撤销（30 分钟）

- 每次写操作执行前拍快照：`{ txsLength, activitiesLength, goalsLength, plansLength, journalMd, seq }`，足够做**精确回退**（因为工具只追加）。
- 执行后在对话里出现「已执行 · 撤销（剩余 29:58）」；顶部 toast 同步给一次入口。
- 撤销 = 按快照裁剪新增实体与流水，并恢复 `seq`；撤销本身也生成一条 `ToolCall` 记录（`name: undo`）。
- 快照存 `localStorage`（`agent_undo_v1`，最多 20 条，30 分钟过期清理），App 重启后仍可撤销。

## 9. 后台运行与通知

- 关闭对话模态不改变会话状态；`thinking / calling_tool` 继续。
- 需要审批时：自动弹出审批模态（若当前在日记全屏或有输入焦点，延后到失焦）；同时发一条系统通知「Agent 需要你确认」。
- 任务结束：系统通知「Agent 已完成」；若 App 在前台，则弹结果卡。
- 用户点通知 → 打开 App → 直接展示对话模态并定位到该会话。
- 网络中断：任务转 `failed`，保留上下文，可手动「重试」。

## 10. 持久化与回看

```js
db.agent = {
  sessions: [AgentSession],      // 最多保留 30 个，超出删最旧
  messages: [AgentMessage],      // 每会话最多 200 条
  toolCalls: [ToolCall],         // 每会话最多 200 条
  approvals: [Approval],         // 每会话最多 100 条
}
```

- 回看入口：设置页「Agent 历史」→ 列表（标题 / 时间 / 状态）→ 点开只读结果卡；可「继续这个会话」。
- 体积控制：超限时先丢最旧会话的 tool 详情，保留消息正文；摘要写入 `AgentSession.summary`（一句话）。
- 备份：随 `db` 一起导出（用户已知晓对话会进备份）。

## 11. 错误与降级

| 场景 | 表现 |
|---|---|
| 未配置模型 | 点 `✦` 直接进配置引导，不显示输入框 |
| key 失效 / 401 | 对话里红条：`鉴权失败，去设置检查`，可一键跳设置 |
| 网络超时 | 可重试，不重复执行已完成的工具调用 |
| 模型返回未知工具 | 记 `error` 并把可用工具名回灌，最多纠正 2 次 |
| 工具拒绝（领域校验失败） | 显示引擎原文错误，回灌模型 |
| 循环失控 | 达到 `maxTurns` 或连续 3 次相同工具调用 → 强制停止 |

## 12. 验收标准

1. 未配置模型时，除顶栏一个小钮外，界面无任何 Agent 元素；点开进入配置引导。
2. 配置后可完成一轮真实对话，读工具调用不弹任何确认。
3. 写工具调用弹出审批，5 秒倒计时；点拒绝后模型收到拒绝并继续；点允许后数据立即出现在对应页面。
4. 关闭对话模态后继续跑，完成时收到通知；点通知能回到该会话。
5. 写操作 30 分钟内可撤销，撤销后活动/流水/余额恢复原状，过期后撤销入口消失。
6. 审批模态出现时不会顶掉对话模态，关闭审批后对话内容与滚动位置不变。
7. 日记全屏编辑时审批不抢焦点（延后到退出全屏）。
8. App 杀掉重开后，历史会话可见，未过期的撤销仍可用。

## 13. 里程碑

| 阶段 | 内容 | 可验证产出 |
|---|---|---|
| M1 | `#agent-root` 浮层栈 + 顶栏入口 + 对话骨架（假数据） | 模态可开合、审批可叠层 |
| M2 | 工具接缝 `agentTools.js` + 5 个写工具审批 + 预览 | 真实写库、拒绝路径可用 |
| M3 | 模型接入（OpenAI 兼容）+ 循环 + 错误处理 | 端到端真实对话 |
| M4 | 撤销 30 分钟 + 后台继续 + 通知 + 历史回看 | 全量验收清单通过 |

## 14. 待确认（实现前需要拍板）

1. **模型默认值**：默认 `baseUrl` 填哪个（DeepSeek `https://api.deepseek.com/v1` / 空 / 用户自填）？默认 model 名？
2. **审批倒计时时长**：5 秒是否合适，还是 8 秒更从容？
3. **「本会话不再询问」**：按工具粒度记住，还是所有写操作统一记住？
4. **历史保留量**：30 个会话 / 每会话 200 条是否可接受（会进备份、增大库体积）？
5. **入口图标**：`✦` 是否可用，还是用 `AI` 两个字/其他符号？
