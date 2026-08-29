from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    b = p.chromium.launch(headless=True)
    pg = b.new_page(viewport={"width": 390, "height": 844})
    errs = []
    pg.on("pageerror", lambda e: errs.append(e.stack or str(e)))
    pg.goto("http://localhost:5173/")
    pg.wait_for_load_state("domcontentloaded")
    pg.wait_for_timeout(800)
    pg.evaluate("()=>{App.engine.createResource(App.db,{name:'价值元',unit:'价值元',initial:1000});App.refresh()}")
    pg.wait_for_timeout(300)
    # 开始一个 25 分钟计时（绑定活动）
    pg.evaluate("""()=>{
      App.engine.createActivity(App.db,{title:'持久计时',note:'',plan_ids:[]});
      const id=App.db.activities[0].id;
      App.timer.openForActivity(id);
      document.querySelector('[data-go]').click(); // 开始
    }""")
    pg.wait_for_timeout(400)
    s1 = pg.evaluate("""()=>{const t=JSON.parse(localStorage.getItem('personal_erp_timer'));return {mode:t.mode,endTs:t.endTs,target:t.target}}""")
    print("开始后持久化:", s1)
    ok1 = s1["mode"]=="run" and s1["endTs"]>Date.now() if False else (s1["mode"]=="run" and s1["endTs"]>__import__("time").time()*1000-1000)
    print("  endTs 在未来:", "OK" if s1["endTs"] > 1787480000000 else "?", "| mode:", s1["mode"])
    # 模拟被杀：直接重载页面（localStorage 保留）
    pg.reload()
    pg.wait_for_load_state("domcontentloaded")
    pg.wait_for_timeout(800)
    st = pg.evaluate("""()=>{
      const t=JSON.parse(localStorage.getItem('personal_erp_timer'));
      // 打开计时器看是否反映运行中
      App.timer.open();
      const go=document.querySelector('#t-go').innerText;
      const lbl=document.querySelector('#t-lbl').innerText;
      return {stillThere:!!t, mode:t&&t.mode, go, lbl};
    }""")
    print("重启后:", st)
    print("  恢复运行中:", "OK" if st["stillThere"] and st["go"]=="暂停" and st["lbl"]=="倒计时中" else "FAIL")
    # 模拟已超时：把 endTs 改到过去，重载
    pg.evaluate("""()=>{const t=JSON.parse(localStorage.getItem('personal_erp_timer'));t.endTs=Date.now()-5000;localStorage.setItem('personal_erp_timer',JSON.stringify(t));}""")
    pg.reload()
    pg.wait_for_load_state("domcontentloaded")
    pg.wait_for_timeout(800)
    st2 = pg.evaluate("""()=>{App.timer.open();return {go:document.querySelector('#t-go').style.display, done:document.querySelector('#t-done').classList.contains('show')}}""")
    print("后台到期→打开即完成态:", "OK" if st2["go"]=="none" and st2["done"] else "FAIL", st2)
    print("ERRORS:", errs if errs else "NONE")
    b.close()
