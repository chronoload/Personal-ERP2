// ============================================================
// domain/builtinTemplates.js —— 调研后的渐进式内置模板
//
// 设计口径（来自 4 路调研）：
//   · 薄前端：阶段 1 只买「值得继续」的证据，不铺资产；
//   · 重中段：主要资源投在能形成产出的阶段；
//   · 尾部缓冲：最后一段包含收尾与超支缓冲，不每段自带安全垫。
// 3 阶段默认 30/50/20；探索型 4 阶段 20/30/35/15；
// 健康习惯 3 阶段 20/55/25（末端用于防复发，不用于新增投入）。
//
// 活动全部可落到日历：具体动作 + 分钟数 + daily/weekday/weekly + 深度标记。
// ============================================================

export const BUILTIN_TEMPLATES = [
  {
    id: 'tpl_student', builtin: true, category: '学生', name: '学生 · 学业主线',
    desc: '先跑通「预读—听课—24h 自测」的最小闭环，再加间隔复习与项目，最后用模拟考收尾；不把每天排满。',
    stages: [
      {
        name: '取证启动', share: 0.30,
        goal: { title: '学业主线', plans: [
          { title: '课程闭环', weight: 0.7, priority: 1, horizonMonths: 3, activities: [
            { title: '课前预读写 3 个问题', minutes: 30, repeat: 'weekday' },
            { title: '听课并写结构化笔记', minutes: 90, repeat: 'weekday', depth: true },
            { title: '课后 24h 闭卷自测', minutes: 20, repeat: 'weekday', depth: true },
          ] },
          { title: '体能底座', weight: 0.3, priority: 3, horizonMonths: 3, activities: [
            { title: '快走或球类', minutes: 60, repeat: 'weekly' },
          ] },
        ] },
      },
      {
        name: '主推进', share: 0.50,
        goals: [
          { title: '课程掌握', plans: [
            { title: '间隔复习', weight: 0.6, priority: 1, horizonMonths: 3, activities: [
              { title: '易混题型交错练习', minutes: 60, repeat: 'weekly', depth: true },
              { title: '错题卡自测至连续 2 次答对', minutes: 20, repeat: 'daily' },
            ] },
            { title: '学术阅读', weight: 0.4, priority: 2, horizonMonths: 6, activities: [
              { title: '精读 1 篇并写 200 字摘要', minutes: 90, repeat: 'weekly', depth: true },
            ] },
          ] },
          { title: '技能迁移', plans: [
            { title: '课程项目', weight: 0.5, priority: 2, horizonMonths: 3, activities: [
              { title: '项目推进', minutes: 90, repeat: 'weekly', depth: true },
              { title: '项目周复盘', minutes: 45, repeat: 'weekly' },
            ] },
          ] },
        ],
      },
      {
        name: '收尾与迁移', share: 0.20,
        goal: { title: '考试与成果', plans: [
          { title: '考试冲刺', weight: 0.7, priority: 1, horizonMonths: 1, activities: [
            { title: '全真限时模拟', minutes: 120, repeat: 'weekly', depth: true },
            { title: '错题回炉', minutes: 45, repeat: 'weekly' },
          ] },
          { title: '成果整理', weight: 0.3, priority: 3, horizonMonths: 3, activities: [
            { title: '课程项目归档与复盘', minutes: 60, repeat: 'weekly' },
          ] },
        ] },
      },
    ],
  },
  {
    id: 'tpl_academic', builtin: true, category: '学术', name: '学术 · 论文推进',
    desc: '文献取证 → 设计冻结 → 生产与写作 → 投稿响应；写作从第一阶段就开始，不等数据收完。',
    stages: [
      {
        name: '文献取证', share: 0.20,
        goals: [
          { title: '文献基线', plans: [
            { title: '系统检索', weight: 0.75, priority: 1, horizonMonths: 3, activities: [
              { title: '检索式在 PubMed/Embase/CENTRAL 执行并存档', minutes: 60, repeat: 'weekly', depth: true },
              { title: '去重与题摘筛选，记录排除理由', minutes: 45, repeat: 'weekly' },
              { title: '精读 3 篇核心文献并填证据表', minutes: 90, repeat: 'weekly', depth: true },
            ] },
          ] },
          { title: '写作节律', plans: [
            { title: '每日写作', weight: 0.25, priority: 2, horizonMonths: 3, activities: [
              { title: '写背景或方法草稿 300 字', minutes: 30, repeat: 'weekday', depth: true },
            ] },
          ] },
        ],
      },
      {
        name: '设计冻结', share: 0.30,
        goal: { title: '设计与数据', plans: [
          { title: '预注册', weight: 0.6, priority: 1, horizonMonths: 3, activities: [
            { title: '写假设与主结局，做功效分析', minutes: 90, repeat: 'weekly', depth: true },
          ] },
          { title: '数据管理', weight: 0.4, priority: 2, horizonMonths: 3, activities: [
            { title: '建 DMP 与 raw/derived 目录及命名规范', minutes: 45, repeat: 'weekly' },
            { title: '试点采集 5 例并核对流程', minutes: 90, repeat: 'weekly', depth: true },
          ] },
        ] },
      },
      {
        name: '生产与写作', share: 0.35,
        goals: [
          { title: '数据生产', plans: [
            { title: '采集执行', weight: 0.6, priority: 1, horizonMonths: 3, activities: [
              { title: '主实验采集', minutes: 120, repeat: 'weekday', depth: true },
              { title: '每周数据质量核查', minutes: 45, repeat: 'weekly' },
            ] },
            { title: '分析脚本', weight: 0.25, priority: 2, horizonMonths: 3, activities: [
              { title: '更新分析脚本与结果图', minutes: 90, repeat: 'weekly', depth: true },
            ] },
          ] },
          { title: '成稿', plans: [
            { title: '章节写作', weight: 0.15, priority: 1, horizonMonths: 2, activities: [
              { title: '每日写作 30 分钟', minutes: 30, repeat: 'weekday', depth: true },
              { title: '每周整合一节并改到可读', minutes: 90, repeat: 'weekly', depth: true },
            ] },
          ] },
        ],
      },
      {
        name: '投稿响应', share: 0.15,
        goal: { title: '成稿与投稿', plans: [
          { title: '稿件整合', weight: 0.6, priority: 1, horizonMonths: 1, activities: [
            { title: '全文一致性修订', minutes: 90, repeat: 'weekly', depth: true },
            { title: '内部预审并逐条改稿', minutes: 60, repeat: 'weekly' },
          ] },
          { title: '投稿响应', weight: 0.4, priority: 1, horizonMonths: 1, activities: [
            { title: '投稿信与格式核对', minutes: 45, repeat: 'weekly' },
            { title: '审稿意见逐条响应表', minutes: 90, repeat: 'weekly', depth: true },
          ] },
        ] },
      },
    ],
  },
  {
    id: 'tpl_pm', builtin: true, category: '产品', name: '产品经理 · 交付成长',
    desc: '每周 1 次访谈 + 1 页需求 + 1 次原型取舍起步，逐段加入双轨、指标、6 周节奏与带教；每个活动都有可归档产出。',
    stages: [
      {
        name: '取证启动', share: 0.15,
        goals: [
          { title: '需求有证据', plans: [
            { title: '访谈与洞察', weight: 0.5, priority: 1, horizonMonths: 3, activities: [
              { title: '访谈 1 位用户并写 1 页洞察（3 条原话）', minutes: 90, repeat: 'weekly', depth: true },
            ] },
            { title: '需求与原型', weight: 0.5, priority: 1, horizonMonths: 3, activities: [
              { title: '写 1 页需求（问题/证据/验收各 3 条）', minutes: 60, repeat: 'weekly', depth: true },
              { title: '原型取舍：3 个方案截图 + 1 条取舍结论', minutes: 90, repeat: 'weekly', depth: true },
              { title: '指标速览：看 3 个核心指标并记 1 行结论', minutes: 20, repeat: 'weekday' },
            ] },
          ] },
        ],
      },
      {
        name: '双轨扩展', share: 0.30,
        goals: [
          { title: '发现与交付双轨', plans: [
            { title: '机会树与假设检验', weight: 0.3, priority: 1, horizonMonths: 6, activities: [
              { title: '机会树更新：3 个机会点收敛到 1 个待验证假设', minutes: 60, repeat: 'weekly', depth: true },
              { title: '假设测试：可点原型 + 5 位用户反馈记录', minutes: 90, repeat: 'weekly', depth: true },
            ] },
            { title: '周期交付', weight: 0.25, priority: 2, horizonMonths: 6, activities: [
              { title: '写 3 份 pitch（问题/边界/不做）', minutes: 60, repeat: 'weekly', depth: true },
              { title: 'Demo 复盘：演示 1 个增量 + 1 条指标位移', minutes: 45, repeat: 'weekly' },
            ] },
          ] },
          { title: '决策有据', plans: [
            { title: '指标诊断', weight: 0.2, priority: 2, horizonMonths: 6, activities: [
              { title: '漏斗诊断：更新 1 个 AARRR 漏斗并标 1 处断点', minutes: 45, repeat: 'weekly' },
            ] },
            { title: '干系人对齐', weight: 0.25, priority: 2, horizonMonths: 6, activities: [
              { title: '周同步：1 页进展 + 1 个待决决策', minutes: 30, repeat: 'weekly' },
            ] },
          ] },
        ],
      },
      {
        name: '规模交付', share: 0.40,
        goal: { title: '交付节奏', plans: [
          { title: '6 周周期运营', weight: 0.55, priority: 2, horizonMonths: 12, activities: [
            { title: '6 周 pitch 评审：按 appetite 写 1 份 pitch', minutes: 90, repeat: 'weekly', depth: true },
            { title: '交付复盘：1 条流程改动 + 1 个指标位移', minutes: 45, repeat: 'weekly' },
          ] },
          { title: '发布与增长', weight: 0.45, priority: 1, horizonMonths: 6, activities: [
            { title: '灰度发布检查：1 页风险清单 + 回滚方案', minutes: 60, repeat: 'weekly', depth: true },
            { title: '增长实验：1 个假设 + 1 个最小实验', minutes: 90, repeat: 'weekly', depth: true },
          ] },
        ] },
      },
      {
        name: '固化与带教', share: 0.15,
        goal: { title: '团队放大', plans: [
          { title: '带教', weight: 0.4, priority: 3, horizonMonths: 12, activities: [
            { title: '陪跑 1 次访谈并给 3 条反馈', minutes: 60, repeat: 'weekly', depth: true },
          ] },
          { title: '策略沉淀', weight: 0.6, priority: 2, horizonMonths: 12, activities: [
            { title: '策略备忘：3 个赌注 + 1 个不做清单', minutes: 60, repeat: 'weekly' },
            { title: '季度复盘：1 页结果 + 1 条下季改动', minutes: 45, repeat: 'weekly' },
          ] },
        ] },
      },
    ],
  },
  {
    id: 'tpl_health', builtin: true, category: '健康', name: '健康习惯 · 体能底盘',
    desc: '先每周两次 25 分钟有氧，再叠加两次自重力量，最后补睡眠与饮食；末端预算用于防复发，不追强度。',
    stages: [
      {
        name: '有氧启动', share: 0.20,
        goal: { title: '运动 · 有氧', plans: [
          { title: '低门槛有氧', weight: 1, priority: 4, horizonMonths: 3, activities: [
            { title: '快走/慢跑（第 1 次）', minutes: 25, repeat: 'weekly' },
            { title: '快走/慢跑（第 2 次）', minutes: 25, repeat: 'weekly' },
          ] },
        ] },
      },
      {
        name: '力量加入', share: 0.55,
        goals: [
          { title: '运动 · 有氧维持', plans: [
            { title: '有氧维持', weight: 0.5, priority: 4, horizonMonths: 6, activities: [
              { title: '快走/慢跑（第 1 次）', minutes: 30, repeat: 'weekly' },
              { title: '快走/慢跑（第 2 次）', minutes: 30, repeat: 'weekly' },
            ] },
          ] },
          { title: '运动 · 力量', plans: [
            { title: '全身自重力量', weight: 0.5, priority: 3, horizonMonths: 6, activities: [
              { title: '深蹲/俯卧撑/划船（第 1 次）', minutes: 30, repeat: 'weekly' },
              { title: '深蹲/俯卧撑/划船（第 2 次）', minutes: 30, repeat: 'weekly' },
            ] },
          ] },
        ],
      },
      {
        name: '恢复与饮食', share: 0.25,
        goals: [
          { title: '恢复 · 睡眠', plans: [
            { title: '恢复习惯', weight: 0.5, priority: 3, horizonMonths: 6, activities: [
              { title: '睡前放松（离屏/洗漱）', minutes: 20, repeat: 'daily' },
              { title: '午后散步（久坐打断）', minutes: 20, repeat: 'weekday' },
            ] },
          ] },
          { title: '恢复 · 饮食', plans: [
            { title: '地中海式饮食', weight: 0.5, priority: 4, horizonMonths: 6, activities: [
              { title: '备餐（蔬菜/蛋白/全谷）', minutes: 45, repeat: 'weekly' },
              { title: '晚餐加蔬菜与蛋白', minutes: 20, repeat: 'weekday' },
            ] },
          ] },
        ],
      },
    ],
  },
];
