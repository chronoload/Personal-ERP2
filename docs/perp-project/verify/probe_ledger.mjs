// 探针：engine.js 台账/价值流域 + importMerge.js bug 猎杀（只读验证，不修改 src/tests）
import { seedDB } from '../../../src/store/db.js';
import * as E from '../../../src/domain/engine.js';
import { mergeImport } from '../../../src/domain/importMerge.js';

function freshDB() {
  const db = seedDB();
  db.resources = [{ id: 'r1', name: 'Token', unit: 'Token', initial: 100, status: 'Active', created: 0 }];
  db.rules = []; db.goals = []; db.plans = []; db.activities = []; db.txs = []; db.outputs = []; db.valueflows = []; db.goods = [];
  db.seq = { r: 1, ru: 0, g: 0, p: 0, a: 0, t: 0, o: 0, v: 0, gd: 0 };
  return db;
}
let passN = 0, bugN = 0, suspectN = 0;
function report(id, name, verdict, detail) {
  // verdict: 'BUG' | 'PASS' | 'SUSPECT'
  if (verdict === 'BUG') { bugN++; console.log(`BUG     ${id} ${name}\n        ${detail}`); }
  else if (verdict === 'SUSPECT') { suspectN++; console.log(`SUSPECT ${id} ${name}\n        ${detail}`); }
  else { passN++; console.log(`PASS    ${id} ${name} => ${detail}`); }
}
const near = (a, b) => Math.abs(a - b) < 1e-9;

// 建一个目标+计划，返回计划 id
function mkPlan(db, budget) {
  E.createGoal(db, { title: 'g' });
  const gid = db.goals[db.goals.length - 1].id;
  E.createPlan(db, { goal_id: gid, title: 'p', budget });
  return db.plans[db.plans.length - 1].id;
}
// 完成一个带支出的活动（走完整状态机），返回其支出流水
function runExpense(db, pid, amount, title) {
  E.createActivity(db, { title, plan_ids: pid ? [pid] : [] });
  const a = db.activities[db.activities.length - 1];
  E.startActivity(db, a.id);
  const r = E.completeActivity(db, a.id, { expense: { resource_id: 'r1', amount }, output_title: title + '产出' });
  if (!r.ok) throw new Error('fixture failed: ' + r.error);
  return db.txs.filter((t) => t.source_type === 'activity' && t.source_id === a.id)[0];
}

console.log('========== L1 浮点精度 / 数值入口边界 ==========');
// L1-1: balanceOf 无任何舍入 → 0.1 类漂移
{
  const db = freshDB();
  runExpense(db, null, 0.1, 'a1');
  runExpense(db, null, 0.2, 'a2');
  const bal = E.balanceOf(db, 'r1');
  report('L1-1', 'balanceOf 小数漂移', near(bal, 99.7) && bal !== 99.7 ? 'BUG' : (bal === 99.7 ? 'PASS' : 'BUG'),
    bal === 99.7 ? '余额精确 99.7'
      : `期望=99.7 实际=${bal}（无舍入，二进制浮点累积误差直接进账本）`);
}
// L1-2: 漂移击穿预算硬约束：恰好花满却未冻结
{
  const db = freshDB();
  const pid = mkPlan(db, 0.8);
  runExpense(db, pid, 0.1, 'a1');
  runExpense(db, pid, 0.7, 'a2'); // 数学上恰好花满 0.8
  const cost = E.planCost(db, pid);
  E.createActivity(db, { title: 'a3', plan_ids: [pid] });
  const a3 = db.activities[db.activities.length - 1];
  const sr = E.startActivity(db, a3.id);
  report('L1-2', '花满预算(0.1+0.7=0.8)后仍可开始新活动',
    (cost >= 0.8 || sr.ok === false) ? (sr.ok === false ? 'PASS' : 'BUG') : 'BUG',
    `planCost实际=${cost}（数学=0.8）, isPlanBlocked=${E.isPlanBlocked(db, pid)}, startActivity.ok=${sr.ok} —— 浮点和 0.799999…<0.8，硬约束漏判`);
}
// L1-3: Infinity 绕过一切「>0」守卫
{
  const db = freshDB();
  const r = E.adjustResource(db, 'r1', { direction: 'debit', amount: '1e999' });
  const bal = E.balanceOf(db, 'r1');
  report('L1-3', 'adjustResource 接受 Infinity 金额',
    r.ok ? 'BUG' : 'PASS',
    r.ok ? `Number('1e999')=Infinity 通过 !(amt>0) 守卫，tx.debit=Infinity，balanceOf=${bal}（账本永久毒化）`
      : '被拒绝');
}
// L1-4: 负数初始余额
{
  const db = freshDB();
  const r = E.createResource(db, { name: '负账户', unit: '', initial: '-50' });
  report('L1-4', 'createResource 接受负初始余额',
    r.ok ? 'SUSPECT' : 'PASS',
    r.ok ? 'Number(\'-50\')||0=-50 入库（其余入账口均要求>0，唯初始余额可为负，疑似口径不一）' : '被拒绝');
}

