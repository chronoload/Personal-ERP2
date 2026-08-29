"""
Personal ERP 局域网同步服务（单文件，零数据库）
================================================
用法：
    python sync_server.py [--host 0.0.0.0] [--port 6907] [--dir ./sync_data]

端点：
    GET  /health          健康检查
    GET  /backup          拉取最新备份（返回备份 JSON；无备份返回 404）
    PUT  /backup          推送备份（body = 备份 JSON；服务器更新则 409 冲突）
    GET  /backup/history  列出历史备份（冗余清单）

冗余：每次推送保存为带时间戳的文件 backup_YYYYMMDDHHMMSS.json，保留最近 MAX_BACKUPS 份。
防冲突：比较 exportedAt（客户端数据时间戳）——服务器更新则拒绝并返回服务器版本，
        由客户端决定覆盖或先拉取合并（双保险：客户端推送前也会先比较）。
"""
import argparse
import json
import time
from pathlib import Path

from fastapi import FastAPI, Request, Response
from fastapi.responses import JSONResponse

MAX_BACKUPS = 10  # 冗余：保留最近 10 份

app = FastAPI(title="Personal ERP Sync", version="1.0")
DATA_DIR = Path("sync_data")


def _latest_file():
    """最新备份 = 最后写入的文件（按 mtime，而非文件名——force 覆盖的时间戳可能更旧）"""
    files = sorted(DATA_DIR.glob("backup_*.json"), key=lambda f: f.stat().st_mtime)
    return files[-1] if files else None


def _stamp_key(exported_at: str) -> str:
    """exportedAt(ISO) → 文件名时间戳：2026-08-23T11:30:00.000Z → 20260823113000"""
    s = exported_at.replace("T", "").replace(":", "").replace("-", "").replace(".", "").replace("Z", "")
    return s[:14]


@app.get("/health")
def health():
    return {"ok": True, "time": time.time()}


@app.get("/backup")
def get_backup():
    f = _latest_file()
    if not f:
        return JSONResponse({"error": "no backup yet"}, status_code=404)
    return Response(f.read_text(encoding="utf-8"), media_type="application/json")


@app.get("/backup/history")
def history():
    files = sorted(DATA_DIR.glob("backup_*.json"), key=lambda f: f.stat().st_mtime, reverse=True)
    return [
        {"name": f.name, "size": f.stat().st_size, "mtime": f.stat().st_mtime}
        for f in files
    ]


@app.put("/backup")
async def put_backup(request: Request, force: int = 0):
    try:
        body = await request.body()
        obj = json.loads(body)
    except Exception:
        return JSONResponse({"error": "invalid json"}, status_code=400)
    if not obj.get("db") or not obj.get("exportedAt"):
        return JSONResponse({"error": "missing db/exportedAt"}, status_code=400)

    # 防冲突（服务端兜底）：服务器已有更新数据 → 409 并返回服务器版本
    # force=1 时跳过（用户已确认覆盖）
    if not force:
        cur = _latest_file()
        if cur:
            try:
                cur_obj = json.loads(cur.read_text(encoding="utf-8"))
                if cur_obj.get("exportedAt", "") > obj.get("exportedAt", ""):
                    return JSONResponse(
                        {"error": "conflict", "server": cur_obj}, status_code=409
                    )
            except Exception:
                pass

    # 冗余：按时间戳保存新文件，不覆盖旧文件
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    fname = f"backup_{_stamp_key(obj['exportedAt'])}.json"
    (DATA_DIR / fname).write_text(
        json.dumps(obj, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    # 清理：只保留最近 MAX_BACKUPS 份（按写入时间删最旧）
    files = sorted(DATA_DIR.glob("backup_*.json"), key=lambda f: f.stat().st_mtime)
    while len(files) > MAX_BACKUPS:
        files[0].unlink()
        files = files[1:]

    return {"ok": True, "name": fname, "count": len(files)}


if __name__ == "__main__":
    import uvicorn

    parser = argparse.ArgumentParser(description="Personal ERP 局域网同步服务")
    parser.add_argument("--host", default="0.0.0.0", help="监听地址（默认 0.0.0.0 允许局域网）")
    parser.add_argument("--port", type=int, default=6920, help="监听端口（默认 6920）")
    parser.add_argument("--dir", default="sync_data", help="备份存储目录（默认 ./sync_data）")
    args = parser.parse_args()
    DATA_DIR = Path(args.dir)
    print(f"Personal ERP Sync 服务启动：http://{args.host}:{args.port}  数据目录：{DATA_DIR}")
    uvicorn.run(app, host=args.host, port=args.port)