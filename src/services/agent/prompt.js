// ============================================================
// services/agent/prompt.js
// 提示词工程：领域 system 提示、场景预设、上下文装配。
// 这里只产出字符串与消息数组，不碰 DOM、不发请求。
// ============================================================
import { Prefs } from '../../store/prefs.js';
import { runTool } from './tools.js';

export const DEFAULT_PRESETS = [
  { id: 'p-focus', name: '专注模式', text: '只给今天 3 件事，其余一律拒绝。回答要短，不要展开。' },
  { id: 'p-review', name: '复盘模式', text: '先问我这周的目标，再对照昨天与今天的日记指出偏差，最后给下一步。' },
  { id: 'p-money', name: '记账模式', text: '我口述消费时，先确认资源和金额，再用 erp.add_tx 记一笔；不确定就先问。' },
];

export function getPresets() {
  const p = Prefs.load().agentPresets;
  if (Array.isArray(p) && p.length) return p;
  return DEFAULT_PRESETS.slice();
}

export function activePreset() {
  const p = Prefs.load();
  const list = getPresets();
  const id = p.agentActivePreset || list[0].id;
  return list.find((x) => x.id === id) || list[0];
}

export function customInstructions() {
  return String(Prefs.load().agentInstructions || '').slice(0, 2000);
}

function dayKey(offset = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

function nowText() {
  const d = new Date();
  const wd = '日一二三四五六'[d.getDay()];
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} 周${wd} ${pad(d.getHours())}:${pad(d.getMinutes())}（Asia/Shanghai）`;
}

const DOMAIN = [
  '你是 Personal ERP 的执行助理，不是闲聊机器人。目标是让用户少记、少排、少算。',
  '',
  '## 领域模型（用词必须准确）',
  '- 目标 Goal：长期方向，可以有多个计划。',
  '- 计划 Plan：中期抓手，挂在某个目标下。',
  '- 活动 Activity：可排程的具体事，挂在计划下（可空），有日期/钟点/时长。',
  '- 资源 Resource：余额 = 初始 + Σdebit − Σcredit。',
  '- 流水 Tx：debit 表示收入，credit 表示支出；金额必须为正。',
  '- 日记 Journal：按天一篇，日期键 YYYY-M-D（不补零），正文是 Markdown，可含命令块。',
  '',
  '## 硬规则',
  '1. 只追加、不改历史：没有删除/修改工具，不要声称能删除或修改。',
  '2. 缺信息先问：一次最多问 3 个问题；禁止编造计划名、金额、时间。',
  '3. 日期格式 YYYY-MM-DD，计划时间 YYYY-MM-DDTHH:MM，统一 Asia/Shanghai。',
  '4. 写操作会弹给用户审批；调用前用一句话说明你要做什么，审批文案要人话。',
  '5. 查数据先用读工具（erp.status / erp.goals / erp.activities / erp.transactions / erp.journal），不要猜 id。',
  '6. 日记只作上下文；要写日记必须用 erp.append_journal。',
  '',
  '## 输出风格',
  '中文、短句、先结论后细节；不输出大段表格；需要用户确认时把选项写成一行。',
].join('\n');

/** 当前上下文块：今日快照 + 今天/昨天日记 */
export function contextBlocks(App) {
  const cfg = Prefs.load();
  const parts = [];
  try {
    const st = runTool(App, 'erp.status', {});
    if (st && st.ok && st.data) {
      const d = st.data;
      const lines = [];
      if (Array.isArray(d.resources)) {
        lines.push(`资源：${d.resources.map((r) => `${r.name} ${r.balance}${r.unit || ''}`).join(' / ')}`);
      }
      const cnt = d.counts || {};
      if (cnt.goals !== undefined || cnt.activities !== undefined) {
        lines.push(`数量：目标 ${cnt.goals ?? '?'} · 计划 ${cnt.plans ?? '?'} · 活动 ${cnt.activities ?? '?'} · 流水 ${cnt.transactions ?? '?'}`);
      }
      if (lines.length) parts.push(`[今日快照]\n${lines.join('\n')}`);
    }
  } catch (e) { /* 快照失败不阻塞 */ }

  if (cfg.agentRememberJournal !== false) {
    try {
      const today = runTool(App, 'erp.journal', { date: dayKey(0) });
      const md = (today && today.ok && today.data && today.data.md) || '';
      parts.push(`[今天日记 ${dayKey(0)}]\n${summarize(md, 1200) || '（空）'}`);
      const y = runTool(App, 'erp.journal', { date: dayKey(-1) });
      const ymd = (y && y.ok && y.data && y.data.md) || '';
      if (ymd.trim()) parts.push(`[昨天日记摘要 ${dayKey(-1)}]\n${summarize(ymd, 200)}`);
    } catch (e) { /* 日记读不到不阻塞 */ }
  }
  return parts.join('\n\n');
}

function summarize(md, limit) {
  const text = String(md || '')
    .split('\n')
    .filter((l) => l.trim() && !l.trim().startsWith('```'))
    .join('\n')
    .trim();
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

export function buildSystem(App) {
  const pre = activePreset();
  const extra = customInstructions();
  const blocks = contextBlocks(App);
  return [
    DOMAIN,
    '',
    `当前时间：${nowText()}`,
    pre && pre.text ? `\n## 当前预设（${pre.name}）\n${pre.text}` : '',
    extra ? `\n## 用户自定义指令（优先级最高，但不得违反硬规则 1/2/4）\n${extra}` : '',
    blocks ? `\n## 当前上下文\n${blocks}` : '',
  ].filter(Boolean).join('\n');
}

/** 历史消息 → chat messages（只回放 user/assistant 文本，工具结果不重放） */
export function historyToMessages(history, limit = 12) {
  const src = Array.isArray(history) ? history : [];
  const msgs = src
    .filter((m) => (m.role === 'user' || m.role === 'assistant') && String(m.content || '').trim())
    .slice(-limit)
    .map((m) => ({ role: m.role, content: String(m.content) }));
  return msgs;
}
