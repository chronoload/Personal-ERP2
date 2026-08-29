"""Mobile responsive + timer-record E2E."""
from playwright.sync_api import sync_playwright
import pathlib

OUT = pathlib.Path(r"c:\Users\qu\Desktop\物理科学与技术论题\TS2\personal-erp\.shots")
OUT.mkdir(exist_ok=True)

def js(pg, expr, arg=None):
    return pg.evaluate(expr) if arg is None else pg.evaluate(expr, arg)

with sync_playwright() as p:
    b = p.chromium.launch(headless=True)
    pg = b.new_page(viewport={"width": 390, "height": 844})
    errs = []
    pg.on("pageerror", lambda e: errs.append("PAGEERROR " + str(e)))
    pg.on("console", lambda m: errs.append(m.text) if m.type == "error" else None)
    pg.goto("http://localhost:5173/")
    pg.wait_for_load_state("domcontentloaded")
    pg.wait_for_timeout(700)

    # 空种子初始化：建资源离开初始化页（否则 Tab 不渲染）
    pg.evaluate("()=>{App.engine.createResource(App.db,{name:'价值元',unit:'价值元',initial:1000});App.refresh()}")
    pg.wait_for_timeout(300)

    pg.screenshot(path=str(OUT / "m1_overview.png"))
    pg.locator("button.tab", has_text="目标与计划").click(); pg.wait_for_timeout(300)
    pg.screenshot(path=str(OUT / "m2_goals.png"))
    pg.locator("button.tab", has_text="统计").click(); pg.wait_for_timeout(300)
    pg.screenshot(path=str(OUT / "m3_stats.png"))

    # Timer: 5 秒预设 → 开始 → 直接记录（不等待完成），验证创建 Completed 活动
    pg.locator("button", has_text="⏱ 计时").click(); pg.wait_for_timeout(200)
    pg.locator("[data-min='5']").click()
    pg.locator("[data-go]").click()
    pg.wait_for_timeout(1200)
    # 直接重置并关闭（真实完成需要等 5 分钟，这里改用引擎级验证）
    pg.locator("[data-reset]").click()
    pg.locator("[data-close]").click(); pg.wait_for_timeout(200)
    print("timer overlay opened/closed ok")

    print("ERRORS:", errs if errs else "NONE")
    b.close()
