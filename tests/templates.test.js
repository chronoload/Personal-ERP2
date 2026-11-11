import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BUILTIN_TEMPLATES, TEMPLATE_CATEGORIES, templateStats, appliedStage,
  buildTemplatePayload, extractGoalTemplate, extractPlanTemplate,
  parseTemplateMD, serializeTemplateMD, TEMPLATE_PROMPT,
  parseTemplatesMD, serializeTemplatesMD, parseTemplateFile, mergeEditedTemplate,
} from '../src/domain/templates.js';

// 内置模板阶段既可能写 goal（单目标），也可能写 goals（多目标）
function stageGoalsOf(st) {
  if (!st) return [];
  if (Array.isArray(st.goals)) return st.goals;
  return st.goal ? [st.goal] : [];
}
function goalTitle(st) { return stageGoalsOf(st)[0].title; }
function stagePlanCount(st) {
  return stageGoalsOf(st).reduce((s, g) => s + (g.plans || []).length, 0);
}

test('内置模板：多阶段、阶段预算占比合计为 1、每阶段都有目标/计划/活动', () => {
  assert.ok(BUILTIN_TEMPLATES.length >= 4);
  for (const tpl of BUILTIN_TEMPLATES) {
    assert.ok(TEMPLATE_CATEGORIES.includes(tpl.category));
    assert.ok(Array.isArray(tpl.stages) && tpl.stages.length >= 2, `${tpl.name} 应为多阶段`);
    const share = tpl.stages.reduce((s, st) => s + st.share, 0);
    assert.ok(Math.abs(share - 1) < 1e-9, `${tpl.name} 阶段占比合计应为 1`);
    for (const st of tpl.stages) {
      const goals = Array.isArray(st.goals) ? st.goals : (st.goal ? [st.goal] : []);
      assert.ok(goals.length > 0 && goals.every((g) => g.title));
      const plans = goals.flatMap((g) => g.plans || []);
      assert.ok(plans.length > 0);
      assert.ok(plans.every((p) => p.activities.length > 0));
    }
    const st = templateStats(tpl);
    assert.equal(st.stages, tpl.stages.length);
    assert.ok(st.goals > 0 && st.plans > 0 && st.activities > 0);
  }
});

test('buildTemplatePayload：只展开指定阶段，预算 = 建议预算 × 阶段占比', () => {
  const tpl = BUILTIN_TEMPLATES[0];
  const p1 = buildTemplatePayload(tpl, { recommended: 3000, stage: 1 });
  assert.equal(p1.kind, 'stage');
  assert.equal(p1.stage, 1);
  assert.equal(p1.goals.length, 1);
  assert.equal(p1.budgetTotal, Math.round(3000 * tpl.stages[0].share));

  const p2 = buildTemplatePayload(tpl, { recommended: 3000, stage: 2 });
  assert.notEqual(p2.goals[0].title, p1.goals[0].title, '第二阶段应是新的目标，不重复建');

  const pOut = buildTemplatePayload(tpl, { recommended: 3000, stage: 99 });
  assert.equal(pOut.goals.length, 0);
  assert.equal(pOut.budgetTotal, 0);
});

test('appliedStage：按已创建目标的 stage 标记计算进度', () => {
  const db = { goals: [{ id: 'g1', tpl_id: 'tpl_x', tpl_stage: 1 }, { id: 'g2', tpl_id: 'tpl_x', tpl_stage: 2 }, { id: 'g3' }] };
  assert.equal(appliedStage(db, 'tpl_x'), 2);
  assert.equal(appliedStage(db, 'tpl_none'), 0);
});

test('extractGoalTemplate：目标级快照，只含该目标的计划与活动', () => {
  const db = {
    goals: [{ id: 'g1', title: '目标一', status: 'Active' }, { id: 'g2', title: '目标二', status: 'Active' }],
    plans: [
      { id: 'p1', goal_id: 'g1', title: '计划一', status: 'Active', budget: 1200, priority: 2, horizonMonths: 6 },
      { id: 'p2', goal_id: 'g1', title: '归档计划', status: 'Archived', budget: 900 },
      { id: 'p3', goal_id: 'g2', title: '别人的计划', status: 'Active', budget: 300 },
    ],
    activities: [
      { id: 'a1', title: '活动一', plan_ids: ['p1'], status: 'Active', planned_minutes: 60, repeat: 'daily', depth: true },
      { id: 'a2', title: '归档活动', plan_ids: ['p1'], status: 'Archived', planned_minutes: 30 },
    ],
  };
  const t = extractGoalTemplate(db, 'g1', '我的目标模板');
  assert.equal(t.kind, 'goal');
  assert.equal(t.goals.length, 1);
  assert.equal(t.goals[0].title, '目标一');
  assert.equal(t.goals[0].plans.length, 1);
  assert.equal(t.goals[0].plans[0].budget, 1200);
  assert.equal(t.goals[0].plans[0].activities.length, 1);
  assert.equal(extractGoalTemplate(db, 'g2', 'x').goals[0].plans.length, 1, '不串目标');
});

