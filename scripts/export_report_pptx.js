// ============================================================
// scripts/export_report_pptx.js
// 用 officecli 把「智能简报」去身份聚合 JSON 编译成 6 页 PPTX。
// 用法（在电脑端，officecli 需已安装）：
//   node scripts/export_report_pptx.js report-xxx.json -o 智能简报.pptx
// 输入文件由视图层 App.reportSlides.exportPPTXBuild() 导出（仅聚合统计，不含原始流水/余额）。
// ============================================================
import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// ----- officecli 定位：优先环境变量 / 已知安装路径，最后 PATH -----
function findOfficecli() {
  if (process.env.OFFICECLI) return process.env.OFFICECLI;
  const candidates = [
    'C:\\Users\\qu\\AppData\\Local\\OfficeCLI\\officecli.exe',
    'officecli',
  ];
  for (const c of candidates) {
    const probe = spawnSync(c, ['--version'], { encoding: 'utf8', shell: process.platform === 'win32' });
    if (!probe.error && probe.status === 0) return c;
  }
  return null;
}

function run(cli, args) {
  const r = spawnSync(cli, args, { encoding: 'utf8', shell: process.platform === 'win32' });
  if (r.error) throw r.error;
  if (r.status !== 0) {
    throw new Error(`officecli 失败 (${args[0]}):\n${r.stderr || r.stdout}`);
  }
  return r.stdout;
}

// ----- 参数解析 -----
const argv = process.argv.slice(2);
function arg(name) {
  const i = argv.findIndex((a) => a === name);
  return i >= 0 ? argv[i + 1] : null;
}
const inputFile = argv.find((a) => !a.startsWith('-'));
const outputFile = arg('-o') || arg('--output') || '智能简报.pptx';

if (!inputFile) {
  console.error('用法: node scripts/export_report_pptx.js <report.json> [-o 输出.pptx]');
  process.exit(1);
}
if (!existsSync(inputFile)) {
  console.error(`找不到输入文件: ${inputFile}`);
  process.exit(1);
}

const data = JSON.parse(readFileSync(inputFile, 'utf8'));
const cli = findOfficecli();
if (!cli) {
  console.error('未找到 officecli。请先安装：irm https://d.officecli.ai/install.ps1 | iex');
  process.exit(1);
}
console.log(`officecli: ${cli}`);

// 零起步：删旧建新
if (existsSync(outputFile)) {
  const rm = spawnSync('cmd', ['/c', 'del', `/f`, `/q`, `"${outputFile}"`], { encoding: 'utf8' });
  void rm;
}
run(cli, ['create', outputFile]);
console.log(`已创建 ${outputFile}`);

// ----- 单页工具：标题 + 若干「标签: 值」行 -----
function addSlide(slideNo, title, lines) {
  run(cli, ['add', outputFile, '/', '--type', 'slide', '--prop', `title=${title}`]);
  const slidePath = `/slide[${slideNo}]`;
  const startY = 1.6; // cm
  lines.forEach((ln, i) => {
    const y = startY + i * 1.1;
    run(cli, ['add', outputFile, slidePath, '--type', 'shape',
      '--prop', `text=${ln}`, '--prop', `x=1.2cm`, '--prop', `y=${y}cm`, '--prop', `w=22cm`, '--prop', `h=1cm`,
      '--prop', 'size=16', '--prop', 'font=Arial']);
  });
}

const dur = (min) => {
  const m = Math.round(min || 0);
  if (m <= 0) return '0';
  const h = Math.floor(m / 60), mm = m % 60;
  return h ? `${h}h${mm ? `${mm}m` : ''}` : `${mm}m`;
};
const pct = (r) => (r == null ? '—' : `${Math.round(r * 100)}%`);

const pad = (s, n = 40) => String(s).padEnd(n);

// ----- 页面内容（纯聚合，去身份） -----
const slides = [];

// ① 总览
slides.push({
  title: `智能简报 · ${data.label || ''}（总览）`,
  lines: [
    `本期活动 ${data.overview.actDetail} · 完成 ${data.overview.completed} · 失败 ${data.overview.failed}`,
    `价值流 ${data.overview.vf} 条 · 总投入 ${dur(data.overview.spentMin)}`,
    `排程健康：冲突活动 ${data.overview.sched.actsWithConflict} · 守约 ${data.overview.sched.adheredActs} · 定时 ${data.overview.sched.timedActs} · 弹性 ${data.overview.sched.flexibleActs}`,
  ],
});

// ② 活动明细
slides.push({
  title: '活动明细',
  lines: data.actDetail.length
    ? data.actDetail.map((a) => `${pad(a.title)} ${a.status} · 计划${dur(a.planned_minutes)}/实际${dur(a.actual_minutes)}${a.biasRatio != null ? ` (${pct(a.biasRatio)})` : ''} · 产出${a.outputCount}/价值流${a.vfYield}`)
    : ['本期无活动'],
});

// ③ 时间偏差
slides.push({
  title: '时间估计偏差',
  lines: [
    `总体：${data.timeBias.overall.actsWithActual} 项 · 预计 ${dur(data.timeBias.overall.totalPlannedMin)} · 实际 ${dur(data.timeBias.overall.totalActualMin)} · 偏差 ${pct(data.timeBias.overall.ratio)}`,
    ...data.timeBias.byPlan.map((p) => `${pad(p.title || p.plan_id)} ${dur(p.totalActualMin)}/${dur(p.totalPlannedMin)} (${pct(p.ratio)})`),
  ],
});

// ④ 价值产出
slides.push({
  title: '价值产出（按目标聚合）',
  lines: data.valueYield.byGoal.length
    ? data.valueYield.byGoal.map((g) => `${pad(g.goal_id)} ${g.outputCount} 产出 / ${g.vfCount} 价值流 / ${dur(g.spentMinutes)} 投入 · 密度 ${g.yieldDensity.toFixed(3)}`)
    : ['本期无可结束投入的目标'],
});

// ⑤ 排程健康
slides.push({
  title: '排程健康',
  lines: [
    `冲突活动 ${data.schedHealth.actsWithConflict} · 冲突次数 ${data.schedHealth.totalConflicts}`,
    `定时 ${data.schedHealth.timedActs} · 弹性 ${data.schedHealth.flexibleActs} · 守约 ${data.schedHealth.adheredActs}`,
  ],
});

// ⑥ 预算趋势
slides.push({
  title: '预算 / 资源趋势',
  lines: [
    ...data.budgetTrend.resources.map((x) => `${pad(`${x.name}(${x.unit})`)} ${x.before} → ${x.after} · 净 ${x.net >= 0 ? '+' : ''}${x.net} · 回充 ${x.debit}`),
    ...data.budgetTrend.plans.map((p) => `${pad(p.title || p.plan_id)} ${p.spend}/${p.budget != null ? p.budget : '∞'}${p.overspend ? ' ⚠超支' : ''}`),
  ],
});

slides.forEach((s, i) => addSlide(i + 1, s.title, s.lines));

console.log(`✅ 已生成 ${outputFile}（${slides.length} 页）`);
console.log(`验证: officecli view "${outputFile}" stats`);
