"""ดึงข้อมูลฝน (เรดาร์ + forecast GFS) จากเว็บ RID Water Balance มาเก็บเป็น static file ใน data/

ใช้แค่ Python มาตรฐาน ไม่ต้อง pip install
รัน:  python fetch.py            (ดึงทั้งเรดาร์และ forecast)
      python fetch.py radar      (เฉพาะเรดาร์)
      python fetch.py forecast   (เฉพาะ forecast)
"""
import json
import os
import sys
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

BASE = "http://183.88.230.184:8002/waterbalance/data/"
OUT = Path(__file__).resolve().parent / "data"
TIMEOUT = 30
RETRY = 3


def get(path: str) -> bytes:
    url = BASE + path
    last = None
    for i in range(RETRY):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "rainmap-fetch/1.0"})
            with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
                return r.read()
        except Exception as e:  # noqa: BLE001
            last = e
            time.sleep(2 * (i + 1))
    raise RuntimeError(f"ดึง {url} ล้มเหลว: {last}")


def save(rel: str, data: bytes) -> None:
    p = OUT / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_bytes(data)


def fetch_radar() -> dict:
    raw = get("obs/radar/index.json")
    idx = json.loads(raw)
    frames = list(idx.get("frames", [])) + list(idx.get("nowcast", []))
    keep = set()
    for f in frames:
        src = f["file"]                      # obs/radar/frames/obs_....png
        name = os.path.basename(src)
        keep.add(name)
        dst = OUT / "radar" / "frames" / name
        if dst.exists() and dst.stat().st_size > 0:
            continue
        save(f"radar/frames/{name}", get(src))
        print("  radar frame", name)
    # ลบเฟรมเก่าที่ไม่อยู่ในรายการแล้ว
    fdir = OUT / "radar" / "frames"
    if fdir.exists():
        for old in fdir.glob("*.png"):
            if old.name not in keep:
                old.unlink()
    # เขียน index ของเราเอง (ตัด areas ที่ใหญ่ออก เก็บเฉพาะที่หน้าเว็บใช้)
    slim = {
        "state": idx.get("state"),
        "latest": idx.get("latest"),
        "corners": idx.get("corners"),
        "levels": idx.get("levels"),
        "units": idx.get("units"),
        "credit": idx.get("credit"),
        "motion": idx.get("motion"),
        "frames": [{"time": f["time"], "file": "radar/frames/" + os.path.basename(f["file"]), "kind": "obs"}
                   for f in idx.get("frames", [])],
        "nowcast": [{"time": f["time"], "file": "radar/frames/" + os.path.basename(f["file"]), "kind": "nowcast"}
                    for f in idx.get("nowcast", [])],
    }
    save("radar/index.json", json.dumps(slim, ensure_ascii=False).encode("utf-8"))
    return {"latest": idx.get("latest"), "frames": len(slim["frames"]), "nowcast": len(slim["nowcast"])}


def fetch_forecast() -> dict:
    meta = json.loads(get("forecast/meta.json"))
    meta.pop("leadHours", None)              # ยาวและไม่ได้ใช้
    save("forecast/meta.json", json.dumps(meta, ensure_ascii=False).encode("utf-8"))
    save("forecast/daily.bin", get("forecast/daily.bin"))
    return {"init": meta.get("init"), "source": meta.get("source"), "grid": meta.get("grid")}


def main() -> int:
    what = sys.argv[1] if len(sys.argv) > 1 else "all"
    status = {"fetched": datetime.now(timezone.utc).isoformat(timespec="seconds"), "source": BASE}
    ok = True
    if what in ("all", "radar"):
        try:
            status["radar"] = fetch_radar()
            print("radar:", status["radar"])
        except Exception as e:  # noqa: BLE001
            status["radar"] = {"error": str(e)}
            print("radar ล้มเหลว:", e)
            ok = False
    if what in ("all", "forecast"):
        try:
            status["forecast"] = fetch_forecast()
            print("forecast:", status["forecast"])
        except Exception as e:  # noqa: BLE001
            status["forecast"] = {"error": str(e)}
            print("forecast ล้มเหลว:", e)
            ok = False
    # รวมสถานะเดิม เพื่อไม่ให้ส่วนที่ไม่ได้ดึงรอบนี้หาย
    sp = OUT / "status.json"
    if sp.exists():
        try:
            old = json.loads(sp.read_text(encoding="utf-8"))
            for k in ("radar", "forecast"):
                if k not in status and k in old:
                    status[k] = old[k]
        except Exception:  # noqa: BLE001
            pass
    save("status.json", json.dumps(status, ensure_ascii=False, indent=1).encode("utf-8"))
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
