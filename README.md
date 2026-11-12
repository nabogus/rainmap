# RainMap

แผนที่ฝนประเทศไทย 2 หน้า

- **ฝนตอนนี้**: ภาพเรดาร์ย้อนหลัง 2 ชม. และคาดการณ์ (nowcast) ล่วงหน้า 2 ชม. ทุก 15 นาที
- **ฝนคาดการณ์ 15 วัน**: ฝนสะสม 1 / 3 / 7 / 15 วัน จาก NOAA GFS เลื่อนวันเริ่มได้

ข้อมูลดึงจากระบบสมดุลน้ำ กรมชลประทาน (ทดลอง) ซึ่งประมวลผลจากเรดาร์กรมอุตุนิยมวิทยาและ NOAA GFS
ไม่ใช่ประกาศเตือนภัย

## โครงสร้าง

| ไฟล์ | หน้าที่ |
|---|---|
| `fetch.py` | ดึงเรดาร์ (PNG 17 เฟรม) และ forecast (`daily.bin` + `meta.json`) มาไว้ใน `data/` ใช้ Python มาตรฐาน ไม่ต้องติดตั้งอะไร |
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
- forecast: `daily.bin` uint16 little-endian ขนาด 15 วัน x 65 แถว x 37 คอลัมน์ ค่า x 0.1 = มม./วัน แถว 0 = ละติจูด 5 องศา (ใต้) คอลัมน์ 0 = ลองจิจูด 97 องศา ความละเอียด 0.25 องศา nodata = 65535