test('extractPlanTemplate：计划级快照，只含该计划与活动', () => {
  const db = {
    goals: [{ id: 'g1', title: '目标', status: 'Active' }],
    plans: [{ id: 'p1', goal_id: 'g1', title: '计划', status: 'Active', budget: 500, priority: 1, horizonMonths: 2 }],
    activities: [
      { id: 'a1', title: '活动一', plan_ids: ['p1'], status: 'Active', planned_minutes: 45, repeat: null, depth: false },
      { id: 'a2', title: '归档活动', plan_ids: ['p1'], status: 'Archived', planned_minutes: 30 },
    ],
  };
  const t = extractPlanTemplate(db, 'p1', '计划模板');
  assert.equal(t.kind, 'plan');
  assert.equal(t.plan.title, '计划');
  assert.equal(t.plan.budget, 500);
  assert.equal(t.plan.activities.length, 1);
  assert.equal(templateStats(t).plans, 1);
});

test('buildTemplatePayload：计划级模板保留绝对预算，等待挂到目标下', () => {
  const t = {
    kind: 'plan',
    plan: { title: '计划', budget: 500, priority: 1, horizonMonths: 2, activities: [{ title: '活动', minutes: 45 }] },
  };
  const p = buildTemplatePayload(t, { recommended: 9999 });
  assert.equal(p.kind, 'plan');
  assert.equal(p.plan.budget, 500);
  assert.equal(p.activityCount, 1);
});

const SAMPLE_MD = `# 我的学术模板
分类: 学术
描述: 文献到写作

阶段: 文献 | 0.6
目标: 论文主线
计划: 文献综述 | 优先级 2 | 周期 3 | 权重 1
- 精读 | 60分钟 | weekday | 深度
- 卡片 | 30 | weekday

阶段: 写作 | 0.4
目标: 写作线
计划: 章节写作 | 优先级 1 | 周期 2 | 权重 1
- 写作 | 90 | daily | 深度`;

test('parseTemplateMD：手写 MD 解析出阶段/目标/计划/活动，占比归一化', () => {
  const { template, errors, stats } = parseTemplateMD(SAMPLE_MD);
  assert.deepEqual(errors, []);
  assert.equal(template.name, '我的学术模板');
  assert.equal(template.category, '学术');
  assert.equal(template.stages.length, 2);
  assert.equal(stats.stages, 2);
  assert.equal(stats.goals, 2);
  assert.equal(stats.plans, 2);
  assert.equal(stats.activities, 3);
  assert.ok(Math.abs(template.stages.reduce((s, st) => s + st.share, 0) - 1) < 1e-9);
  const a = template.stages[0].goals[0].plans[0].activities[0];
  assert.equal(a.minutes, 60);
  assert.equal(a.repeat, 'weekday');
  assert.equal(a.depth, true);
});

test('parseTemplateMD：缺名称 / 计划无目标 / 活动无计划 给出可读错误', () => {
  const bad = `阶段: 启动 | 1
计划: 悬空计划
- 悬空活动`;
  const { errors } = parseTemplateMD(bad);
  assert.ok(errors.some((e) => e.includes('缺少模板名称')));
  assert.ok(errors.some((e) => e.includes('计划前需要')));
});

test('serializeTemplateMD：内置阶段模板可往返解析', () => {
  const tpl = BUILTIN_TEMPLATES[0];
  const md = serializeTemplateMD({ ...tpl, stages: [tpl.stages[0]], name: '往返测试' });
  const { template, errors, stats } = parseTemplateMD(md);
  assert.deepEqual(errors, []);
  assert.equal(template.name, '往返测试');
  assert.equal(template.stages.length, 1);
  assert.equal(template.stages[0].goals[0].title, goalTitle(tpl.stages[0]));
  assert.equal(stats.plans, stagePlanCount(tpl.stages[0]));
});

test('TEMPLATE_PROMPT：包含 schema 关键行与多轮约定', () => {
  for (const key of ['阶段:', '目标:', '计划:', '权重', '多轮', '只给一个']) {
    assert.ok(TEMPLATE_PROMPT.includes(key), `prompt 缺少 ${key}`);
  }
});

