"""冒烟：F5 新建活动预填（向上取整 5 分钟格点）+ F1 到点确认条（开始/忽略/当日不再打扰）."""
from playwright.sync_api import sync_playwright
import pathlib
import datetime
import json
import math
import sys

OUT = pathlib.Path(r"c:\Users\qu\Desktop\物理科学与技术论题\TS2\personal-erp\.shots")
OUT.mkdir(exist_ok=True)
errors = []
passed = 0

def shot(page, name):
    page.screenshot(path=str(OUT / name), full_page=True)
    print("shot:", name)

def ok(label):
    global passed
    passed += 1
    print(f"{passed}) {label}: OK")

EPOCH = datetime.datetime(1970, 1, 1)
STEP = 5 * 60  # 秒

# 同 src/domain/schedule.js roundUp5：向上取整到下一个 5 分钟格点（格点保持不变）
def round_up_5_str(dt):
    secs = (dt - EPOCH).total_seconds()
    up = math.ceil(secs / STEP) * STEP
    d = EPOCH + datetime.timedelta(seconds=up)
    return d.strftime("%Y-%m-%dT%H:%M")

# F1 夹具：形状同 tests/schedule.test.js freshDB()，活动 planned_start = 现在-10s（今日）
def seed_payloads():
    now = datetime.datetime.now()
    start = (now - datetime.timedelta(seconds=10)).strftime("%Y-%m-%dT%H:%M")
    today = f"{now.year}-{now.month}-{now.day}"
    db = {
        "resources": [{"id": "r1", "name": "Token", "unit": "Token", "initial": 100,
                       "status": "Active", "created": 0}],
        "rules": [], "goals": [], "plans": [],
        "activities": [{
            "id": "a1", "title": "到期活动", "note": "", "plan_ids": [],
            "planned_date": today, "planned_start": start, "planned_minutes": 30,
            "repeat": None, "repeat_until": None, "time_logs": [], "theme": None,
            "conflicts": [], "actual_start": None, "actual_end": None,
            "status": "Planned", "created": int((now - EPOCH).total_seconds() * 1000),
        }],
        "txs": [], "outputs": [], "valueflows": [], "goods": [],
        "seq": {"r": 1, "ru": 0, "g": 0, "p": 0, "a": 1, "t": 0, "o": 0, "v": 0, "gd": 0},
    }
    prefs = {"dayGuideLast": today}  # 压制新一天引导弹层，避免遮挡确认条
    return json.dumps(db), json.dumps(prefs)

DB_JSON, PREFS_JSON = seed_payloads()
SEED_JS = (
    "localStorage.setItem('personal_erp_db_v1', %s);"
    "localStorage.setItem('personal_erp_prefs', %s);" % (json.dumps(DB_JSON), json.dumps(PREFS_JSON))
)

try:
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)

        # ---- 场景一：F5 预填（真实点击走初始化向导 → ＋ 活动）----
        page = browser.new_page(viewport={"width": 1440, "height": 960})
        page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
        page.on("pageerror", lambda e: errors.append("PAGEERROR: " + str(e)))
        page.goto("http://localhost:5173/")
        page.wait_for_load_state("domcontentloaded")
        page.wait_for_timeout(700)
        assert page.locator(".setup-card").count() == 1, "onboarding not shown"
        page.locator("[data-quick='价值元']").click()
        page.locator("#s-add").click()
        page.wait_for_timeout(200)
        assert page.evaluate("App.db.resources.length") == 1
        page.locator("#s-done").click()
        page.wait_for_timeout(400)
        assert page.locator(".kanban").count() == 1, "kanban missing after init"
        # 打开弹窗前一刻重算期望值；容忍点击瞬间跨过 5 分钟格线（多容一格）
        t_click = datetime.datetime.now()
        allowed = {round_up_5_str(t_click), round_up_5_str(t_click + datetime.timedelta(seconds=6))}
        page.locator("button", has_text="＋ 活动").click()
        page.wait_for_timeout(300)
        shot(page, "f5_act_modal.png")
        val = page.locator("input#f-ps").input_value()
        assert val in allowed, f"f-ps prefill {val} not in {sorted(allowed)}"
        ok("F5 prefill roundUp5")
        page.locator(".modal-mask .icon-btn").click()

        # ---- 场景二/三夹具：localStorage 预置到期 Planned 活动（页面脚本运行前注入）----
        ctx2 = browser.new_context(viewport={"width": 1440, "height": 960})
        ctx2.add_init_script(SEED_JS)

        # ---- 场景二：F1 确认条出现 → 开始 → 状态落库 ----
        pg = ctx2.new_page()
        pg.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
        pg.on("pageerror", lambda e: errors.append("PAGEERROR: " + str(e)))
        pg.goto("http://localhost:5173/")
        pg.wait_for_load_state("domcontentloaded")
        pg.wait_for_selector("#ap-confirm-bar", state="visible", timeout=8000)
        shot(pg, "f1_confirm_bar.png")
        bar = pg.locator("#ap-confirm-bar")
        assert "到期活动" in bar.inner_text(), "confirm bar missing activity title"
        assert bar.locator("[data-ap-start]", has_text="开始").count() == 1, "开始 button missing"
        assert bar.locator("[data-ap-skip]", has_text="忽略").count() == 1, "忽略 button missing"
        ok("F1 confirm bar shown with 开始/忽略")
        bar.locator("[data-ap-start]").click()
        pg.wait_for_timeout(600)
        st = pg.evaluate(
            "()=>{const db=JSON.parse(localStorage.getItem('personal_erp_db_v1'));"
            "const a=db.activities.find(x=>x.id==='a1');return {status:a.status,actual_start:a.actual_start};}"
        )
        assert st["status"] == "Started" and (st["actual_start"] or 0) > 0, f"not started: {st}"
        ok("F1 开始 → status Started + actual_start>0")
        pg.close()

        # ---- 场景三：忽略 → 条消失；同日重载不再打扰 ----
        ctx3 = browser.new_context(viewport={"width": 1440, "height": 960})
        ctx3.add_init_script(SEED_JS)
        pg = ctx3.new_page()
        pg.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
        pg.on("pageerror", lambda e: errors.append("PAGEERROR: " + str(e)))
        pg.goto("http://localhost:5173/")
        pg.wait_for_load_state("domcontentloaded")
        pg.wait_for_selector("#ap-confirm-bar", state="visible", timeout=8000)
        pg.locator("#ap-confirm-bar [data-ap-skip]").click()
        pg.wait_for_timeout(300)
        assert pg.locator("#ap-confirm-bar").count() == 0, "bar not dismissed"
        ok("F1 忽略 → bar dismissed")
        pg.reload()
        pg.wait_for_load_state("domcontentloaded")
        pg.wait_for_timeout(3500)  # 覆盖首巡检延迟 1500ms + 余量
        assert pg.locator("#ap-confirm-bar").count() == 0, "bar reappeared same day after dismiss"
        shot(pg, "f1_dismissed_reload.png")
        ok("F1 reload same day → no re-prompt")

        print("console errors:", errors if errors else "NONE")
        assert not errors, "console errors present"
        browser.close()
    print(f"F1F5 SMOKE PASS ({passed} assertions)")
except AssertionError as e:
    print(f"F1F5 SMOKE FAIL: {e}")
    sys.exit(1)