console.log('========== L2 冲正链 ==========');
// L2-1: 冲正不可再冲正
{
  const db = freshDB();
  E.adjustResource(db, 'r1', { direction: 'credit', amount: 100 });
  const T = db.txs[db.txs.length - 1];
  E.reverseTx(db, T.id, { amount: 30, reason: 'x' });
  const R1 = db.txs[db.txs.length - 1];
  const r2 = E.reverseTx(db, R1.id, { amount: 30, reason: 'y' });
  report('L2-1', '冲正单不可再次冲正', r2.ok ? 'BUG' : 'PASS', r2.ok ? '居然成功' : `拒绝：${r2.error}`);
}
// L2-2: 同一原单可重复部分冲正 → 累计冲正额超原单 → 凭空退款
{
  const db = freshDB();
  E.adjustResource(db, 'r1', { direction: 'credit', amount: 100 }); // T: -100
  const T = db.txs[db.txs.length - 1];
  const r1 = E.reverseTx(db, T.id, { amount: 60, reason: '第一笔冲正' });
  const r2 = E.reverseTx(db, T.id, { amount: 60, reason: '第二笔冲正同一原单' });
  const bal = E.balanceOf(db, 'r1');
  report('L2-2', '累计冲正额(120)超过原单(100)',
    (r1.ok && r2.ok) ? 'BUG' : 'PASS',
    (r1.ok && r2.ok)
      ? `两次均 ok=true；reverseTx 只查 orig.reversal_of（仅防冲冲正），不校验累计冲正额。balanceOf=${bal}，期望=100（净多退 20，凭空创造资金）`
      : `第二次被拒：${r2.error}`);
}
// L2-3: 过度冲正 + planCost 钳位 → 预算门被静默重置
{
  const db = freshDB();
  const pid = mkPlan(db, 50);
  const T = runExpense(db, pid, 50, '大活');
  report('L2-3a', '花满预算后 isPlanBlocked=true', E.isPlanBlocked(db, pid) ? 'PASS' : 'BUG', `blocked=${E.isPlanBlocked(db, pid)}`);
  E.reverseTx(db, T.id, { amount: 50, reason: '合法全额冲正' });
  // NOTE(F2-fix 2026-08-25)：原断言依赖「重复冲正成功」这一已修复缺陷（F2 累计冲正上限）。
  // 修复后第二次冲正被拒，合法全额冲正使消耗归零、预算门重开属正确会计行为——
  // 断言改为：重复冲正被拒 且 planCost 与账面一致（50 原单 − 50 合法冲正 = 0）。
  const rDup = E.reverseTx(db, T.id, { amount: 50, reason: '重复冲正(L2-2缺陷)' });
  const cost = E.planCost(db, pid);
  report('L2-3b', '重复全额冲正被拒(F2)；合法冲正后预算门正确重开',
    (!rDup.ok && near(cost, 0) && !E.isPlanBlocked(db, pid)) ? 'PASS' : 'BUG',
    `第二次冲正 ok=${rDup.ok}(${rDup.error || ''})，planCost=${cost}（期望0），isPlanBlocked=${E.isPlanBlocked(db, pid)}`);
}

console.log('========== L3 不变量②（Complete 必带流水+产出）旁路 ==========');
// L3-1: setActivityStatus 兜底校验
{
  const db = freshDB();
  E.createActivity(db, { title: 'x' });
  const a = db.activities[0];
  E.startActivity(db, a.id);
  const r1 = E.setActivityStatus(db, a.id, 'Completed'); // 无流水无产出
  E.adjustResource(db, 'r1', { direction: 'credit', amount: 5 });
  const T = db.txs[db.txs.length - 1];
  // 手工挂一条活动流水模拟「有流水」
  db.txs.push({ ...T, id: 'tfix', source_type: 'activity', source_id: a.id, reversal_of: null });
  const r2 = E.setActivityStatus(db, a.id, 'Completed'); // 有流水无产出
  report('L3-1', 'setActivityStatus 兜底强制 tx+output',
    (!r1.ok && !r2.ok) ? 'PASS' : 'BUG',
    `无流水:${r1.ok}/${r1.error || ''} 有流水无产出:${r2.ok}/${r2.error || ''}`);
}
// L3-2: importMerge 可注入无流水无产出的 Completed 活动
{
  const db = freshDB();
  mergeImport(db, {
    resources: [],
    rules: [], goals: [], plans: [],
    activities: [{ id: 'xa', title: '幽灵完成', plan_ids: [], status: 'Completed', created: 0 }],
    txs: [], outputs: [], valueflows: [], goods: [],
  });
  const a = db.activities[0];
  const violated = a.status === 'Completed' && !E.activityHasTx(db, 'xa') && !E.activityHasOutput(db, 'xa');
  report('L3-2', '合并导入绕过不变量②（Completed 却无流水无产出）',
    violated ? 'BUG' : 'PASS',
    violated ? 'importMerge 对 activities 仅做字段规范化（plan_ids/time_logs 等），不复验任何全局不变量；合并后库内存在违反宪法②的完成态活动' : '有校验');
}

