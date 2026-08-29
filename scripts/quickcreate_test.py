"""E2E: 活动弹窗内联建目标/计划 + 计划卡片下直接建活动（预选）."""
from playwright.sync_api import sync_playwright

def js(pg, expr, arg=None):
    return pg.evaluate(expr) if arg is None else pg.evaluate(expr, arg)

with sync_playwright() as p:
    b = p.chromium.launch(headless=True)
    pg = b.new_page(viewport={"width": 1440, "height": 960})
    errs = []
    pg.on("pageerror", lambda e: errs.append("PAGEERROR " + str(e)))
    pg.on("console", lambda m: errs.append(m.text) if m.type == "error" else None)
    pg.goto("http://localhost:5173/")
    pg.wait_for_load_state("domcontentloaded")
    pg.wait_for_timeout(700)

    # 空种子初始化：先建资源 + 基础目标（使「新建计划」表单可直接展开）
    pg.evaluate("()=>{App.engine.createResource(App.db,{name:'价值元',unit:'价值元',initial:1000});App.engine.createGoal(App.db,{title:'基础目标',desc:''});App.refresh()}")
    pg.wait_for_timeout(300)

    nGoals0 = js(pg, "App.db.goals.length")
    nPlans0 = js(pg, "App.db.plans.length")

    # ---- 1) 活动弹窗内联：新建计划（已有目标）----
    pg.locator("button", has_text="＋ 活动").click()
    pg.wait_for_timeout(250)
    pg.locator("[data-newplan]").click()
    pg.wait_for_timeout(200)
    pg.fill("#f-qplan", "内联计划E2E")
    pg.fill("#f-qbudget", "40")
    pg.locator("[data-saveplan]").click()
    pg.wait_for_timeout(250)
    assert js(pg, "App.db.plans.some(p=>p.title==='内联计划E2E')"), "inline plan not created"
    pid1 = js(pg, "(t)=>App.db.plans.find(p=>p.title===t).id", "内联计划E2E")
    # 新计划应自动勾选
    assert js(pg, "(id)=>document.querySelector(`#actPlanChips input[value='${id}']`)?.checked", pid1) is True, "inline plan not checked"
    print("1) inline create plan: OK")

    # ---- 2) 活动弹窗内联：新建目标 → 自动切到计划表单再建计划 ----
    pg.locator("[data-newgoal]").click()
    pg.wait_for_timeout(200)
    pg.fill("#f-qgoal", "内联目标E2E")
    pg.fill("#f-qgoaldesc", "描述")
    pg.locator("[data-savegoal]").click()
    pg.wait_for_timeout(250)
    assert js(pg, "App.db.goals.some(g=>g.title==='内联目标E2E')"), "inline goal not created"
    # 目标下拉应已刷新并切到计划表单
    assert js(pg, "document.querySelector('#quick-plan').style.display") == "block"
    gid = js(pg, "(t)=>App.db.goals.find(g=>g.title===t).id", "内联目标E2E")
    assert js(pg, "(id)=>document.querySelector('#f-qplangoal').value===id", gid) is True, "new goal not selected"
    pg.fill("#f-qplan", "内联计划E2E2")
    pg.fill("#f-qbudget", "")
    pg.locator("[data-saveplan]").click()
    pg.wait_for_timeout(250)
    assert js(pg, "App.db.plans.some(p=>p.title==='内联计划E2E2')"), "inline plan2 not created"
    pid2 = js(pg, "(t)=>App.db.plans.find(p=>p.title===t).id", "内联计划E2E2")
    assert js(pg, "(id)=>document.querySelector(`#actPlanChips input[value='${id}']`)?.checked", pid2) is True, "plan2 not checked"
    print("2) inline goal + plan: OK")

    # ---- 3) 用勾选的内联计划创建活动 ----
    pg.fill("#f-aname", "内联活动E2E")
    pg.locator(".modal-foot [data-save]").click()
    pg.wait_for_timeout(300)
    aid = js(pg, "(t)=>App.db.activities.find(a=>a.title===t).id", "内联活动E2E")
    assert aid, "inline activity not created"
    planIds = js(pg, "(id)=>App.db.activities.find(a=>a.id===id).plan_ids", aid)
    assert pid1 in planIds and pid2 in planIds, f"activity should link both inline plans: {planIds}"
    print("3) activity linked to inline plans:", planIds, ": OK")

    # ---- 4) 目标与计划 Tab：计划卡片下「＋ 活动」预选该计划 ----
    pg.locator("button.tab", has_text="目标与计划").click()
    pg.wait_for_timeout(300)
    ptarget = js(pg, "App.db.plans[0].id")
    pg.locator("button[onclick*=\"openActModal(null,'%s')\"]" % ptarget).click()
    pg.wait_for_timeout(300)
    checked = js(pg, "(id)=>document.querySelector(`#actPlanChips input[value='${id}']`)?.checked", ptarget)
    assert checked is True, "plan-card ＋活动 should preselect the plan"
    other_checked = js(pg, "(id)=>{const ids=[...document.querySelectorAll('#actPlanChips input:checked')].map(e=>e.value); return ids.filter(x=>x!==id).length}", ptarget)
    assert other_checked == 0, "only the target plan should be preselected"
    pg.locator(".modal-mask .icon-btn").click()
    pg.wait_for_timeout(200)
    print("4) plan-card ＋活动 preselected: OK")

    # ---- 5) 目标/计划卡片：点击头部收起展开，编辑走按钮 ----
    pg.locator("button.tab", has_text="目标与计划").click()
    pg.wait_for_timeout(300)
    # 计划卡：点击头部 → 折叠，再点 → 展开
    pg.locator(".plan-card .plan-head").first.click()
    pg.wait_for_timeout(250)
    assert js(pg, "()=>{const d=document.querySelector('.plan-card .plan-details');return d.offsetParent===null}") is True, "plan-head click should collapse"
    pg.locator(".plan-card .plan-head").first.click()
    pg.wait_for_timeout(250)
    assert js(pg, "()=>{const d=document.querySelector('.plan-card .plan-details');return d.offsetParent!==null}") is True, "plan-head click should expand"
    # 计划编辑走「编辑」按钮
    pg.locator(".plan-card").first.locator("button[onclick*='openPlanModal']").click()
    pg.wait_for_timeout(250)
    assert pg.locator(".modal-head h3", has_text="编辑计划").count() == 1, "plan edit button should open edit"
    pg.locator(".modal-mask .icon-btn").click()
    pg.wait_for_timeout(200)
    # 目标头：点击 → 折叠，再点 → 展开
    pg.locator(".goal-head").first.click()
    pg.wait_for_timeout(250)
    assert js(pg, "()=>{const d=document.querySelector('.goal-plans');return d.offsetParent===null}") is True, "goal-head click should collapse"
    pg.locator(".goal-head").first.click()
    pg.wait_for_timeout(250)
    assert js(pg, "()=>{const d=document.querySelector('.goal-plans');return d.offsetParent!==null}") is True, "goal-head click should expand"
    # 目标编辑走「编辑」按钮
    pg.locator(".goal-head").first.locator("button[onclick*=\"openGoalModal('\"]").click()
    pg.wait_for_timeout(250)
    assert pg.locator(".modal-head h3", has_text="编辑目标").count() == 1, "goal edit button should open edit"
    pg.locator(".modal-mask .icon-btn").click()
    pg.wait_for_timeout(200)
    print("5) goal/plan collapse + edit button: OK")

    # ---- 6) 番茄钟预填计划时间（分钟级）----
    pg.locator("button.tab", has_text="活动").click()
    pg.wait_for_timeout(250)
    pg.evaluate("()=>{App.engine.createActivity(App.db,{title:'预填计时活动',note:'',plan_ids:[],planned_start:'2026-8-22T10:00',planned_minutes:45});App.refresh()}")
    pg.wait_for_timeout(250)
    pg.locator(".kanban-card", has_text="预填计时活动").locator("button", has_text="计时").click()
    pg.wait_for_timeout(300)
    assert pg.locator("#t-big").inner_text() == "45:00", "pomodoro should prefill planned 45:00"
    print("6) pomodoro prefill planned minutes: OK")
    pg.locator(".timer-overlay [data-close]").click()
    pg.wait_for_timeout(200)

    # ---- 7) 填写交互：Enter 提交（活动弹窗内回车直接创建）----
    pg.locator("button", has_text="＋ 活动").click()
    pg.wait_for_timeout(250)
    pg.fill("#f-aname", "回车创建活动E2E")
    pg.locator("#f-aname").press("Enter")
    pg.wait_for_timeout(350)
    assert js(pg, "App.db.activities.some(a=>a.title==='回车创建活动E2E')"), "Enter should submit activity"
    assert pg.locator(".modal-mask").count() == 0, "modal should close after Enter submit"
    print("7) enter-to-submit: OK")

    # ---- 8) 填写交互：Esc 关闭弹窗 ----
    pg.locator("button", has_text="＋ 活动").click()
    pg.wait_for_timeout(250)
    pg.locator("#f-aname").focus()
    pg.keyboard.press("Escape")
    pg.wait_for_timeout(250)
    assert pg.locator(".modal-mask").count() == 0, "Escape should close modal"
    print("8) esc-to-close: OK")

    print("ERRORS:", errs if errs else "NONE")
    print("QUICK-CREATE E2E PASSED")
    b.close()
