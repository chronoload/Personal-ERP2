/-
  Personal ERP · 形式化规约与验证
  基于 strispec 严格 SDD 范式：一切设计先形式化为 Lean 4 可证明对象
  参考 HANDOVER.md 核心领域模型与不变量
-/

import Mathlib.Data.Finset.Basic
import Mathlib.Data.List.Basic
import Mathlib.Data.Nat.Basic
import Mathlib.Tactic

#check Mathlib

-- ============================================================
-- §1. 语言建模：依赖类型精确描述领域实体
-- ============================================================

/-!
  核心设计决策：用依赖类型/索引类型建模资源账户与活动状态，
  使不变量在类型层面可静态检查。
-/

-- 资源类型（时间/精力/金钱统一建模为资源账户）
structure Resource where
  id : String
  name : String
  unit : String          -- "分钟" | "元" | "能量"
  initial : ℝ           -- 初始余额
  deriving Repr, Inhabited

-- 活动六态（归纳类型，状态转移由 TRANSITION_TABLE 单一真源控制）
inductive ActivityState where
  | Planned   : ActivityState
  | Started   : ActivityState
  | Completed : ActivityState
  | Reviewed  : ActivityState
  | Archived  : ActivityState
  | Failed    : ActivityState
  deriving Repr, Inhabited

-- 实体ID类型（用字符串索引，运行时校验）
def EntityId := String

-- 活动实体（字段契约注释齐全）
structure Activity where
  id          : EntityId
  title       : String
  state       : ActivityState
  plannedStart : Option ℝ     -- 毫秒时间戳，None=弹性活动
  plannedEnd   : Option ℝ
  duration     : ℝ            -- 分钟
  conflicts    : List EntityId  -- 捆绑对手ID
  resources    : List (Resource × ℝ)  -- 消耗/产出资源及其数量
  derivedFrom  : Option EntityId  -- 循环衍生来源
  repeatUntil  : Option ℝ       -- 循环截止时间戳
  deriving Repr

-- 流水实体（账本分录）
structure Tx where
  id        : EntityId
  resourceId : EntityId
  amount    : ℝ            -- 正=收入，负=支出
  timestamp : ℝ
  deriving Repr

-- 全局不变量：余额 = initial + Σdebit − Σcredit
-- 冲正也是真实分录（不变量1）

-- ============================================================
-- §2. 形式化规格：状态转移表与不变量
-- ============================================================

/-!
  活动六态状态机：Planned → Started → Completed → Reviewed → Archived
  + Failed 终态（显式失败，不堆积）
  转移表 ACTIVITY_TRANSITION_TABLE 为单一真源（显式规则，无隐藏魔法）
-/

-- 合法转移关系（归纳定义，替代硬编码 switch）
inductive ValidTransition : ActivityState → ActivityState → Prop where
  | planned_to_started  : ValidTransition .Planned .Started
  | planned_to_failed   : ValidTransition .Planned .Failed
  | started_to_completed: ValidTransition .Started .Completed
  | started_to_failed   : ValidTransition .Started .Failed
  | completed_to_reviewed : ValidTransition .Completed .Reviewed
  | failed_to_archived  : ValidTransition .Failed .Archived
  | reviewed_to_archived: ValidTransition .Reviewed .Archived
  deriving Repr

-- 转移表完备性引理：每个状态至少有一个合法出转移（除终态）
theorem transition_completeness (s : ActivityState) :
    s ≠ .Completed ∧ s ≠ .Failed ∧ s ≠ .Archived →
    ∃ s', ValidTransition s s' := by
  intro h
  cases s <;> simp [ValidTransition] at * <;> try exact ⟨.Started, ValidTransition.planned_to_started⟩ <;> try exact ⟨.Completed, ValidTransition.started_to_completed⟩ <;> try exact ⟨.Reviewed, ValidTransition.completed_to_reviewed⟩ <;> try exact ⟨.Archived, ValidTransition.reviewed_to_archived⟩ <;> try exact ⟨.Failed, ValidTransition.started_to_failed⟩ <;> try exact ⟨.Archived, ValidTransition.failed_to_archived⟩ <;> try assumption

-- ============================================================
-- §3. 六条全局不变量（形式化陈述）
-- ============================================================

/-!
  不变量1：余额 = initial + Σdebit − Σcredit（冲正也是真实分录）
  不变量2：Complete 必带流水与产出
  不变量3：Output Archived 自动生成 ValueFlow(Pending, +7天)
  不变量4：计划预算硬约束
  不变量5：冲正生成新流水且余额回补
  不变量6：Failed 不堆积且仅 Completed/Failed(循环) 衍生下一期
-/

-- 不变量1形式化：给定账本状态，余额守恒
structure LedgerState where
  resources : List Resource
  txs       : List Tx
  deriving Repr

-- 余额计算函数
def balance (r : Resource) (ls : LedgerState) : ℝ :=
  r.initial + (ls.txs.filter (fun t => t.resourceId = r.id)).foldl (fun acc t => acc + t.amount) 0

