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
  '7. 用户可能附图或文件：图直接看，文本按文件读；看不清或读不到就说出来，不要臆造内容。',
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

/** 一条消息的附件 → 文本块 + 图片块 */
function attachmentBlocks(m) {
  const list = (m && m.meta && Array.isArray(m.meta.attachments)) ? m.meta.attachments : [];
  const texts = [];
  const images = [];
  for (const a of list) {
    if (a.kind === 'image' && a.dataUrl) {
      images.push(a);
    } else if (a.kind === 'text' && a.text) {
      texts.push(`【文件 ${a.name}】${a.note ? `（${a.note}）` : ''}\n\`\`\`\n${a.text}\n\`\`\``);
    } else {
      texts.push(`【附件 ${a.name}】${a.mime || '未知类型'}${a.size ? ` · ${Math.round(a.size / 1024)}KB` : ''}（未读取内容）`);
    }
  }
  return { texts, images };
}

/** 历史消息 → chat messages：回放 user/assistant；用户附件转成多模态 content 数组 */
export function historyToMessages(history) {
  return (Array.isArray(history) ? history : [])
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => {
      const body = String(m.content || '');
      if (m.role !== 'user') {
        if (!body.trim()) return null;
        const reasoning = m.meta && m.meta.reasoning;
        // DeepSeek 思考模式 + tools：历史思维链必须回传
        return reasoning
          ? { role: 'assistant', content: body, reasoning_content: String(reasoning) }
          : { role: 'assistant', content: body };
      }
      const { texts, images } = attachmentBlocks(m);
      if (!texts.length && !images.length) return body.trim() ? { role: 'user', content: body } : null;
      const merged = [body.trim(), ...texts].filter(Boolean).join('\n\n');
      if (!images.length) return { role: 'user', content: merged || '（空消息）' };
      return {
        role: 'user',
        content: [
          { type: 'text', text: merged || '请看这些图片。' },
          ...images.map((a) => ({ type: 'image_url', image_url: { url: a.dataUrl } })),
        ],
      };
    })
    .filter(Boolean);
}