console.log('========== L4 不变量④执行点完备性 ==========');
// L4-1: 在已耗尽计划上创建活动
{
  const db = freshDB();
  const pid = mkPlan(db, 10);
  runExpense(db, pid, 10, '耗尽者');
  const r = E.createActivity(db, { title: '超预算新建', plan_ids: [pid] });
  report('L4-1', '在耗尽计划上 createActivity', r.ok ? 'SUSPECT' : 'PASS',
    r.ok ? 'ok=true（④仅在 start/complete 把关；新建不拦，任务会堆积成永远无法开始死库存）' : '被拒绝');
}
// L4-2: updateActivity 给活动追加耗尽计划
{
  const db = freshDB();
  const pid = mkPlan(db, 10);
  runExpense(db, pid, 10, '耗尽者');
  E.createActivity(db, { title: '无辜活动', plan_ids: [] });
  const a = db.activities[db.activities.length - 1];
  const r = E.updateActivity(db, a.id, { title: '无辜活动', plan_ids: [pid] });
  report('L4-2', 'updateActivity 追加已耗尽 plan_id', r.ok ? 'SUSPECT' : 'PASS',
    r.ok ? 'ok=true（同 L4-1 口径缺口）' : '被拒绝');
}
// L4-3: 循环任务在耗尽计划上无限繁殖下一期
{
  const db = freshDB();
  const pid = mkPlan(db, 10);
  E.createActivity(db, { title: '日常', plan_ids: [pid], repeat: 'daily' });
  const a = db.activities[0];
  E.startActivity(db, a.id);
  E.completeActivity(db, a.id, { expense: { resource_id: 'r1', amount: 10 }, output_title: 'o' });
  const kids = db.activities.filter((x) => x.id !== a.id && x.plan_ids.includes(pid));
  report('L4-3', '完成后 spawnRecurrence 在耗尽计划上生成下一期',
    (kids.length && E.isPlanBlocked(db, pid)) ? 'SUSPECT' : 'PASS',
    kids.length ? `已生成 ${kids.length} 条 Planned（plan 已 blocked=${E.isPlanBlocked(db, pid)}），循环链持续产死库存` : '未生成');
}