test('parseTemplatesMD：一个文件里按一级标题切出多个模板', () => {
  const md = `${SAMPLE_MD}

# 第二个模板
分类: 健康
阶段: 启动 | 1
目标: 运动
计划: 跑步 | 优先级 3 | 周期 6 | 权重 1
- 慢跑 | 30 | daily`;
  const results = parseTemplatesMD(md);
  assert.equal(results.length, 2);
  assert.equal(results[0].template.name, '我的学术模板');
  assert.equal(results[1].template.name, '第二个模板');
  assert.deepEqual(results[0].errors, []);
  assert.deepEqual(results[1].errors, []);
  assert.equal(results[1].stats.activities, 1);
});

test('parseTemplatesMD：坏模板只影响自己，不污染其他模板', () => {
  const md = `${SAMPLE_MD}

# 坏模板
阶段: 启动 | 1
计划: 悬空`;
  const results = parseTemplatesMD(md);
  assert.equal(results.length, 2);
  assert.deepEqual(results[0].errors, []);
  assert.ok(results[1].errors.length > 0);
});

test('serializeTemplatesMD：多模板往返', () => {
  const a = { ...BUILTIN_TEMPLATES[0], stages: [BUILTIN_TEMPLATES[0].stages[0]], name: 'A' };
  const b = { ...BUILTIN_TEMPLATES[3], stages: [BUILTIN_TEMPLATES[3].stages[0]], name: 'B' };
  const md = serializeTemplatesMD([a, b]);
  const results = parseTemplatesMD(md);
  assert.equal(results.length, 2);
  assert.deepEqual(results.map((r) => r.template.name), ['A', 'B']);
  assert.ok(results.every((r) => r.errors.length === 0));
});

test('parseTemplateFile：每个文件独立解析，无标题时用文件名兜底', () => {
  const noHeading = `分类: 健康
阶段: 启动 | 1
目标: 运动
计划: 跑步 | 优先级 3 | 周期 6 | 权重 1
- 慢跑 | 30 | daily`;
  const one = parseTemplateFile('我的健康.md', noHeading);
  assert.equal(one.length, 1);
  assert.equal(one[0].template.name, '我的健康');
  assert.deepEqual(one[0].errors, []);

  const multi = parseTemplateFile('合集.md', `${SAMPLE_MD}\n\n# 第二个\n阶段: 启动 | 1\n目标: 目标\n计划: 计划\n- 活动 | 30`);
  assert.equal(multi.length, 2);
  assert.deepEqual(multi[0].errors, []);
  assert.deepEqual(multi[1].errors, []);
});

test('parseTemplateFile：空文件不产生模板', () => {
  assert.deepEqual(parseTemplateFile('empty.md', '   \n'), []);
});

test('buildTemplatePayload：阶段内多计划权重归一化，预算不超阶段总额', () => {
  const tpl = {
    builtin: true,
    stages: [{ name: 'S', share: 1, goal: { title: 'G', plans: [
      { title: 'a', weight: 1, activities: [] },
      { title: 'b', weight: 0.5, activities: [] },
    ] } }],
  };
  const p = buildTemplatePayload(tpl, { recommended: 300, stage: 1 });
  assert.equal(p.budgetTotal, 300);
  assert.equal(p.goals[0].plans.length, 2);
});

test('mergeEditedTemplate：阶段模板替换 stages，目标/计划模板保留原 kind', () => {
  const parsed = parseTemplateMD(`# 新名字
分类: 健康
阶段: 启动 | 1
目标: 目标
计划: 计划 | 优先级 2 | 周期 3 | 权重 1
- 活动 | 30 | daily`).template;

  const staged = mergeEditedTemplate({ id: 't1', name: '旧', category: '自定义', stages: [] }, parsed);
  assert.equal(staged.name, '新名字');
  assert.equal(staged.stages.length, 1);
  assert.equal(staged.kind, undefined);

  const goalTpl = mergeEditedTemplate({ id: 't2', kind: 'goal', name: '旧', goals: [] }, parsed);
  assert.equal(goalTpl.kind, 'goal');
  assert.equal(goalTpl.goals[0].title, '目标');
  assert.equal(goalTpl.stages, undefined);

  const planTpl = mergeEditedTemplate({ id: 't3', kind: 'plan', name: '旧', plan: {} }, parsed);
  assert.equal(planTpl.kind, 'plan');
  assert.equal(planTpl.plan.title, '计划');
  assert.equal(planTpl.plan.activities.length, 1);

  assert.equal(mergeEditedTemplate(null, parsed), null);
});
