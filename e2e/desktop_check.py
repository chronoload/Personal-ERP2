from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    b = p.chromium.launch(headless=True)
    pg = b.new_page(viewport={"width": 1280, "height": 800})
    pg.goto('http://localhost:5173')
    pg.wait_for_load_state('networkidle')
    pg.wait_for_timeout(300)
    pg.evaluate("""() => {
      const App = window.App; const { engine } = App;
      if (!App.db.resources.length) engine.createResource(App.db, { name: '价值元', unit: '元', initial: 100, color: null });
      engine.createGoal(App.db, { title: '写作' });
      const g = App.db.goals[0].id;
      const p1 = engine.createPlan(App.db, { goal_id: g, title: '公众号', budget: null });
      const pid = App.db.plans.find(x=>x.title==='公众号').id;
      engine.createActivity(App.db, { title: '待办甲', plan_ids: [pid], planned_start: '2026-9-7T09:00', planned_minutes: 30 });
      engine.createActivity(App.db, { title: '待办乙', plan_ids: [pid], planned_start: '2026-9-8T09:00', planned_minutes: 45 });
      const a2 = engine.createActivity(App.db, { title: '进行中', plan_ids: [pid], planned_start: '2026-9-7T10:00', planned_minutes: 60 });
      window.App.refresh();
    }""")
    pg.wait_for_timeout(400)
    r = pg.evaluate("""() => {
      const k = document.querySelector('.kanban');
      return JSON.stringify({
        w: window.innerWidth,
        groups: document.querySelectorAll('.kanban-groups').length,
        heads: [...document.querySelectorAll('.kanban-col .kanban-head')].map(h => h.textContent.trim()),
        cols: k ? getComputedStyle(k).gridTemplateColumns : 'NO .kanban',
        doneItems: [...document.querySelectorAll('[data-col="Done"] .kanban-card')].length
      });
    }""")
    print(r)
    b.close()
