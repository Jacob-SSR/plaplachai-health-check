# MOPH Alert 3.1

อ่านเอกสารที่ผู้ใช้ให้มา: API Alert Free Form JSON 3.1.pdf, API Alert Template 3.1.pdf, Postman ทั้งสองแบบ และคู่มือ MOPH Alert สำหรับ Admin. รุ่นนี้เลือก Free Form text หนึ่ง bubble จึงไม่ขึ้นกับ template UUID ของแต่ละหน่วยบริการ

| รายการ | ค่าที่ใช้ |
|---|---|
| Endpoint | POST https://morpromt2c.moph.go.th/alert/v3.1/messages |
| Headers | Content-Type application/json, client-key, secret-key |
| CID | array of string; ส่งทีละคนเพื่อลดความกำกวมของผลตอบกลับ |
| messages | array ของ object `{type:'text',text:'…'}` ตามตัวอย่าง JSON ใน PDF |
| metadata | message_title, message_text, message_type:'HPT' |
| success | HTTP 2xx และ message_code=200 → ACCEPTED |
| rejected | documented 401 หรือ 404 / HTTP401/403 → FAILED |
| uncertainty | timeout, network error, non-JSON, HTTP5xx, response ไม่ตรง → UNKNOWN |

ข้อกำกวมที่ยังต้องตรวจรับกับ MOPH: ตารางใน PDF เขียน messages เป็น array string แต่ตัวอย่าง JSON เป็น object; Free Form Postman ใช้ noauth ส่วน Template collection มี Bearer. จึงส่ง object ตามตัวอย่าง Free Form และไม่ใส่ Bearer เว้นแต่ตั้ง MOPH_BEARER_TOKEN หลัง provider ยืนยัน ไม่มีเอกสาร rate limit, idempotency key, delivery receipt หรือ status lookup ที่ยืนยันได้

## วิธีเปิดใช้

1. ขอ client-key/secret-key และตั้งค่าหน่วยบริการผ่านระบบ CMS ตามคู่มือของโรงพยาบาล
2. ให้ผู้รับเชื่อม LINE OA หมอพร้อมตามกระบวนการของหน่วยงาน ตรวจสอบ CID กับเจ้าของข้อมูลก่อนบันทึกหน้า บุคลากร → ผู้รับแจ้งเตือน ใช้ CID นี้เฉพาะการแจ้งนัด เก็บ AES-256-GCM และ HMAC ฝั่ง server
3. เริ่มจากเปิด worker ใน DRY_RUN ดู job log และใช้ preview ตรวจข้อความ ไม่มีคำขอ HTTP ออกไปในโหมดนี้
4. ตั้ง MOPH_CLIENT_KEY/MOPH_SECRET_KEY และ MOPH_LIVE_ENABLED=true ฝั่ง server แล้ว restart worker/app
5. Admin เลือก LIVE และยืนยันเปิดส่งจริงในหน้าแจ้งเตือน เมื่อถึงเวลา worker จึงส่งให้บุคคลที่เปิดรับแจ้งเตือนและมี CID ที่ตรวจสอบแล้ว

ไม่ใส่ token ใน browser, NEXT_PUBLIC_*, source control, audit หรือไฟล์ export. ไม่มีข้อความผลตรวจ/การวินิจฉัยใน reminder ข้อความมีวัน เวลา สถานที่ และช่องทางติดต่อเจ้าหน้าที่เท่านั้น

## การทำงานของ worker

poll ทุก 60 วินาที หลัง 08:00 Asia/Bangkok สร้างงานสำหรับวันที่นัดล่วงหน้า 7/3/1 วัน (แก้รายการวัน 0–30 ได้จากเว็บ) ตรวจ active,ปี/แผนเปิด,สิทธิ์,นัด SCHEDULED. ใช้ unique appointment+schedule_version+rule กันงานซ้ำ จ่ายงานด้วย FOR UPDATE SKIP LOCKED, lease 2 นาที, 1 วินาทีระหว่างคำขอ สูงสุด 100 งานต่อ tick ตัวเลขนี้เป็นการจำกัดฝั่งเรา ไม่ใช่ quota ที่ MOPH รับรอง

ACCEPTED หมายถึง provider รับคำขอแล้ว ไม่ใช่ delivered/read. Timeout อาจเกิดหลัง provider รับข้อความ จึงไม่ retry อัตโนมัติ. ถ้า worker หายระหว่าง SENDING เปลี่ยนเป็น UNKNOWN หลัง lease หมด ผู้ดูแลต้องตรวจสอบและยืนยันความเสี่ยงข้อความซ้ำพร้อมเหตุผลก่อน retry สูงสุด 3 attempts. BLOCKED/FAILED/DRY_RUN สั่ง retry ได้เมื่อแก้สาเหตุแล้ว

หลัง reschedule จะยกเลิกงานเก่าและเปลี่ยน schedule_version. Worker ตรวจ eligibility อีกครั้งก่อนเรียก provider แต่ยังมีช่วงสั้น ๆ ระหว่างตรวจ DB และส่ง HTTP ที่ผู้ใช้อาจแก้นัดได้ การส่งแบบ exactly-once และการเรียกคืนข้อความที่ส่งแล้วทำไม่ได้ด้วย API ที่ได้รับมา. งานที่ CANCELLED เพราะปิดแผน/ปีจะไม่กลับมาส่งเองเมื่อเปิดใหม่ ให้เจ้าหน้าที่ตรวจทานก่อนจัดนัดใหม่

## สิ่งที่ทดสอบแล้ว / ยังต้องทดสอบที่หน่วยงาน

ทดสอบ classification, timeout ผ่าน fake transport, scheduler deduplication และ DRY_RUN ที่ไม่เรียก provider. **ยังไม่ได้ส่งข้อความจริง** และไม่มี credential จริงใน patch. ก่อนใช้งานจริงให้ทดสอบกับผู้รับที่ตรวจรับแล้วหนึ่งคน ตรวจรูปแบบ payload/สิทธิ์หน่วยบริการ/LINE OA กับ MOPH และยืนยันการรับข้อความปลายทางด้วยตนเอง
