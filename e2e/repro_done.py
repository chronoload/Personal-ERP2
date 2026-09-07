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
      for (let i=0;i<26;i++) {
        engine.createActivity(App.db, { title: '已完成事项'+i+'超长标题超长标题超长标题超长标题超长标题', note: '备注'.repeat(20), plan_ids: [], planned_date: '2026-8-'+String((i%26)+1), planned_minutes: 30 });
        const a = App.db.activities[App.db.activities.length-1];
        a.status = 'Completed'; a.actual_start = Date.now()-3600000*(i+1); a.actual_end = Date.now()-3600000*i;
      }
      window.App.refresh();
    }""")
    pg.wait_for_timeout(400)
    pg.evaluate("() => { [...document.querySelectorAll('[onclick*=toggleDone]')][0]?.click(); }")
    pg.wait_for_timeout(400)
    r = pg.evaluate("""() => {
      const q = s => document.querySelector(s);
      const pager = q('.dash-pager'), k = q('.kanban'), cols = [...document.querySelectorAll('.kanban-col')];
      return JSON.stringify({ cards: document.querySelectorAll('.kanban-card').length,
        pagerH: pager?.clientHeight, pagerSH: pager?.scrollHeight,
        kanbanH: k?.clientHeight, kanbanSH: k?.scrollHeight, kanbanCols: getComputedStyle(k).gridTemplateColumns,
        colHeights: cols.map(c=>c.clientHeight+'/'+c.scrollHeight),
        anyOverflow: cols.some(c=>c.scrollWidth>c.clientWidth) });
    }""")
    print(r)
    b.close()
