# TODO

## 2026-11-12
- commit แรกแล้ว (branch main) ยังไม่ได้สร้าง repo `nabodus/rainmap` บน GitHub และยังไม่ได้ push (ขั้นตอนอยู่ใน README.md หัวข้อ "ขึ้น GitHub Pages")
- ยังไม่ได้ขออนุญาตเจ้าของระบบสมดุลน้ำ กรมชลประทาน (http://183.88.230.184:8002) ในการดึงไฟล์ทุก 15 นาที ถ้าจะใช้จริงควรขอก่อน
- ตัดสินใจแล้ว: เฟสแรกดึงไฟล์จากเว็บต้นทาง (ไม่ดึง GFS / เรดาร์กรมอุตุฯ เอง) ใช้ Leaflet + Python มาตรฐาน deploy ด้วย GitHub Actions แบบ upload artifact (ไม่ commit data/ ลง repo)
- แผนที่ฐานเปลี่ยนจาก CARTO (ต้องมี API key แล้ว) เป็น tile.openstreetmap.org ถ้าโหลดช้าหรือโดนจำกัด ค่อยหา provider อื่น
- หน้า forecast แสดงเป็นบล็อก 0.25 องศา ยังไม่ได้ทำ smoothing ถ้าต้องการให้เนียนค่อยเพิ่ม
- ยังไม่ได้ทดสอบบนมือถือจริง (ทดสอบแค่ในพาเนล browser ของ Claude)
