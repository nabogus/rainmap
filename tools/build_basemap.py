"""สร้าง basemap.json (แผนที่ฐานของ RainMap) จากข้อมูล Natural Earth (สาธารณสมบัติ)

รันครั้งเดียวเมื่อต้องการสร้างใหม่ ผลลัพธ์ commit ไว้ใน repo แล้ว:
    python tools/build_basemap.py <โฟลเดอร์ที่มีไฟล์ geojson ของ Natural Earth>

ต้องมีไฟล์ (จาก github.com/nvkelso/natural-earth-vector โฟลเดอร์ geojson):
    ne_10m_admin_0_countries.geojson
    ne_10m_admin_1_states_provinces.geojson
    ne_10m_populated_places.geojson

Natural Earth ไม่มีชื่อภาษาไทยของประเทศและเมือง จึงกำหนดเองในไฟล์นี้ ส่วนชื่อจังหวัดไทยใช้ช่อง name_local
"""
import json
import sys
from pathlib import Path

SRC = Path(sys.argv[1])
OUT = Path(__file__).resolve().parent.parent / "basemap.json"
W, E, S, N = 84, 126, -13, 36                       # กรอบที่เก็บรูปร่างไว้

COUNTRY_TH = {
    "THA": "ไทย", "MMR": "เมียนมา", "LAO": "ลาว", "KHM": "กัมพูชา", "VNM": "เวียดนาม", "MYS": "มาเลเซีย",
    "SGP": None, "BRN": "บรูไน", "IDN": "อินโดนีเซีย", "PHL": "ฟิลิปปินส์", "CHN": "จีน", "IND": "อินเดีย",
    "BGD": "บังกลาเทศ", "BTN": "ภูฏาน", "NPL": "เนปาล", "TWN": "ไต้หวัน", "HKG": None, "MAC": None,
}
NEAR = {"THA", "MMR", "LAO", "KHM", "VNM", "MYS", "SGP", "BRN"}       # เก็บละเอียดกว่า
LABEL_AT = {"CHN": (27.0, 108.5), "IND": (26.2, 92.8), "MYS": (4.3, 102.2), "IDN": (-0.5, 102.0), "VNM": (14.3, 108.3),
            "MMR": (21.5, 96.0), "NPL": (28.2, 85.0), "PHL": (12.5, 122.8)}

CITY_TH = {
    "Shanghai": "เซี่ยงไฮ้", "Hong Kong": "ฮ่องกง", "Jakarta": "จาการ์ตา", "Kolkata": "โกลกาตา", "Singapore": "สิงคโปร์",
    "Chengdu": "เฉิงตู", "Manila": "มะนิลา", "Taipei": "ไทเป", "Chattogram": "จิตตะกอง", "Dhaka": "ธากา",
    "Changsha": "ฉางชา", "Chongqing": "ฉงชิ่ง", "Fuzhou": "ฝูโจว", "Guangzhou": "กว่างโจว", "Guiyang": "กุ้ยหยาง",
    "Hangzhou": "หางโจว", "Kunming": "คุนหมิง", "Nanchang": "หนานชาง", "Nanning": "หนานหนิง", "Shenzhen": "เซินเจิ้น",
    "Wuhan": "อู่ฮั่น", "Bandung": "บันดุง", "Medan": "เมดาน", "Surabaya": "สุราบายา", "Yangon": "ย่างกุ้ง",
    "Kuala Lumpur": "กัวลาลัมเปอร์", "Hanoi": "ฮานอย", "Ho Chi Minh City": "โฮจิมินห์",
    "Bandar Seri Begawan": "บันดาร์เสรีเบกาวัน", "Thimphu": "ทิมพู", "Guilin": "กุ้ยหลิน", "Lhasa": "ลาซา",
    "Shantou": "ซัวเถา", "Bandjarmasin": "บันจาร์มาซิน", "Makassar": "มากัสซาร์", "Padang": "ปาดัง",
    "Palembang": "ปาเล็มบัง", "Semarang": "เซอมารัง", "Phnom Penh": "พนมเปญ", "Vientiane": "เวียงจันทน์",
    "Naypyidaw": "เนปยีดอ", "Kaohsiung": "เกาสง", "Macau": "มาเก๊า",
}
# name_local ของ Natural Earth ผิดอยู่ 6 จังหวัด (ชื่อซ้ำหรือเป็นชื่ออำเภอ) จึงกำหนดทับ
PROVINCE_FIX = {"Bangkok Metropolis": "กรุงเทพฯ", "Bueng Kan": "บึงกาฬ", "Chaiyaphum": "ชัยภูมิ",
                "Kanchanaburi": "กาญจนบุรี", "Nakhon Pathom": "นครปฐม", "Phetchabun": "เพชรบูรณ์"}
