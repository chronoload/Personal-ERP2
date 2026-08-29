"""交互反馈 E2E：看板首位 / Tab 滑动切换 / 刷新保滚动 / 级联删除."""
from playwright.sync_api import sync_playwright

def js(pg, expr, arg=None):
    return pg.evaluate(expr) if arg is None else pg.evaluate(expr, arg)

def swipe(pg, x1, y1, x2, y2):
    """合成 TouchEvent 模拟横向滑动（Chromium 支持 Touch 构造）。"""
    pg.evaluate("""([x1,y1,x2,y2]) => {
      const el = document.getElementById('content');
      const t0 = new Touch({identifier:1, target:el, clientX:x1, clientY:y1});
      const t1 = new Touch({identifier:1, target:el, clientX:x2, clientY:y2});
      el.dispatchEvent(new TouchEvent('touchstart', {touches:[t0], targetTouches:[t0], changedTouches:[t0], bubbles:true}));
      el.dispatchEvent(new TouchEvent('touchend', {touches:[], targetTouches:[], changedTouches:[t1], bubbles:true}));
    }""", [x1, y1, x2, y2])

with sync_playwright() as p:
    b = p.chromium.launch(headless=True)
    pg = b.new_page(viewport={"width": 390, "height": 844})
    errs = []
    pg.on("pageerror", lambda e: errs.append("PAGEERROR " + str(e)))
    pg.on("console", lambda m: errs.append(m.text) if m.type == "error" else None)
    pg.goto("http://localhost:5173/")
    pg.wait_for_load_state("domcontentloaded")
    pg.wait_for_timeout(800)

    # 初始化：建资源离开初始化页（空种子下主界面才渲染）
    pg.evaluate("()=>{App.engine.createResource(App.db,{name:'价值元',unit:'价值元',initial:1000});App.refresh()}")
    pg.wait_for_timeout(300)

    # 1) 日历（含当日日程）排第一顺位，看板第二，资源最后
    txt = js(pg, "document.querySelector('#content').innerText")
    cal_idx = txt.find("日历 · 当日日程")
    kanban_idx = txt.find("五态：Planned")  # 看板卡片特征文案（避免命中导航胶囊）
    res_idx = txt.find("资源状态")
    assert 0 <= cal_idx < kanban_idx < res_idx, "calendar(day agenda) should be before kanban"
    assert pg.locator("#calendar-section .cal-agenda").count() == 1, "day agenda panel missing"
    assert pg.locator("#calendar-section .cal-day").count() >= 28, "calendar days missing"
    print("1) calendar with day agenda first, kanban second: OK")

    # 1b) 并列翻页：容器高度 = 当前页内容 + 顶部导航高度（自动播放下当前页可能为 0 或 1）
    okh = js(pg, "()=>{const p=document.querySelector('.dash-pager');const pages=p.querySelectorAll('.dash-page');const nav=p.querySelector('.dash-nav');const idx=[...p.querySelectorAll('.dash-nav-item')].findIndex(b=>b.classList.contains('on'));const h=(pages[idx].offsetHeight+(nav?nav.offsetHeight:0))+'px';return p && pages.length===2 && idx>=0 && p.style.height===h}")
    assert okh is True, "pager height should follow active page + nav height"
    print("1b) pager dynamic height: OK")

    # 2) Tab 左右滑动切换（左滑 → 目标与计划）
    assert js(pg, "App.tab") == "overview"
    swipe(pg, 300, 300, 60, 300)
    pg.wait_for_timeout(300)
    assert js(pg, "App.tab") == "goals", "swipe left should switch to goals"
    swipe(pg, 60, 300, 300, 300)  # 右滑回 overview
    pg.wait_for_timeout(300)
    assert js(pg, "App.tab") == "overview"
    print("2) swipe tab switch: OK")

    # 3) 刷新保持滚动位置
    pg.evaluate("window.scrollTo(0, document.body.scrollHeight)")
    pg.wait_for_timeout(200)
    before = pg.evaluate("window.scrollY")
    pg.evaluate("App.refresh()")
    pg.wait_for_timeout(400)
    after = pg.evaluate("window.scrollY")
    assert after >= before - 4, f"scroll not preserved: before={before} after={after}"
    print(f"3) scroll preserved {before}->{after}: OK")

    # 4) 级联删除计划（带确认框）：目标+计划+活动
    pg.evaluate("(t)=>{App.engine.createGoal(App.db,{title:t,desc:''});App.refresh()}", "级联测试目标")
    gid = js(pg, "(t)=>App.db.goals.find(g=>g.title===t).id", "级联测试目标")
    pg.evaluate("(id)=>{App.engine.createPlan(App.db,{goal_id:id,title:'级联测试计划',budget:null});App.refresh()}", gid)
    pid = js(pg, "(t)=>App.db.plans.find(pl=>pl.title===t).id", "级联测试计划")
    pg.evaluate("(id)=>{App.engine.createActivity(App.db,{title:'级联活动',note:'',plan_ids:[id]});App.refresh()}", pid)
    pg.once("dialog", lambda d: d.accept())
    pg.evaluate("(id)=>{App.goals.delPlan(id)}", pid)
    pg.wait_for_timeout(500)
    assert not js(pg, "(id)=>App.db.plans.some(pl=>pl.id===id)", pid), "plan not deleted"
    assert not js(pg, "App.db.activities.some(a=>a.title==='级联活动')"), "activity not cascade-deleted"
    print("4) cascade delete plan: OK")

    # 5) 级联删除目标
    pg.once("dialog", lambda d: d.accept())
    pg.evaluate("(id)=>{App.goals.delGoal(id)}", gid)
    pg.wait_for_timeout(500)
    assert not js(pg, "(id)=>App.db.goals.some(g=>g.id===id)", gid), "goal not deleted"
    print("5) cascade delete goal: OK")

    # 6) 目标/计划可收起展开（校验真实隐藏而非仅 class）
    pg.locator("button.tab", has_text="目标与计划").click()
    pg.wait_for_timeout(300)
    pg.evaluate("()=>{App.engine.createGoal(App.db,{title:'折叠目标',desc:''});const g=App.db.goals.find(x=>x.title==='折叠目标');App.engine.createPlan(App.db,{goal_id:g.id,title:'折叠计划',budget:null});App.refresh()}")
    pg.wait_for_timeout(300)
    gid2 = js(pg, "(t)=>App.db.goals.find(g=>g.title===t).id", "折叠目标")
    pid2 = js(pg, "(t)=>App.db.plans.find(p=>p.title===t).id", "折叠计划")
    assert js(pg, "(id)=>document.querySelector('.plan-card .plan-details')!==null", None) is True
    # 折叠计划：内容真正隐藏
    pg.evaluate("(id)=>{App.goals.togglePlan(id)}", pid2)
    pg.wait_for_timeout(250)
    assert js(pg, "()=>{const d=document.querySelectorAll('.plan-card')[0].querySelector('.plan-details');return d.offsetParent===null}") is True, "plan not visually hidden"
    # 展开计划
    pg.evaluate("(id)=>{App.goals.togglePlan(id)}", pid2)
    pg.wait_for_timeout(250)
    assert js(pg, "()=>{const d=document.querySelectorAll('.plan-card')[0].querySelector('.plan-details');return d.offsetParent!==null}") is True, "plan not expanded"
    # 折叠目标（计划区整体隐藏）
    pg.evaluate("(id)=>{App.goals.toggleGoal(id)}", gid2)
    pg.wait_for_timeout(250)
    assert js(pg, "()=>{const d=document.querySelectorAll('.goal-block')[0].querySelector('.goal-plans');return d.offsetParent===null}") is True, "goal not visually hidden"
    print("6) goal/plan collapse: OK")

    # 7) 任务卡片：备注显示 + 虚化主题背景（渐变）
    pg.evaluate("(t)=>{App.engine.createActivity(App.db,{title:'主题卡片',note:'这是卡片备注',theme:{type:'gradient',value:'linear-gradient(135deg,#f6d365 0%,#fda085 100%)'}});App.refresh()}", None)
    pg.wait_for_timeout(300)
    pg.evaluate("()=>{App.setTab('overview')}")
    pg.wait_for_timeout(300)
    card = js(pg, "()=>{const c=[...document.querySelectorAll('.kanban-card')].find(x=>x.innerText.includes('主题卡片'));return c?c.outerHTML:''}")
    assert "这是卡片备注" in card, "note not shown on card"
    assert "kc-bg" in card, "card theme layer missing"
    assert "themed" in card, "card not themed"
    # 亮色渐变（晨曦）→ 保持深字（无 tone-light）
    assert "tone-light" not in card, "light gradient should keep dark text"
    # 暗色渐变（深海）→ 智能切换白字（tone-light）
    pg.evaluate("()=>{const a=App.db.activities.find(x=>x.title==='主题卡片');App.engine.updateActivity(App.db,a.id,{title:'主题卡片',theme:{type:'gradient',value:'linear-gradient(135deg,#2b5876 0%,#4e4376 100%)'}});App.refresh()}")
    pg.wait_for_timeout(300)
    cardD = js(pg, "()=>{const c=[...document.querySelectorAll('.kanban-card')].find(x=>x.innerText.includes('主题卡片'));return c?c.className:''}")
    assert "tone-light" in cardD, "dark gradient should switch to white text"
    print("7) card note + gradient theme + smart contrast: OK")

    # 8) 卡片主题切换为图片资源（image type）
    pg.evaluate("()=>{const a=App.db.activities.find(x=>x.title==='主题卡片');App.engine.updateActivity(App.db,a.id,{title:'主题卡片',theme:{type:'image',url:'data:image/png;base64,iVBORw0KGgo'}});App.refresh()}")
    pg.wait_for_timeout(300)
    card2 = js(pg, "()=>{const c=[...document.querySelectorAll('.kanban-card')].find(x=>x.innerText.includes('主题卡片'));return c?c.outerHTML:''}")
    assert "kc-bg" in card2 and "themed" in card2, "image theme not applied"
    assert js(pg, "(t)=>App.db.activities.find(x=>x.title===t).theme.type", "主题卡片") == "image", "theme type not image"
    print("8) card image theme: OK")

    # 9) 全局背景主题（图片/渐变 → body 背景原样铺底）
    pg.evaluate("()=>{App.stats.setGlobalTheme({type:'gradient',value:'linear-gradient(135deg,#4facfe 0%,#00f2fe 100%)'});}")
    pg.wait_for_timeout(300)
    assert "linear-gradient" in js(pg, "()=>document.body.style.background"), "global theme not applied to body"
    assert js(pg, "()=>document.getElementById('bg-overlay')===null") is True, "bg-overlay should be removed"
    pg.evaluate("()=>{App.stats.clearGlobalTheme()}")
    pg.wait_for_timeout(300)
    assert js(pg, "()=>document.body.style.background") == "", "global theme not cleared"
    print("9) global background theme: OK")

    # 10) 计时进度条：time_logs vs 计划分钟
    pg.evaluate("()=>{const a=App.db.activities.find(x=>x.title==='主题卡片');App.engine.updateActivity(App.db,a.id,{title:'主题卡片',planned_minutes:60});a.time_logs=[{start:Date.now()-30*60e3,end:Date.now()}];App.refresh()}")
    pg.wait_for_timeout(300)
    cardP = js(pg, "()=>{const c=[...document.querySelectorAll('.kanban-card')].find(x=>x.innerText.includes('主题卡片'));return c?c.outerHTML:''}")
    assert "kc-time-progress" in cardP, "time progress bar missing"
    w = js(pg, "()=>{const c=[...document.querySelectorAll('.kanban-card')].find(x=>x.innerText.includes('主题卡片'));const b=c?.querySelector('.kc-time-progress .bar');return b?b.style.width:''}")
    assert w == "50%", f"progress width wrong: {w}"
    print("10) timer progress bar: OK")

    # 11) 计划展开显示活动 + 卡片信息格式（目标：计划名）
    pg.evaluate("(id)=>{App.goals.toggleGoal(id)}", gid2)  # 展开折叠目标（测试6末尾是收起态）
    pg.evaluate("(id)=>{App.engine.createActivity(App.db,{title:'计划下活动E2E',note:'',plan_ids:[id]});App.refresh()}", pid2)
    pg.wait_for_timeout(300)
    pg.evaluate("()=>{App.setTab('goals')}")
    pg.wait_for_timeout(300)
    planHtml = js(pg, "()=>{const p=[...document.querySelectorAll('.plan-card')].find(x=>x.innerText.includes('折叠计划'));return p?p.outerHTML:''}")
    assert "计划下活动E2E" in planHtml, "plan should list its activities when expanded"
    pg.evaluate("()=>{App.setTab('overview')}")
    pg.wait_for_timeout(300)
    actHtml = js(pg, "()=>{const c=[...document.querySelectorAll('.kanban-card')].find(x=>x.innerText.includes('计划下活动E2E'));return c?c.outerHTML:''}")
    assert "折叠目标：折叠计划" in actHtml, "activity meta should show 目标：计划名"
    print("11) plan activity list + goal:plan format: OK")

    # 12) 「记到现在」按钮：绑定活动显示 / 通用计时隐藏
    pg.evaluate("()=>{const a=App.db.activities[0];App.timer.openForActivity(a.id)}")
    pg.wait_for_timeout(250)
    assert js(pg, "()=>document.getElementById('t-now').style.display") == "inline-block", "record-now should show for bound activity"
    pg.locator(".timer-overlay [data-close]").click()
    pg.wait_for_timeout(200)
    pg.evaluate("()=>{App.timer.open()}")
    pg.wait_for_timeout(250)
    assert js(pg, "()=>document.getElementById('t-now').style.display") == "none", "record-now should hide for general timer"
    pg.locator(".timer-overlay [data-close]").click()
    pg.wait_for_timeout(200)
    print("12) record-now button: OK")

    # 13) 目标与计划无 [object Object] 乱码 + 日历日程空白快捷新建
    pg.evaluate("()=>{App.setTab('goals')}")
    pg.wait_for_timeout(300)
    goalsTxt = js(pg, "document.querySelector('#content').innerText")
    assert "[object Object]" not in goalsTxt, "goals tab should not show [object Object]"
    pg.evaluate("()=>{App.setTab('overview')}")
    pg.wait_for_timeout(300)
    pg.evaluate("()=>document.querySelector('.cal-agenda').dispatchEvent(new MouseEvent('click',{bubbles:true}))")
    pg.wait_for_timeout(300)
    assert pg.locator(".modal-mask").count() == 1, "clicking agenda blank should open quick-add"
    assert js(pg, "()=>{const v=document.querySelector('#f-ps')?.value;return v? v.endsWith('T09:00'):false}") is True, "quick-add should prefill 09:00"
    pg.locator(".modal-mask .icon-btn").click()
    pg.wait_for_timeout(200)
    print("13) no [object Object] + calendar quick-add: OK")

    # 14) 翻月不出现 undefined 月/日
    pg.evaluate("()=>{document.querySelector('[data-cal=next]').click()}")
    pg.wait_for_timeout(200)
    headTxt = js(pg, "()=>document.querySelector('.cal-agenda .agenda-head').innerText")
    assert "undefined" not in headTxt, "calendar month flip should not show undefined"
    print("14) calendar month flip no undefined: OK")

    # 15) 轮播右边界左滑 → 回退为 Tab 切换（切到目标与计划）
    def pager_swipe():
        pg.evaluate("""()=>{const p=document.querySelector('.dash-pager');
          const t0=new Touch({identifier:1,target:p,clientX:300});const t1=new Touch({identifier:1,target:p,clientX:60});
          p.dispatchEvent(new TouchEvent('touchstart',{touches:[t0],targetTouches:[t0],changedTouches:[t0],bubbles:true}));
          p.dispatchEvent(new TouchEvent('touchend',{touches:[],targetTouches:[],changedTouches:[t1],bubbles:true}))}""")
    pg.evaluate("()=>{App.setTab('overview')}")
    pg.wait_for_timeout(300)
    # 停自动播放并回到日程页，保证测试确定性
    pg.evaluate("()=>{const b=[...document.querySelectorAll('.dash-nav-item')].find(x=>x.textContent.includes('当日日程'));b&&b.click()}")
    pg.wait_for_timeout(200)
    pager_swipe()  # 日程 → 看板
    pg.wait_for_timeout(300)
    assert js(pg, "()=>[...document.querySelectorAll('.dash-nav-item')].findIndex(b=>b.classList.contains('on'))") == 1, "should be on kanban page"
    pager_swipe()  # 右边界左滑 → 回退 Tab
    pg.wait_for_timeout(300)
    assert js(pg, "App.tab") == "goals", "right-boundary left-swipe should switch to goals tab"
    print("15) pager boundary -> tab fallback: OK")

    # 16) 聚焦活动 Tab：轮播自动播放（每 2s 循环）+ 用户一碰即停
    pg.evaluate("()=>{App.setTab('overview')}")
    pg.wait_for_timeout(400)
    cur = lambda: js(pg, "()=>[...document.querySelectorAll('.dash-nav-item')].findIndex(b=>b.classList.contains('on'))")
    assert cur() == 0, "should start on page 0"
    pg.wait_for_timeout(2400)  # 等一个自动播放周期（2s）
    assert cur() == 1, "autoplay should advance to kanban page"
    pg.evaluate("()=>{document.querySelector('.dash-pager').dispatchEvent(new TouchEvent('touchstart',{touches:[],bubbles:true}))}")
    pg.wait_for_timeout(2300)  # 又一个周期，若未停应已回绕到 page 0
    assert cur() == 1, "autoplay should stop after user touch"
    print("16) pager autoplay: OK")

    print("ERRORS:", errs if errs else "NONE")
    print("INTERACTION FEEDBACK E2E PASSED")
    b.close()
