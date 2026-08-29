"""同惠链路 E2E: 目标→计划→活动→开始→完成(流水+产出)→产出归档→价值流反馈闭环."""
from playwright.sync_api import sync_playwright

BASE = "http://localhost:5173/"

def js(pg, expr, arg=None):
    return pg.evaluate(expr) if arg is None else pg.evaluate(expr, arg)

with sync_playwright() as p:
    b = p.chromium.launch(headless=True)
    pg = b.new_page(viewport={"width": 1440, "height": 960})
    errs = []
    pg.on("pageerror", lambda e: errs.append("PAGEERROR " + str(e)))
    pg.on("console", lambda m: errs.append(m.text) if m.type == "error" else None)

    pg.goto(BASE)
    pg.wait_for_load_state("domcontentloaded")
    pg.wait_for_timeout(700)

    # 初始化资源（模拟首次配置）：价值元 + 时间 + 基础目标（离开初始化页）
    pg.evaluate("()=>{App.engine.createResource(App.db,{name:'价值元',unit:'价值元',initial:1000});App.engine.createResource(App.db,{name:'时间',unit:'小时',initial:168});App.engine.createGoal(App.db,{title:'基础目标',desc:''});App.refresh()}")
    pg.wait_for_timeout(200)

    token_before = js(pg, "App.engine.balanceOf(App.db,'r1')")
    print("token before:", token_before)

    # 1) 新建目标（目标与计划 Tab 板块内按钮）
    pg.locator("button.tab", has_text="目标与计划").click()
    pg.wait_for_timeout(250)
    pg.locator("button", has_text="＋ 新建目标").click()
    pg.fill("#f-gname", "测试目标 E2E")
    pg.locator(".modal-foot [data-save]").click()
    pg.wait_for_timeout(200)
    assert js(pg, "App.db.goals.some(g=>g.title==='测试目标 E2E')"), "goal not created"

    # 2) 新建计划（预算 30，挂在该目标下）
    pg.locator(".goal-block", has_text="测试目标 E2E").locator("button", has_text="＋ 计划").click()
    pg.fill("#f-pname", "测试计划 E2E")
    pg.fill("#f-pbudget", "30")
    pg.locator(".modal-foot [data-save]").click()
    pg.wait_for_timeout(200)
    pid = js(pg, "(id)=>App.db.plans.find(p=>p.title===id).id", "测试计划 E2E")
    assert js(pg, "(id)=>App.db.plans.find(p=>p.id===id).goal_id", pid) == js(pg, "(t)=>App.db.goals.find(g=>g.title===t).id", "测试目标 E2E")
    print("plan:", pid)

    # 3) 新建活动并关联该计划（活动 Tab 看板板块内按钮）
    pg.locator("button.tab", has_text="活动").click()
    pg.wait_for_timeout(250)
    pg.locator("button", has_text="＋ 活动").click()
    pg.fill("#f-aname", "E2E 写章节")
    pg.locator(".chk-group input[value='%s']" % pid).check()
    pg.locator(".modal-foot [data-save]").click()
    pg.wait_for_timeout(200)
    aid = js(pg, "(t)=>App.db.activities.find(a=>a.title===t).id", "E2E 写章节")
    assert js(pg, "(id)=>App.db.activities.find(a=>a.id===id).status", aid) == "Planned"
    print("activity:", aid)

    # 4) 开始
    js(pg, "(id)=>{App.engine.startActivity(App.db, id); App.refresh()}", aid)
    pg.wait_for_timeout(300)
    assert js(pg, "(id)=>App.db.activities.find(a=>a.id===id).status", aid) == "Started"
    print("started ok")

    # 5) 完成（支出 + 收入 + 产出）
    pg.locator('.kanban-card', has_text="E2E 写章节").locator("button", has_text="完成").click()
    pg.wait_for_timeout(250)
    # 语境提速：产出标题默认预填为活动标题
    assert pg.locator("#f-cout").input_value() == "E2E 写章节", "output title should prefill activity title"
    pg.fill("#f-ce_amt", "12")
    pg.fill("#f-ce_note", "E2E 消耗")
    pg.fill("#f-ci_amt", "3")
    pg.fill("#f-ci_note", "E2E 回充")
    pg.fill("#f-cout", "E2E 产出文档")
    pg.fill("#f-ctags", "E2E,测试")
    pg.locator(".modal-foot [data-save]").click()
    pg.wait_for_timeout(300)
    assert js(pg, "(id)=>App.db.activities.find(a=>a.id===id).status", aid) == "Completed", "not completed"
    # 支出12 + 收入3 → 净值 -9
    token_after_complete = js(pg, "App.engine.balanceOf(App.db,'r1')")
    assert token_after_complete == token_before - 9, f"token should net -9 (expense12 income3), got {token_after_complete}"
    print("complete with expense+income: token", token_after_complete)
    oid = js(pg, "(id)=>App.db.outputs.find(o=>o.activity_id===id).id", aid)
    assert js(pg, "(id)=>App.db.activities.find(a=>a.id===id).actual_end != null", aid)
    print("completed ok, output:", oid)

    # 6) 复盘 → 产出归档 → 自动生成价值流
    js(pg, "(id)=>{App.engine.setActivityStatus(App.db, id, 'Reviewed'); App.refresh()}", aid)
    js(pg, "(id)=>{App.engine.setOutputStatus(App.db, id, 'Published'); App.engine.setOutputStatus(App.db, id, 'Archived'); App.refresh()}", oid)
    pg.wait_for_timeout(300)
    vfs = js(pg, "(id)=>App.db.valueflows.filter(v=>v.output_id===id)", oid)
    assert len(vfs) == 1, "valueflow not auto-created"
    vf = vfs[0]
    assert vf["status"] == "Pending", "vf should be Pending"
    print("valueflow auto-created:", vf["id"])

    # 7) 价值流反馈闭环（回充 +10）
    token_before_close = js(pg, "App.engine.balanceOf(App.db,'r1')")
    js(pg, "(id)=>{App.engine.closeValueflow(App.db, id, {feedback:'好', recharge:true})}", vf["id"])
    token_after_close = js(pg, "App.engine.balanceOf(App.db,'r1')")
    assert token_after_close == token_before_close + 10, "recharge +10 failed"
    assert js(pg, "(id)=>App.db.valueflows.find(v=>v.id===id).status", vf["id"]) == "Closed"
    print("valueflow closed, token:", token_after_close)

    # 8) 完成模态语境提速：金额记忆 + 标签联想点选
    js(pg, "(id)=>{App.engine.createActivity(App.db, {title:'E2E 语境活动', note:'', plan_ids:[id]}); App.refresh()}", pid)
    aidc = js(pg, "(t)=>App.db.activities.find(a=>a.title===t).id", "E2E 语境活动")
    js(pg, "(id)=>{App.engine.startActivity(App.db, id); App.refresh()}", aidc)
    pg.locator('.kanban-card', has_text="E2E 语境活动").locator("button", has_text="完成").click()
    pg.wait_for_timeout(250)
    assert pg.locator("#f-cout").input_value() == "E2E 语境活动", "output title prefill"
    assert pg.locator("#f-ci_amt").input_value() == "3", "income amount should be remembered"
    assert pg.locator(".tag-chip").count() >= 1, "tag suggestions should appear"
    pg.locator(".tag-chip", has_text="测试").click()
    assert "测试" in pg.locator("#f-ctags").input_value(), "tag chip should append"
    pg.locator(".modal-foot [data-cancel]").click()
    pg.wait_for_timeout(200)
    print("8) complete modal context speed-up: OK")

    # 9) 预算硬约束（不变量4）
    js(pg, "(id)=>{App.engine.createActivity(App.db, {title:'E2E 第二活动', note:'', plan_ids:[id]}); App.refresh()}", pid)
    aid2 = js(pg, "(t)=>App.db.activities.find(a=>a.title===t).id", "E2E 第二活动")
    js(pg, "(id)=>{App.engine.startActivity(App.db, id); App.refresh()}", aid2)
    js(pg, "(id)=>{App.engine.completeActivity(App.db, id, {expense:{resource_id:'r1',amount:18,note:''},output_title:'o2',output_tags:[]}); App.refresh()}", aid2)
    assert js(pg, "(id)=>App.engine.isPlanBlocked(App.db, id)", pid) is True, "budget should be blocked"
    js(pg, "(id)=>{App.engine.createActivity(App.db, {title:'E2E 第三活动', note:'', plan_ids:[id]}); App.refresh()}", pid)
    aid3 = js(pg, "(t)=>App.db.activities.find(a=>a.title===t).id", "E2E 第三活动")
    r = js(pg, "(id)=>App.engine.startActivity(App.db, id)", aid3)
    assert r["ok"] is False, "should be blocked by budget invariant 4"
    print("budget hard-constraint verified")

    print("ERRORS:", errs if errs else "NONE")
    print("ALL GOLDEN-PATH E2E PASSED")
    b.close()