# เมืองที่เพิ่มเอง: (ชื่อ, lat, lon, ระดับ, เป็นเมืองในไทยหรือไม่)
EXTRA = [
    ("กรุงเทพฯ", 13.75, 100.50, 0, True), ("เชียงใหม่", 18.79, 98.98, 2, True), ("ขอนแก่น", 16.43, 102.83, 2, True),
    ("นครราชสีมา", 14.97, 102.10, 2, True), ("อุบลราชธานี", 15.24, 104.85, 2, True), ("สุราษฎร์ธานี", 9.14, 99.33, 2, True),
    ("หาดใหญ่", 7.01, 100.47, 2, True), ("ภูเก็ต", 7.88, 98.39, 2, True), ("พิษณุโลก", 16.82, 100.26, 3, True),
    ("มัณฑะเลย์", 21.97, 96.08, 3, False), ("ดานัง", 16.07, 108.22, 3, False), ("เสียมราฐ", 13.36, 103.86, 4, False),
    ("หลวงพระบาง", 19.89, 102.13, 4, False), ("ปีนัง", 5.41, 100.33, 3, False), ("ทวาย", 14.08, 98.20, 4, False),
    ("ปากเซ", 15.12, 105.80, 4, False), ("สะหวันนะเขต", 16.55, 104.75, 4, False), ("เว้", 16.46, 107.60, 4, False),
    ("โกตาบารู", 6.13, 102.24, 4, False), ("ยะโฮร์บาห์รู", 1.49, 103.74, 4, False), ("เมาะลำเลิง", 16.49, 97.63, 4, False),
]


def simplify(pts, tol):
    """Douglas-Peucker แบบไม่เรียกซ้ำ"""
    n = len(pts)
    if n < 5:
        return pts
    keep = [False] * n
    keep[0] = keep[-1] = True
    stack = [(0, n - 1)]
    t2 = tol * tol
    while stack:
        a, b = stack.pop()
        if b - a < 2:
            continue
        ax, ay = pts[a]
        bx, by = pts[b]
        dx, dy = bx - ax, by - ay
        d2 = dx * dx + dy * dy
        best, bi = -1.0, -1
        for i in range(a + 1, b):
            px, py = pts[i]
            if d2 == 0:
                d = (px - ax) ** 2 + (py - ay) ** 2
            else:
                t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / d2))
                d = (px - ax - t * dx) ** 2 + (py - ay - t * dy) ** 2
            if d > best:
                best, bi = d, i
        if best > t2:
            keep[bi] = True
            stack.append((a, bi))
            stack.append((bi, b))
    return [p for p, k in zip(pts, keep) if k]


def rings_of(geom):
    """เฉพาะวงนอกของแต่ละ polygon (ไม่เก็บรูด้านใน)"""
    if geom["type"] == "Polygon":
        return [geom["coordinates"][0]]
    return [poly[0] for poly in geom["coordinates"]]


def prep(geom, tol, min_span):
    out = []
    for ring in rings_of(geom):
        xs = [p[0] for p in ring]
        ys = [p[1] for p in ring]
        if max(xs) < W or min(xs) > E or max(ys) < S or min(ys) > N:
            continue
        if max(xs) - min(xs) < min_span and max(ys) - min(ys) < min_span:
            continue                                   # เกาะเล็กเกินไป
        r = simplify([(p[0], p[1]) for p in ring], tol)
        if len(r) >= 4:
            out.append([[round(x, 3), round(y, 3)] for x, y in r])
    return out


def load(name):
    return json.load(open(SRC / name, encoding="utf-8"))["features"]


countries = []
for f in load("ne_10m_admin_0_countries.geojson"):
    p = f["properties"]
    a3 = p["ADM0_A3"]
    if a3 not in COUNTRY_TH:
        continue
    near = a3 in NEAR
    rings = prep(f["geometry"], 0.012 if near else 0.03, 0.03 if near else 0.12)
    if not rings:
        continue
    lat, lon = LABEL_AT.get(a3, (p["LABEL_Y"], p["LABEL_X"]))
    countries.append({"a3": a3, "th": COUNTRY_TH[a3], "lat": round(lat, 2), "lon": round(lon, 2), "rings": rings})

provinces = []
for f in load("ne_10m_admin_1_states_provinces.geojson"):
    p = f["properties"]
    if p.get("adm0_a3") != "THA":
        continue
    name = PROVINCE_FIX.get(p["name"]) or (p.get("name_local") or p["name"]).replace("จังหวัด", "").strip()
    provinces.append({"th": name, "en": p["name"], "lat": round(p["latitude"], 3), "lon": round(p["longitude"], 3),
                      "rings": prep(f["geometry"], 0.008, 0.02)})

cities = [{"th": n, "lat": la, "lon": lo, "rank": r, "inTH": t} for n, la, lo, r, t in EXTRA]
for f in load("ne_10m_populated_places.geojson"):
    p = f["properties"]
    if p["NAME"] in CITY_TH and W <= p["LONGITUDE"] <= E and S <= p["LATITUDE"] <= N and p["ADM0_A3"] != "THA":
        cities.append({"th": CITY_TH[p["NAME"]], "lat": round(p["LATITUDE"], 2), "lon": round(p["LONGITUDE"], 2),
                       "rank": min(4, p["SCALERANK"]), "inTH": False})

data = {"source": "Natural Earth (public domain) | ชื่อภาษาไทยกำหนดเอง", "countries": countries, "provinces": provinces, "cities": cities}
OUT.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
npts = sum(len(r) for c in countries for r in c["rings"]) + sum(len(r) for c in provinces for r in c["rings"])
print(f"{OUT.name}: {OUT.stat().st_size / 1024:.0f} KB | ประเทศ {len(countries)} | จังหวัด {len(provinces)} | เมือง {len(cities)} | จุด {npts}")
print("จังหวัดตัวอย่าง:", [p["th"] for p in provinces[:10]])