console.log('========== L5 importMerge 对抗性 ==========');
const emptyInc = () => ({ resources: [], rules: [], goals: [], plans: [], activities: [], txs: [], outputs: [], valueflows: [], goods: [] });
// L5-1: incoming 自带重复资源 id（不同名）→ resMap 后写覆盖 → 资金错户
{
  const db = freshDB();
  const inc = emptyInc();
  inc.resources = [
    { id: 'x9', name: '甲账户', unit: '', initial: 0, status: 'Active' },
    { id: 'x9', name: '乙账户', unit: '', initial: 0, status: 'Active' },
  ];
  inc.txs = [{ id: 'xt', resource_id: 'x9', debit: 10, credit: 0, source_type: 'manual', source_id: 'manual', note: '', reversal_of: null, created: 1 }];
  const res = mergeImport(db, inc);
  const jia = db.resources.find((r) => r.name === '甲账户');
  const yi = db.resources.find((r) => r.name === '乙账户');
  const tx = db.txs[0];
  // NOTE(L5-fix 2026-08-25)：批内重复资源 id 改为「首见为准」——乙不再入库（yi=undefined），
  // resMap 稳定不随后写覆盖漂移。断言改为：流水归甲(余额10)、乙未新增、skippedDupRes 计数。
  report('L5-1', 'incoming 内重复资源 id：资金全部错记到后者',
    (jia && !yi && tx.resource_id === jia.id && E.balanceOf(db, jia.id) === 10) ? 'PASS' : 'BUG',
    `批内重复 id 首见为准：流水归甲(${jia ? jia.id : '?'})余额=${jia ? E.balanceOf(db, jia.id) : '?'}，乙${yi ? '仍被新增' : '未入库'}，skippedDupRes=${res.skippedDupRes}`);
}
// L5-2: incoming 内同名双账户 → 合并吞噬为一个
{
  const db = freshDB();
  const inc = emptyInc();
  inc.resources = [
    { id: 'y1', name: '现金', unit: '', initial: 100, status: 'Active' },
    { id: 'y2', name: '现金', unit: '', initial: 200, status: 'Active' },
  ];
  inc.txs = [
    { id: 'xt1', resource_id: 'y1', debit: 0, credit: 20, source_type: 'manual', source_id: 'manual', note: '', reversal_of: null, created: 1 },
    { id: 'xt2', resource_id: 'y2', debit: 30, credit: 0, source_type: 'manual', source_id: 'manual', note: '', reversal_of: null, created: 2 },
  ];
  const res = mergeImport(db, inc);
  const accs = db.resources.filter((r) => r.name === '现金');
  // NOTE(L5-fix 2026-08-25)：同名资源复用（byName 批内更新 → 批内同名即并入同一账户）是文档化策略
  // （importMerge.js 头注「同名资源复用」+ tests/importmerge.test.js 回归用例锁定），销账归并属预期而非缺陷。
  // 断言改为：同名双条目 → 单账户、addedRes=1、reusedRes=1，两条流水统一归入该账户。
  report('L5-2', '同名双账户按文档化策略复用合并为单账户',
    (accs.length === 1 && res.addedRes === 1 && res.reusedRes === 1) ? 'PASS' : 'BUG',
    `addedRes=${res.addedRes}, reusedRes=${res.reusedRes}：同名即复用（文档化销账策略），两条流水统一归入单账户，余额=${accs.length === 1 ? E.balanceOf(db, accs[0].id) : '?'}；批内异名同 id 的错户风险已由 L5-1 首见为准修复`);
}
// L5-3: incoming seq 回退 / 高号资源 → ensureSeq 兜底不产生重复 id
{
  const db = freshDB(); // 本地仅 r1
  const inc = emptyInc();
  inc.resources = [{ id: 'r9', name: '高号账户', unit: '', initial: 0, status: 'Active' }];
  mergeImport(db, inc);
  // 连续新建多个，检查全库 id 唯一（不复用已存在 id）
  E.createResource(db, { name: '新建甲', unit: '', initial: 0 });
  E.createResource(db, { name: '新建乙', unit: '', initial: 0 });
  const ids = db.resources.map((r) => r.id);
  const unique = new Set(ids).size === ids.length;
  report('L5-3', 'seq 回退后新 id 不与现有重复',
    unique ? 'PASS' : 'BUG',
    `ids=[${ids.join(',')}], 全库唯一=${unique}（incoming 原 id 弃用换发新号 + ensureSeq 取 max 修正）`);
}
// L5-4: incoming 冲正单指向本地流水 → 零校验改写本地历史成本
{
  const db = freshDB();
  const pid = mkPlan(db, null);
  const T = runExpense(db, pid, 30, '受害活动');
  const inc = emptyInc();
  inc.txs = [{
    id: 'xz', resource_id: 'r1', debit: 30, credit: 0, source_type: 'reversal',
    source_id: T.id, reversal_of: T.id, note: '伪造冲正', created: 9,
  }];
  mergeImport(db, inc);
  const cost = E.activityCost(db, T.source_id);
  report('L5-4', '外部冲正单无引用完整性校验即可改写本地活动成本',
    cost === 0 ? 'SUSPECT' : 'PASS',
    `mergeImport 不校验 reversal_of/source_id 指向关系（txs 仅做 resource_id 重映射），activityCost 30→${cost}：一份伪造/损坏备份可静默篡改历史核算`);
}
// L5-5: 商品成本经导入绕过 normalizeCosts → 负数/NaN 成本入账
{
  const db = freshDB();
  const inc = emptyInc();
  inc.goods = [
    { id: 'xg1', name: '负价商品', emoji: '💸', costs: [{ resource_id: 'r1', amount: -5 }], status: 'Active', created: 0 },
    { id: 'xg2', name: 'NaN价商品', emoji: '🤷', costs: [{ resource_id: 'r1', amount: 'abc' }], status: 'Active', created: 0 },
  ];
  mergeImport(db, inc);
  const r1 = E.consumeGood(db, 'xg1', { qty: 1 });
  const r2 = E.consumeGood(db, 'xg2', { qty: 1 });
  const bal = E.balanceOf(db, 'r1');
  report('L5-5', '导入商品坏成本 → consumeGood 凭空加钱/毒化账本',
    (r1.ok && bal === 105) || (r2.ok && Number.isNaN(E.balanceOf(db, 'r1'))) ? 'BUG' : 'PASS',
    `consumeGood(-5价)=${r1.ok}，consumeGood(NaN价)=${r2.ok}，余额=${bal}（期望恒 100）。链路：importMerge.normalize.goods 不过滤 amount（对比引擎 normalizeCosts 要求>0），consumeGood:277-285 执行时也不复验 credit=c.amount*n`);
}
// L5-6: 旧格式 valueflow 缺 expected 字段
{
  const db = freshDB();
  const inc = emptyInc();
  inc.valueflows = [{ id: 'xv', output_id: null, giver: '', receiver: '', status: 'Pending', feedback: '', created: 0 }];
  mergeImport(db, inc);
  const v = db.valueflows[0];
  report('L5-6', '旧格式价值流缺 expected：派生与调度双双失效',
    v.expected === undefined ? 'SUSPECT' : 'PASS',
    `expected=${v.expected}：vfStatus 中 undefined<Date.now()=false → 永远 Pending；scheduler.js:35 v.expected<=now 同为 false → 会以 Invalid Date 调度系统通知（normalize.valueflows 未兜底该字段）`);
}

