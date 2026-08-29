"""冒烟：初始化流程 + 主界面各视图渲染 + 关键交互，无控制台错误."""
from playwright.sync_api import sync_playwright
import pathlib

OUT = pathlib.Path(r"c:\Users\qu\Desktop\物理科学与技术论题\TS2\personal-erp\.shots")
OUT.mkdir(exist_ok=True)
errors = []

def shot(page, name):
    page.screenshot(path=str(OUT / name), full_page=True)
    print("shot:", name)

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1440, "height": 960})
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    page.on("pageerror", lambda e: errors.append("PAGEERROR: " + str(e)))

    page.goto("http://localhost:5173/")
    page.wait_for_load_state("domcontentloaded")
    page.wait_for_timeout(700)

    # 1. 首次启动 → 初始化页（无预设资源）
    assert page.locator(".setup-card").count() == 1, "onboarding not shown"
    assert page.locator("input#s-name").count() == 1
    # 通过快捷建议添加价值元
    page.locator("[data-quick='价值元']").click()
    page.locator("#s-add").click()
    page.wait_for_timeout(200)
    assert page.evaluate("App.db.resources.length") == 1
    # 完成初始化 → 进入主界面
    page.locator("#s-done").click()
    page.wait_for_timeout(400)
    assert page.locator(".kanban").count() == 1, "kanban missing after init"
    print("0) onboarding init: OK")

    # 预置数据：补 1 资源 + 目标/计划/活动并完成一笔（供看板/账本有内容）
    page.evaluate("()=>{App.engine.createResource(App.db,{name:'时间',unit:'小时',initial:168});App.engine.createGoal(App.db,{title:'示例目标',desc:''});App.engine.createPlan(App.db,{goal_id:App.db.goals[0].id,title:'示例计划',budget:null});const pid=App.db.plans[0].id;App.engine.createActivity(App.db,{title:'示例活动',note:'',plan_ids:[pid]});const a=App.db.activities[0];App.engine.startActivity(App.db,a.id);App.engine.completeActivity(App.db,a.id,{expense:{resource_id:'r1',amount:12,note:'消耗'},output_title:'示例产出',output_tags:['示例']});App.engine.setOutputStatus(App.db,App.db.outputs[0].id,'Published');App.refresh()}")
    page.wait_for_timeout(400)

    # 2. Overview
    shot(page, "01_overview.png")
    assert page.locator(".kanban-card").count() >= 1, "kanban cards missing"
    assert page.locator(".res-card").count() >= 2, "resource cards missing"

    # 3. Goals tab
    page.locator("button.tab", has_text="目标与计划").click()
    page.wait_for_timeout(300)
    shot(page, "02_goals.png")
    assert page.locator(".goal-block").count() >= 1, "goals missing"

    # 4. Stats tab
    page.locator("button.tab", has_text="统计").click()
    page.wait_for_timeout(300)
    shot(page, "03_stats.png")
    assert page.locator(".kpi").count() >= 5, "kpis missing"
    assert page.locator(".tx-row").count() >= 1, "ledger rows missing"

    # 5. Calendar section (embedded in overview tab)
    page.locator("button.tab", has_text="活动").click()
    page.wait_for_timeout(300)
    shot(page, "04_calendar.png")
    assert page.locator("#calendar-section .cal-day").count() >= 28, "calendar days missing"

    # 6. Timer overlay
    page.locator("button", has_text="⏱ 计时").click()
    page.wait_for_timeout(300)
    shot(page, "05_timer.png")
    assert page.locator(".timer-overlay.show").count() == 1, "timer overlay not shown"
    page.locator("[data-go]").click()
    page.wait_for_timeout(1500)
    shot(page, "06_timer_running.png")
    page.locator("[data-reset]").click()
    page.locator("[data-close]").click()
    page.wait_for_timeout(200)

    # 7. New activity modal (on overview)
    page.locator("button", has_text="＋ 活动").click()
    page.wait_for_timeout(300)
    shot(page, "07_act_modal.png")
    page.locator(".modal-mask .icon-btn").click()

    # 8. Complete modal from a Started card
    page.evaluate("()=>{App.engine.createActivity(App.db,{title:'待完成活动',note:'',plan_ids:[]});const a=App.db.activities.find(x=>x.title==='待完成活动');App.engine.startActivity(App.db,a.id);App.refresh()}")
    page.wait_for_timeout(300)
    started = page.locator('.kanban-card:has(.b-blue)')
    if started.count():
        started.first.locator("button", has_text="完成").click()
        page.wait_for_timeout(300)
        shot(page, "08_complete_modal.png")
        page.locator(".modal-mask .icon-btn").click()

    # 9. Reverse modal from ledger
    page.locator("button.tab", has_text="统计").click()
    page.wait_for_timeout(300)
    rev_btn = page.locator(".tx-row button", has_text="冲正").first
    if rev_btn.count():
        rev_btn.click()
        page.wait_for_timeout(300)
        shot(page, "09_reverse_modal.png")
        page.locator(".modal-mask .icon-btn").click()

    print("console errors:", errors if errors else "NONE")
    assert not errors, "console errors present"
    browser.close()
