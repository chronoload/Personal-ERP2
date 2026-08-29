from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    b = p.chromium.launch(headless=True)
    pg = b.new_page(viewport={"width": 390, "height": 844})
    pg.goto("http://localhost:5173/")
    pg.wait_for_load_state("domcontentloaded")
    pg.wait_for_timeout(700)
    pg.evaluate("()=>{App.engine.createResource(App.db,{name:'价值元',unit:'价值元',initial:1000});App.refresh()}")
    pg.wait_for_timeout(300)
    # 滑到看板页（第 2 页）
    pg.evaluate("()=>{const p=document.querySelector('.dash-pager');const t0=new Touch({identifier:1,target:p,clientX:300});const t1=new Touch({identifier:1,target:p,clientX:60});p.dispatchEvent(new TouchEvent('touchstart',{touches:[t0],targetTouches:[t0],changedTouches:[t0],bubbles:true}));p.dispatchEvent(new TouchEvent('touchend',{touches:[],targetTouches:[],changedTouches:[t1],bubbles:true}))}")
    pg.wait_for_timeout(300)
    idx_before = pg.evaluate("()=>[...document.querySelectorAll('.dash-nav-item')].findIndex(b=>b.classList.contains('on'))")
    # 切走再切回
    pg.evaluate("()=>{App.setTab('goals');App.setTab('overview')}")
    pg.wait_for_timeout(300)
    idx_after = pg.evaluate("()=>[...document.querySelectorAll('.dash-nav-item')].findIndex(b=>b.classList.contains('on'))")
    print("idx_before:", idx_before, "idx_after:", idx_after)
    b.close()