console.log('========== L6 consumeGood 原子性 ==========');
{
  const db = freshDB();
  E.createGood(db, { name: '双耗商品', costs: [{ resource_id: 'r1', amount: 3 }, { resource_id: 'r1', amount: 4 }] });
  const g = db.goods[0];
  const before = db.txs.length;
  const r = E.consumeGood(db, g.id, { qty: 2 });
  const pushed = db.txs.length - before;
  report('L6-1', '多成本消耗整批入账（循环内无失败点）',
    (r.ok && pushed === 2) ? 'PASS' : 'BUG',
    `ok=${r.ok}, 新增流水=${pushed}（正常路径 push 不会中途抛错，半消费态仅可能经 L5-5 坏成本触发）`);
}
{
  const db = freshDB();
  const inc = emptyInc();
  inc.goods = [{ id: 'xg', name: '鬼资源商品', emoji: '👻', costs: [{ resource_id: 'ghost', amount: 3 }], status: 'Active', created: 0 }];
  mergeImport(db, inc);
  const r = E.consumeGood(db, 'xg', { qty: 1 });
  const ghost = db.txs.find((t) => t.resource_id === 'ghost');
  report('L6-2', 'consumeGood 不复验资源存在性（导入旁路）',
    (r.ok && ghost) ? 'SUSPECT' : 'PASS',
    r.ok ? `ok=true，产生孤儿流水 ${ghost.id}→'ghost'（不在任何账户，余额统计不可见但污染 txs）` : '被拒绝');
}

console.log('========== L7 vfStatus 派生一致性 ==========');
{
  const db = freshDB();
  E.createGoal(db, { title: 'g' });
  E.createPlan(db, { goal_id: db.goals[0].id, title: 'p', budget: null });
  E.createActivity(db, { title: 'a', plan_ids: [db.plans[0].id] });
  const a = db.activities[0];
  E.startActivity(db, a.id);
  E.completeActivity(db, a.id, { income: { resource_id: 'r1', amount: 1 }, output_title: 'o' });
  const o = db.outputs[0];
  E.setOutputStatus(db, o.id, 'Published');
  E.setOutputStatus(db, o.id, 'Archived');
  const v = db.valueflows[0];
  const s1 = E.vfStatus(db, v);
  v.expected = Date.now() - 1000; // 时间流逝过期
  const s2 = E.vfStatus(db, v);
  const storedAfterAging = v.status;
  E.closeValueflow(db, v.id, { feedback: 'ok', recharge: false });
  const s3 = E.vfStatus(db, v);
  const okAll = s1 === 'Pending' && s2 === 'Overdue' && storedAfterAging === 'Pending' && s3 === 'Closed';
  report('L7-1', 'Overdue 纯派生不落库 / Closed 才落库', okAll ? 'PASS' : 'BUG',
    `Pending→${s2}(落库=${storedAfterAging})→${s3}；全库审计仅 engine.js:804 写 Pending、:841 写 Closed，scheduler.js:34-35 用原始 status+expected 与派生等价，无直写 Overdue 的旁路`);
}

console.log(`\n===== 汇总：PASS=${passN} SUSPECT=${suspectN} BUG=${bugN} =====`);
