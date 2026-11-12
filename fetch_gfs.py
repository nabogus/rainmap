"""ดึงฝนคาดการณ์ GFS 0.25 องศา 15 วันจาก NOAA NOMADS โดยตรง (grib filter ตัดเฉพาะภูมิภาค)

ผลลัพธ์อยู่ในรูปแบบเดียวกับไฟล์ของระบบสมดุลน้ำ กรมชลประทาน:
  data/forecast/daily.bin  uint16 little-endian [วัน][แถว ใต้ไปเหนือ][คอลัมน์ ตะวันตกไปตะวันออก] ค่า x 0.1 = มม./วัน
  data/forecast/meta.json

วิธีคิดฝนรายวัน: ไฟล์ fNNN ของ GFS มีค่า APCP สะสมตั้งแต่ชั่วโมง 0 ถึง NNN
ฝนวันที่ k = สะสมถึง f(24k+24) ลบ สะสมถึง f(24k) จึงโหลดแค่ 15 ไฟล์ (f024, f048, ... f360)
"""
import json
import struct
import time
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

import grib2

OUT = Path(__file__).resolve().parent / "data" / "forecast"
FILTER = "https://nomads.ncep.noaa.gov/cgi-bin/filter_gfs_0p25.pl"
# กรอบภูมิภาค: พม่า ลาว เวียดนาม กัมพูชา มาเลเซีย สิงคโปร์ จีนตอนใต้ อินโดนีเซียตอนบน
WEST, EAST, SOUTH, NORTH = 90, 115, -5, 28
DAYS = 15
SCALE = 0.1
NODATA = 65535
TIMEOUT = 60
PAUSE = 0.4          # เว้นจังหวะระหว่างคำขอ ไม่ให้ถี่เกินไปกับ NOMADS


def _url(cycle: datetime, fh: int) -> str:
    ymd, hh = cycle.strftime("%Y%m%d"), cycle.strftime("%H")
    return (f"{FILTER}?dir=%2Fgfs.{ymd}%2F{hh}%2Fatmos&file=gfs.t{hh}z.pgrb2.0p25.f{fh:03d}"
            f"&var_APCP=on&lev_surface=on&subregion=&toplat={NORTH}&leftlon={WEST}&rightlon={EAST}&bottomlat={SOUTH}")


def _get(url: str, tries: int = 3) -> bytes:
    last = None
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "rainmap-fetch/1.0"})
            with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
                data = r.read()
            if data[:4] != b"GRIB":
                raise RuntimeError("คำตอบไม่ใช่ GRIB")
            return data
        except Exception as e:  # noqa: BLE001
            last = e
            time.sleep(2 * (i + 1))
    raise RuntimeError(f"ดึง GFS ล้มเหลว: {last}")


def latest_cycle(now: datetime | None = None) -> datetime:
    """รอบล่าสุดที่มีไฟล์ f360 พร้อมแล้ว (ลองย้อนทีละ 6 ชม. สูงสุด 4 รอบ)"""
    now = now or datetime.now(timezone.utc)
    c = now.replace(minute=0, second=0, microsecond=0)
    c -= timedelta(hours=c.hour % 6)
    for _ in range(5):
        try:
            _get(_url(c, DAYS * 24), tries=1)
            return c
        except Exception:  # noqa: BLE001
            c -= timedelta(hours=6)
            time.sleep(PAUSE)
    raise RuntimeError("ไม่พบรอบ GFS ที่พร้อมใช้ใน 30 ชม. ล่าสุด")


def _total(buf: bytes, fh: int):
    """ตารางฝนสะสมตั้งแต่ชั่วโมง 0 ถึง fh"""
    for m in grib2.parse(buf):
        if m.stat_type == 1 and m.forecast_hour == 0 and m.range_hours == fh:
            return m, grib2.to_rows(m)
    raise RuntimeError(f"ไม่พบค่าสะสม 0-{fh} ชม. ในไฟล์")


def current_init() -> str | None:
    p = OUT / "meta.json"
    if not p.exists() or not (OUT / "daily.bin").exists():
        return None
    try:
        m = json.loads(p.read_text(encoding="utf-8"))
        return m.get("init") if m.get("provider") == "noaa" else None
    except Exception:  # noqa: BLE001
        return None


def fetch(force: bool = False) -> dict:
    cycle = latest_cycle()
    init = cycle.strftime("%Y-%m-%dT%H:%MZ")
    if not force and current_init() == init:
        return {"init": init, "source": "gfs", "provider": "noaa", "skipped": True}

    prev = None
    msg0 = None
    days = []
    for d in range(1, DAYS + 1):
        fh = d * 24
        m, rows = _total(_get(_url(cycle, fh)), fh)
        msg0 = msg0 or m
        if prev is None:
            day = rows
        else:
            day = [[(a - b) if a is not None and b is not None else None for a, b in zip(ra, rb)]
                   for ra, rb in zip(rows, prev)]
        days.append(day)
        prev = rows
        time.sleep(PAUSE)

    lat0, lon0, dlat, dlon = grib2.lat_lon_of(msg0)
    nx, ny = msg0.grid.ni, msg0.grid.nj
    flat = []
    for day in days:
        for row in day:
            for v in row:
                flat.append(NODATA if v is None else min(NODATA - 1, max(0, round(v / SCALE))))
    assert len(flat) == DAYS * nx * ny

    def acc_max(win: int) -> float:
        best = 0.0
        for s in range(0, DAYS - win + 1):
            for j in range(ny):
                for i in range(nx):
                    t = 0.0
                    for d in range(s, s + win):
                        v = days[d][j][i]
                        if v is not None and v > 0:
                            t += v
                    if t > best:
                        best = t
        return round(best, 1)

    w, e = lon0 - dlon / 2, lon0 + (nx - 1) * dlon + dlon / 2
    s_, n = lat0 - dlat / 2, lat0 + (ny - 1) * dlat + dlat / 2
    meta = {
        "init": init,
        "source": "gfs",
        "provider": "noaa",
        "sample": False,
        "attribution": "Forecast rain: NOAA GFS 0.25 deg (NOMADS)",
        "corners": [[w, n], [e, n], [e, s_], [w, s_]],
        "dayStarts": [(cycle + timedelta(days=k)).strftime("%Y-%m-%dT%H:%MZ") for k in range(DAYS + 1)],
        "grid": {"lat0": lat0, "lon0": lon0, "dlat": dlat, "dlon": dlon, "ny": ny, "nx": nx, "days": DAYS,
                 "file": "daily.bin", "dtype": "uint16", "scale": SCALE, "nodata": NODATA},
        "levels": {"acc": [5, 20, 50, 100, 200, 400]},
        "windowsDays": [1, 3, 7, 15],
        "maxAcc": {str(k): acc_max(k) for k in (1, 15)},
        "notes": ["NOAA GFS 0.25 deg APCP; daily rain = accumulated total at f(24k+24) minus f(24k); days start at the init hour"],
    }
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "daily.bin").write_bytes(struct.pack("<%dH" % len(flat), *flat))
    (OUT / "meta.json").write_text(json.dumps(meta, ensure_ascii=False), encoding="utf-8")
    return {"init": init, "source": "gfs", "provider": "noaa", "grid": f"{nx}x{ny}", "skipped": False}


if __name__ == "__main__":
    import sys
    print(fetch(force="--force" in sys.argv))
