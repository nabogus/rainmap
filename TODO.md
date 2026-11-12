# TODO

## 2026-11-12
- เว็บขึ้นแล้วที่ https://nabogus.github.io/rainmap/ (บัญชี GitHub คือ nabogus) workflow ดึงข้อมูลทุก 15 นาที ถ้า cron หยุด (repo ไม่มี commit 60 วัน) ต้องเข้าไปกด Enable ที่แท็บ Actions
- ยังไม่ได้ขออนุญาตเจ้าของระบบสมดุลน้ำ กรมชลประทาน (http://183.88.230.184:8002) ในการดึงไฟล์ทุก 15 นาที ถ้าจะใช้จริงควรขอก่อน
- ตัดสินใจแล้ว: เฟสแรกดึงไฟล์จากเว็บต้นทาง (ไม่ดึง GFS / เรดาร์กรมอุตุฯ เอง) ใช้ Leaflet + Python มาตรฐาน deploy ด้วย GitHub Actions แบบ upload artifact (ไม่ commit data/ ลง repo)
- แผนที่ฐานใช้ OSM, OpenTopoMap, Esri (ดาวเทียม / dark gray / ชื่อเมือง) ฟรีไม่ต้อง key ส่วน CARTO และ Stadia ต้องมี key แล้ว ใช้ไม่ได้
- ยังไม่ได้ทดสอบบนมือถือจริง (ทดสอบแค่ในพาเนล browser ของ Claude)
