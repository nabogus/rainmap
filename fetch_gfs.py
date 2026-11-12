"""ดึงฝนคาดการณ์ ลม 10 ม. และความกดอากาศระดับน้ำทะเล จาก GFS 0.25 องศา 15 วัน ผ่าน NOAA NOMADS (grib filter ตัดเฉพาะภูมิภาค)

ผลลัพธ์อยู่ในรูปแบบเดียวกับไฟล์ของระบบสมดุลน้ำ กรมชลประทาน:
  data/forecast/daily.bin  uint16 little-endian [วัน][แถว ใต้ไปเหนือ][คอลัมน์ ตะวันตกไปตะวันออก] ค่า x 0.1 = มม./วัน
  data/forecast/meta.json
  data/forecast/wind.bin   int8 [เวลา 16 จุด ห่างกัน 24 ชม.][u แล้ว v][แถว][คอลัมน์] ค่า x 0.5 = ม./วินาที กริด 0.5 องศา
  data/forecast/pres.bin   uint16 [เวลา][แถว][คอลัมน์] ค่า + 85000 = Pa

วิธีคิดฝนรายวัน: ไฟล์ fNNN ของ GFS มีค่า APCP สะสมตั้งแต่ชั่วโมง 0 ถึง NNN
ฝนวันที่ k = สะสมถึง f(24k+24) ลบ สะสมถึง f(24k) จึงโหลดแค่ 16 ไฟล์ (f000, f024, ... f360)
ลมและความกดอากาศเป็นค่า ณ ต้นวันของแต่ละวัน (เวลาเดียวกับรอบ init)
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
WX_STEP = 2          # ลม/ความกดอากาศ เก็บทุก 2 จุด = 0.5 องศา
PAUSE = 0.4          # เว้นจังหวะระหว่างคำขอ ไม่ให้ถี่เกินไปกับ NOMADS


def _url(cycle: datetime, fh: int) -> str:
    ymd, hh = cycle.strftime("%Y%m%d"), cycle.strftime("%H")
    return (f"{FILTER}?dir=%2Fgfs.{ymd}%2F{hh}%2Fatmos&file=gfs.t{hh}z.pgrb2.0p25.f{fh:03d}"
            f"&var_APCP=on&var_UGRD=on&var_VGRD=on&var_PRMSL=on"
            f"&lev_surface=on&lev_10_m_above_ground=on&lev_mean_sea_level=on"
            f"&subregion=&toplat={NORTH}&leftlon={WEST}&rightlon={EAST}&bottomlat={SOUTH}")


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


def _total(msgs: list, fh: int):
    """ตารางฝนสะสมตั้งแต่ชั่วโมง 0 ถึง fh"""
    for m in msgs:
        if (m.cat, m.num) == (1, 8) and m.stat_type == 1 and m.forecast_hour == 0 and m.range_hours == fh:
            return m, grib2.to_rows(m)
    raise RuntimeError(f"ไม่พบค่าสะสม 0-{fh} ชม. ในไฟล์")


def _field(msgs: list, cat: int, num: int):
    """ตารางค่า ณ เวลานั้น (ลม / ความกดอากาศ) ย่อเหลือทุก WX_STEP จุด"""
    for m in msgs:
        if (m.cat, m.num) == (cat, num) and m.range_hours == 0:
            rows = grib2.to_rows(m)
            return [r[::WX_STEP] for r in rows[::WX_STEP]]
    raise RuntimeError(f"ไม่พบตัวแปร {cat}/{num} ในไฟล์")


def current_init() -> str | None:
    p = OUT / "meta.json"
    if not p.exists() or not (OUT / "daily.bin").exists():
        return None
    try:
        m = json.loads(p.read_text(encoding="utf-8"))
        ok = m.get("provider") == "noaa" and m.get("wx") and (OUT / "wind.bin").exists() and (OUT / "pres.bin").exists()
        return m.get("init") if ok else None
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
    wind = bytearray()      # ต่อเวลา: u int8 แล้ว v int8 หน่วย 0.5 ม./วินาที
    pres = []               # ต่อเวลา: uint16 = Pa - 85000
    wx_shape = None

    def add_wx(msgs):
        nonlocal wx_shape
        u, v, p = _field(msgs, 2, 2), _field(msgs, 2, 3), _field(msgs, 3, 1)
        wx_shape = (len(u[0]), len(u))
        for f in (u, v):
            for row in f:
                wind.extend(struct.pack("%db" % len(row), *[max(-127, min(127, round((x or 0) * 2))) for x in row]))
        for row in p:
            pres.extend(max(0, min(65535, round((x or 101300) - 85000))) for x in row)

    add_wx(grib2.parse(_get(_url(cycle, 0))))      # f000 = ค่าวิเคราะห์ ณ เวลา init (ไม่มีฝนสะสม)
    time.sleep(PAUSE)
    for d in range(1, DAYS + 1):
        fh = d * 24
        msgs = grib2.parse(_get(_url(cycle, fh)))
        add_wx(msgs)
        m, rows = _total(msgs, fh)
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
        "wx": {"lat0": lat0, "lon0": lon0, "dlat": dlat * WX_STEP, "dlon": dlon * WX_STEP, "nx": wx_shape[0], "ny": wx_shape[1],
               "times": DAYS + 1, "wind": {"file": "wind.bin", "dtype": "int8", "scale": 0.5, "order": "time, u then v, row, col"},
               "pres": {"file": "pres.bin", "dtype": "uint16", "offsetPa": 85000}},
        "notes": ["NOAA GFS 0.25 deg APCP; daily rain = accumulated total at f(24k+24) minus f(24k); days start at the init hour"],
    }
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "daily.bin").write_bytes(struct.pack("<%dH" % len(flat), *flat))
    (OUT / "wind.bin").write_bytes(bytes(wind))
    (OUT / "pres.bin").write_bytes(struct.pack("<%dH" % len(pres), *pres))
    (OUT / "meta.json").write_text(json.dumps(meta, ensure_ascii=False), encoding="utf-8")
    return {"init": init, "source": "gfs", "provider": "noaa", "grid": f"{nx}x{ny}", "skipped": False}


if __name__ == "__main__":
    import sys
    print(fetch(force="--force" in sys.argv))
