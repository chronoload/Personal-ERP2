# -*- coding: utf-8 -*-
# e2e/preview.py — 预览 UI 重构（worktree 5173）：看板/日历交换、过滤条目标汇聚、计时器 dock
from playwright.sync_api import sync_playwright
import os, json

BASE = 'http://localhost:5173'
SHOT = os.path.join(os.path.dirname(__file__), '_shots')
os.makedirs(SHOT, exist_ok=True)

with sync_playwright() as p:
    b = p.chromium.launch(headless=True)
    pg = b.new_page(viewport={"width": 420, "height": 860})  # 移动端尺寸
    pg.goto(BASE)
    pg.wait_for_load_state('networkidle')
    pg.wait_for_timeout(400)

    # 造数据：2 目标 × 2 计划 × 若干活动（含循环）→ 看板多列、过滤条有目标
    pg.evaluate("""() => {
      const App = window.App;
      const { engine } = App;
      if (!App.db.resources.length) engine.createResource(App.db, { name: '价值元', unit: '元', initial: 100, color: null });
      engine.createGoal(App.db, { title: '写作', desc: '产出文章' });
      engine.createGoal(App.db, { title: '健身', desc: '保持状态' });
      const g1 = App.db.goals[0].id, g2 = App.db.goals[1].id;
      const p1 = engine.createPlan(App.db, { goal_id: g1, title: '公众号', budget: null });
      const p2 = engine.createPlan(App.db, { goal_id: g1, title: '论文', budget: null });
      const p3 = engine.createPlan(App.db, { goal_id: g2, title: '跑步计划', budget: null });
      const pid1 = App.db.plans.find(p => p.title === '公众号').id;
      const pid2 = App.db.plans.find(p => p.title === '论文').id;
      const pid3 = App.db.plans.find(p => p.title === '跑步计划').id;
      engine.createActivity(App.db, { title: '写大纲', note: '', plan_ids: [pid1], planned_start: '2026-9-7T09:00', planned_minutes: 60 });
      engine.createActivity(App.db, { title: '收集素材', note: '', plan_ids: [pid1], planned_start: '2026-9-7T14:00', planned_minutes: 90 });
      engine.createActivity(App.db, { title: '跑数据', note: '', plan_ids: [pid2], planned_start: '2026-9-8T10:00', planned_minutes: 120 });
      engine.createActivity(App.db, { title: '晨跑', note: '循环', plan_ids: [pid3], planned_date: '2026-9-7', planned_start: '2026-9-7T07:00', planned_minutes: 30, repeat: 'daily' });
      engine.createActivity(App.db, { title: '哑铃', note: '', plan_ids: [pid3], planned_start: '2026-9-9T18:00', planned_minutes: 45 });
      window.App.refresh();
    }""")
    pg.wait_for_timeout(600)

    def snap(name):
        pg.screenshot(path=os.path.join(SHOT, name), full_page=False)
        print('[shot]', name)

    # 1) 默认页 = 看板（与日历交换后第一位）
    nav0 = pg.evaluate("() => document.querySelector('.dash-nav-item[data-page=\"0\"]')?.textContent.trim()")
    print('[nav0]', nav0)
    snap('01_kanban_first.png')

    # 2) 过滤条：目标 chips 存在（第一层），点「写作」展开其下计划
    goals = pg.evaluate("() => [...document.querySelectorAll('[data-goal]')].map(b => b.textContent.trim())")
    print('[goal-chips]', goals)
    pg.evaluate("() => { const g = document.querySelector('[data-goal]'); g && g.click(); }")
    pg.wait_for_timeout(400)
    sub = pg.evaluate("() => [...document.querySelectorAll('.kanban-filter.sub .tag-chip')].map(b => b.textContent.trim())")
    print('[sub-plan-chips]', sub)
    snap('02_goal_filter.png')

    # 3) 看板内部横向滚动：列数 & 可滚动
    k = pg.evaluate("""() => {
      const k = document.querySelector('.kanban'); if (!k) return null;
      return { cols: document.querySelectorAll('.kanban-col').length, scrollable: k.scrollWidth > k.clientWidth, scrollW: k.scrollWidth, clientW: k.clientWidth };
    }""")
    print('[kanban]', k)
    snap('03_kanban_scroll.png')

    # 4) 计时器 dock：设 right → 出现右侧 dock；hidden → 消失
    pg.evaluate("() => { const p = window.App; p.engine; localStorage.setItem('personal_erp_prefs', JSON.stringify({ ...(JSON.parse(localStorage.getItem('personal_erp_prefs')||'{}')), timerDock: 'right' })); window.App.refresh(); }")
    pg.wait_for_timeout(400)
    dock = pg.evaluate("() => { const d = document.getElementById('timer-dock'); return d ? (d.className + ' | disp=' + d.style.display) : 'none'; }")
    print('[dock-right]', dock)
    snap('04_dock_right.png')

    pg.evaluate("() => { localStorage.setItem('personal_erp_prefs', JSON.stringify({ ...(JSON.parse(localStorage.getItem('personal_erp_prefs')||'{}')), timerDock: 'hidden' })); window.App.refresh(); }")
    pg.wait_for_timeout(400)
    dock2 = pg.evaluate("() => { const d = document.getElementById('timer-dock'); return d ? d.style.display : 'not-exist'; }")
    print('[dock-hidden]', dock2)

    b.close()