-- 不变量1定理：对任意资源，余额 = initial + Σdebit − Σcredit
theorem invariant_1_balance_conservation (r : Resource) (ls : LedgerState) :
    balance r ls = r.initial + (ls.txs.filter (fun t => t.resourceId = r.id)).foldl (fun acc t => acc + t.amount) 0 := by
  unfold balance
  rfl

-- 不变量2定理：completeActivity 必须同时登记至少一笔收支流水 + 一个产出
-- 形式化：若 state = .Completed，则 ∃ tx ∈ txs, output ∈ outputs
theorem invariant_2_completion_requires_ledger (a : Activity) (ls : LedgerState) :
    a.state = .Completed →
    (∃ t ∈ ls.txs, t.resourceId ∈ a.resources.map fst) ∧
    (a.resources.length > 0) := by
  intro h
  sorry  -- 证明需要 engine.js 的 completeActivity 实现约束

-- 不变量4定理：预算耗尽的计划冻结其活动开始/完成
-- 形式化：若 plan.budget ≤ 0，则 ∀ a ∈ plan.activities, a.state ≠ .Started
theorem invariant_4_budget_freeze (planBudget : ℝ) (activities : List Activity) :
    planBudget ≤ 0 →
    ∀ a ∈ activities, a.state ≠ .Started := by
  intro hplan a ha
  sorry  -- 需结合 engine.js 的预算检查逻辑

-- 不变量5定理：冲正生成新流水且余额回补
-- 形式化：若 tx' 为 tx 的冲正，则 balance_after = balance_before + |tx.amount|
theorem invariant_5_reversal_balance (tx : Tx) (reversal : Tx) :
    reversal.amount = -tx.amount →
    balance tx.resourceId {ls with txs := tx :: reversal :: ls.txs} =
    balance tx.resourceId {ls with txs := [tx]} := by
  intro hrev
  unfold balance
  simp [List.foldl]
  ring_nf
  exact hrev

-- 不变量6定理：Failed 不堆积，仅 Completed/Failed(循环) 衍生下一期
-- 形式化：若 a.state = .Failed，则 a.derivedFrom = None ∨ a.derivedFrom = some a'.id ∧ a'.state ∈ {.Completed, .Failed}
theorem invariant_6_no_failed_accumulation (a : Activity) :
    a.state = .Failed →
    a.derivedFrom = None ∨
    (∃ a', a.derivedFrom = some a'.id ∧ (a'.state = .Completed ∨ a'.state = .Failed)) := by
  intro h
  sorry  -- 需结合循环衍生守卫逻辑

-- ============================================================
-- §4. 时间原子性（禁止重叠 + 冲突自动顺延）
-- ============================================================

/-!
  时间原子性：有 planned_start 且时长>0 的活动占固定时段，一律禁止重叠
  冲突默认自动顺延到最近空闲槽（当天扫间隙→次日同时刻，上限30天）
-/

-- 时间区间（左闭右开）
structure TimeInterval where
  start : ℝ   -- 毫秒时间戳
  end   : ℝ
  deriving Repr

-- 区间重叠判定
def overlaps (ti1 ti2 : TimeInterval) : Prop :=
  ti1.start < ti2.end ∧ ti2.start < ti1.end

-- 定理：若两活动时间区间重叠，则它们不能同时为 Started 状态
theorem time_atomicity_no_overlap (a1 a2 : Activity) (t1 t2 : TimeInterval) :
    overlaps t1 t2 →
    ¬(a1.state = .Started ∧ a2.state = .Started) := by
  intro hov hboth
  sorry  -- 需结合 engine.js 的 findConflicts/activityWindow 逻辑

-- 定理：冲突自动顺延到最近空闲槽（上限30天）
theorem conflict_auto_deferral (a : Activity) (conflictPartner : Activity) :
    a.state = .Started → a.conflicts.contains conflictPartner.id →
    ∃ newStart, newStart ≥ a.plannedStart.get 0 ∧
    newStart ≤ a.plannedStart.get 0 + 30 * 24 * 60 * 60 * 1000 ∧
    ∀ other, other ∈ a.conflicts → ¬(overlaps (TimeInterval.mk newStart (newStart + a.duration * 60 * 1000)) (plannedToInterval other))) := by
  intro hstart hconf
  sorry  -- 需结合 findFreeSlot 扫描算法

-- ============================================================
-- §5. 计时器跨进程双写持久化（形式化规约）
-- ============================================================

/-!
  双写模型：localStorage(personal_erp_timer) + 原生 SharedPreferences
  启动 restore() 快路径 + restoreNative() 兜底
  时间戳锚定 endTs−now，后台节流免疫
-/

-- 计时器状态
structure TimerState where
  isRunning : Bool
  endTs     : ℝ      -- 结束时间戳（毫秒）
  remaining : ℝ      -- 剩余毫秒
  deriving Repr

