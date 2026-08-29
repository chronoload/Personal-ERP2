"""备份/恢复 E2E：序列化 → 改数据 → parse 还原 → 数据完整."""
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    b = p.chromium.launch(headless=True)
    pg = b.new_page(viewport={"width": 1440, "height": 960})
    errs = []
    pg.on("pageerror", lambda e: errs.append("PAGEERROR " + str(e)))
    pg.on("console", lambda m: errs.append(m.text) if m.type == "error" else None)
    pg.goto("http://localhost:5173/")
    pg.wait_for_load_state("domcontentloaded")
    pg.wait_for_timeout(800)

    # 快照 A
    snap = pg.evaluate("App.backup.serialize(App.db)")
    n_before = pg.evaluate("App.db.activities.length")
    bal_before = pg.evaluate("App.engine.balanceOf(App.db,'r1')")
    print("snapshot len:", len(snap), "| acts:", n_before, "| token:", bal_before)

    # 校验 parse 接受自身格式
    assert pg.evaluate("(s)=>App.backup.parse(s).ok", snap) is True, "parse own backup failed"

    # 改动数据：加一个活动 + 目标
    pg.evaluate("(t)=>{App.engine.createGoal(App.db,{title:t,desc:''});App.engine.createActivity(App.db,{title:t+'活动',note:'',plan_ids:[]});App.refresh()}", "BACKUP_PROBE")
    assert pg.evaluate("App.db.goals.some(g=>g.title==='BACKUP_PROBE')") is True
    print("probe added, goals now:", pg.evaluate("App.db.goals.length"))

    # 还原快照 A
    parsed = pg.evaluate("(s)=>App.backup.parse(s)", snap)
    pg.evaluate("(db)=>{App.restore(db)}", parsed["db"])
    pg.wait_for_timeout(300)

    # 验证：probe 消失，原数据完整，seq 修复
    assert pg.evaluate("App.db.goals.some(g=>g.title==='BACKUP_PROBE')") is False, "probe not removed after restore"
    assert pg.evaluate("App.db.activities.length") == n_before, "activities count mismatch"
    assert pg.evaluate("App.engine.balanceOf(App.db,'r1')") == bal_before, "balance mismatch"
    # 还原后 seq 足够大，能继续新增不冲突
    pg.evaluate("(t)=>{App.engine.createGoal(App.db,{title:t,desc:''});App.refresh()}", "POST_RESTORE")
    assert pg.evaluate("App.db.goals.some(g=>g.title==='POST_RESTORE')") is True
    ids = pg.evaluate("App.db.goals.map(g=>g.id)")
    assert len(set(ids)) == len(ids), "duplicate ids after restore"
    print("post-restore create ok, total goals:", len(ids))

    # 非法备份被拒
    assert pg.evaluate("App.backup.parse('{not json').ok") is False
    assert pg.evaluate("App.backup.parse('{\"foo\":1}').ok") is False
    print("invalid backup rejected")

    print("ERRORS:", errs if errs else "NONE")
    print("BACKUP ROUNDTRIP PASSED")
    b.close()
