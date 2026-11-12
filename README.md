# RainMap

แผนที่ฝนประเทศไทย 2 หน้า

- **ฝนตอนนี้**: ภาพเรดาร์ย้อนหลัง 2 ชม. และคาดการณ์ (nowcast) ล่วงหน้า 2 ชม. ทุก 15 นาที
- **ฝนคาดการณ์ 15 วัน**: ฝนสะสม 1 / 3 / 7 / 15 วัน จาก NOAA GFS ทั้งภูมิภาค (ลองจิจูด 90 ถึง 115 ละติจูด -5 ถึง 28) เลื่อนวันเริ่มได้

เรดาร์ดึงจากระบบสมดุลน้ำ กรมชลประทาน (ทดลอง) ซึ่งประมวลผลจากเรดาร์กรมอุตุนิยมวิทยา ส่วนฝนคาดการณ์ดึง GFS จาก NOAA NOMADS เอง
ถ้า NOAA ล่มและยังไม่มีไฟล์เดิม จะใช้ไฟล์ forecast ของกรมชลฯ แทน (เห็นเฉพาะประเทศไทย)
ไม่ใช่ประกาศเตือนภัย

## โครงสร้าง

| ไฟล์ | หน้าที่ |
|---|---|
| `fetch.py` | ดึงเรดาร์ (PNG 17 เฟรม) และเรียก forecast มาไว้ใน `data/` ใช้ Python มาตรฐาน ไม่ต้องติดตั้งอะไร |
| `fetch_gfs.py` | ดึง GFS APCP 15 ไฟล์ (f024 ถึง f360) ผ่าน grib filter ของ NOMADS แล้วคิดฝนรายวันจากผลต่างค่าสะสม ข้ามถ้ารอบเดิม |
| `grib2.py` | ตัวถอด GRIB2 แบบเล็ก (simple packing) เขียนเองเพราะเครื่องนี้บล็อก DLL ของ eccodes |
| `index.html` `app.js` `style.css` | หน้าเว็บ Leaflet อ่านไฟล์ใน `data/` |
| `.github/workflows/pages.yml` | GitHub Actions ดึงข้อมูลทุก 15 นาที แล้ว deploy ขึ้น GitHub Pages (ไม่ commit ข้อมูลลง repo) |

## รันในเครื่อง

```bash
python fetch.py
python -m http.server 8791 --bind 127.0.0.1
```

แล้วเปิด http://127.0.0.1:8791/

## ขึ้น GitHub Pages

1. สร้าง repo ชื่อ `rainmap` แล้ว push โค้ดขึ้น branch `main`
2. Settings > Pages > Build and deployment > Source เลือก **GitHub Actions**
3. รัน workflow ครั้งแรกจากแท็บ Actions (หรือรอ push) จะได้ที่ `https://<user>.github.io/rainmap/`

Workflow ตั้ง cron ทุก 15 นาที GitHub อาจหน่วงได้ 5 ถึง 15 นาที และจะหยุด cron เองถ้า repo ไม่มี commit นาน 60 วัน
(เข้าไปกด Enable อีกครั้งในแท็บ Actions)

## รูปแบบข้อมูล

- เรดาร์: PNG เทา 1301 x 1911 px โปรเจกชัน Web Mercator ค่าพิกเซล 1..6 = ระดับฝน ตาม `levels` (มม./ชม.) ใน `index.json`
- forecast: `daily.bin` uint16 little-endian ขนาด 15 วัน x 133 แถว x 101 คอลัมน์ ค่า x 0.1 = มม./วัน แถว 0 = ละติจูด -5 องศา (ใต้) คอลัมน์ 0 = ลองจิจูด 90 องศา ความละเอียด 0.25 องศา nodata = 65535 ขนาดกริดอ่านจาก `meta.json` เสมอ (ไฟล์สำรองของกรมชลฯ เป็น 65 x 37)
- วันของ forecast เริ่มที่ชั่วโมงของรอบ GFS (เช่นรอบ 00Z = 07:00 น. ไทย) ไม่ใช่เที่ยงคืน
- OPeNDAP ของ NOMADS ถูกยกเลิกแล้ว ต้องใช้ grib filter เท่านั้น