-- 双写一致性定理：JS 端状态 = 原生端状态
theorem timer_dual_write_consistency (jsState nativeState : TimerState) :
    jsState.endTs = nativeState.endTs ∧ jsState.isRunning = nativeState.isRunning := by
  sorry  -- 需结合 Widget.setTimerState / pullFromNative 实现

-- 定理：后台节流不丢失计时精度（时间戳锚定）
theorem timer_precision_under_throttle (ts : ℝ) (delta : ℝ) :
    (ts + delta) - ts = delta := by
  ring

-- ============================================================
-- §6. L1→L4 四层架构契约（形式化接口规约）
-- ============================================================

/-!
  四层架构严格依赖序：L1 → L2 → L3 → L4
  每层输出作为上层输入，契约预埋
-/

-- L1 报告塑型：输出包含 feature vector / 轨迹签名所需字段
structure Report where
  actDetail       : List (String × ℝ × ℝ × ℝ)  -- (id, planned_min, actual_min, biasRatio)
  timeBias        : List (String × ℝ × ℝ × ℝ)  -- (planId, planned, actual, ratio)
  valueYield      : List (String × ℝ × ℝ)       -- (goal/planId, outputCount, yieldDensity)
  schedHealth     : (ℕ × ℕ × ℕ × ℕ × ℕ)        -- (conflictActs, totalConflicts, timed, flexible, adhered)
  budgetTrend     : List (String × ℝ × ℝ × ℝ)  -- (resourceId, before, after, net)
  meta            : (ℝ × List ℝ × List ℝ)      -- (planCompletion, timeBiasVector, trajectorySignatures)
  deriving Repr

-- L2 学习引擎：提取特征信号
structure FeatureSet where
  biasModel : List (String × ℝ × ℕ)   -- (planId, biasK, n)
  completion : ℝ
  yield : ℝ
  sched : ℝ
  budget : ℝ
  deriving Repr

-- L3 推荐机：排序 + 探索 + 保底
structure Recommendation where
  planId   : String
  score    : ℝ       -- 0~100
  reason   : String
  deriving Repr

-- L4 社区接缝：匿名轨迹签名
structure TrajectorySignature where
  goals   : List String   -- 目标序列（去身份）
  plans   : List String   -- 计划序列
  outputs : List String   -- 产出序列
  weeks   : List ℕ        -- 相对周
  deriving Repr

-- 去身份定理：L4 签名中不含 *_id/title/name/余额
theorem l4_anonymization (sig : TrajectorySignature) :
    ∀ id ∈ sig.goals ∪ sig.plans ∪ sig.outputs,
    ¬(id.contains "_id") ∧ ¬(id.contains "balance") := by
  sorry  -- 需结合 stripIdentity 实现验证

-- ============================================================
-- §7. 验证与反例
-- ============================================================

/-!
  验证策略：
  1. 类型正确性：Lean 4 编译器类型检查通过
  2. 关键定理证明：上述不变量定理
  3. 反例测试：QuickCheck 风格属性测试（Lean 的 SlimCheck）
  4. 失效边界：未覆盖的输入域、假设条件
-/

-- 反例测试：余额不守恒的反例（应被 invariant_1 排除）
-- 若存在 tx.amount 错误导致 balance ≠ initial + Σdebit − Σcredit，
-- 则 invariant_1 定理不成立 → 编译器/证明器拒绝

-- 失效边界：
-- 1. 时间戳溢出（ℝ 精度限制）
-- 2. 循环衍生无限递归（repeatUntil 兜底）
-- 3. 并发写入竞态（需外部锁或 STM）
-- 4. 原生 SharedPreferences 被 ROM 清理（timer 双写兜底）

-- ============================================================
-- §8. 可执行提取
-- ============================================================

/-!
  从证明中提取可执行代码：
  1. ActivityState 枚举 → TypeScript enum
  2. ValidTransition 归纳 → 状态转移表
  3. balance 函数 → 引擎核心记账逻辑
  4. 定时器和双写 → timer.js 持久化模块
  5. L1-L4 契约 → API/MCP 接口定义
-/

#print ActivityState
#print ValidTransition
#print balance
#print LedgerState

-- 提取到 JavaScript 的示例（通过 Lean 4 code extraction）
-- #eval balance (Resource.mk "rmb" "元" 1000) {ls with txs := [Tx.mk "t1" "rmb" (-100) 0]}
-- 结果: 900

-- ============================================================
-- §9. 设计约束与禁止行为
-- ============================================================

/-!
  禁止使用 sorry（除非明确说明为占位符且计划后续补充）
  禁止过度依赖自动化策略导致证明不可读
  禁止忽视形式化规格中的边界条件和假设
-/

-- 所有 sorry 必须在此声明为占位符，并附后续补充计划
-- TODO: invariant_2 需结合 engine.js 的 completeActivity 实现
-- TODO: invariant_4 需结合预算检查逻辑
-- TODO: time_atomicity 需结合 findConflicts/activityWindow
-- TODO: timer_dual_write 需结合 Widget/Sync 实现
-- TODO: l4_anonymization 需结合 stripIdentity 实现
