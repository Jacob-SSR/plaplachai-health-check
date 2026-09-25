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

## อ่านสาเหตุเมื่อส่งไม่ผ่าน

หน้าแจ้งเตือนแสดง HTTP status, MOPH message_code และรหัสคำขอ. HTTP 200 เพียงอย่างเดียวไม่ได้แปลว่าส่งผ่าน ต้องเป็น message_code 200 ด้วย

- 401 + client-key or secret-key incorrect: ตรวจ Client_ID/Secret คู่ที่เปิดใช้ใน CMS แล้ว restart app/worker
- 401 + No Cid: MOPH แจ้งว่าไม่มี CID ที่ต้องการส่ง ให้ตรวจเลขที่บันทึกและการลงทะเบียนบัญชี LINE หมอพร้อม ไม่ใช่หลักฐานว่า Key ผิด
- 401 + Hospital Logo is empty: ตั้งรูปโรงพยาบาลใน CMS ตามคู่มือ Template
- 404 + Error template: คู่มือใช้ข้อความเดียวกับหลายกรณี (template, LINE user, CID) จึงต้องให้ MOPH ช่วยตรวจ ไม่สรุปว่าเป็น template อย่างเดียว
- ข้อความอื่น: แสดงคำอธิบายทั่วไปพร้อมรหัส ไม่สะท้อน raw response ซึ่งอาจมีเลขบัตร/Secret. HTTP 5xx ยังคงเป็น UNKNOWN แม้ body มีรหัสปฏิเสธ ห้ามส่งซ้ำอัตโนมัติ

ผลส่งจากรุ่นเก่าที่เก็บเพียงคำอธิบายรวมไม่สามารถกู้ข้อความต้นฉบับย้อนหลังได้ หลังอัปเดตให้เริ่มการทดสอบใหม่เมื่อพร้อมส่งจริง. การกดตรวจผลคำขอเดิมจะคืนผลเดิมโดยไม่ส่งซ้ำ

## วิธีเปิดใช้

หน้า CMS เรียกคู่ **Client_ID + Secret** ว่า Token/API Key: นำ Client_ID ใส่ `MOPH_CLIENT_KEY` และ Secret ใส่ `MOPH_SECRET_KEY` ใน `.env` ของเครื่องที่รัน app/worker. โค้ดส่งสองค่านี้เป็น headers `client-key` และ `secret-key` ตามเอกสาร ไม่ต้องสร้าง token สุ่มในเครื่องเอง

```dotenv
MOPH_LIVE_ENABLED=true
MOPH_CLIENT_KEY=วางค่า_Client_ID_จาก_CMS
MOPH_SECRET_KEY=วางค่า_Secret_จาก_CMS
MOPH_BEARER_TOKEN=
```

Free Form Postman ที่แนบใช้ `noauth` จึงเว้น Bearer ว่างได้. เมื่อเปลี่ยนค่าให้ restart app และ worker; ในหน้า Admin → แจ้งเตือน เปิดใช้งาน เลือก LIVE และยืนยันส่งจริง จากนั้นรัน `npm run worker`. ผู้รับต้องมี CID ที่ตรวจรับและเปิดรับแจ้งเตือนพร้อมนัดที่ถึงกำหนดส่ง ไม่ส่งทันทีเพียงบันทึก credential

หากสร้าง Token ใหม่ใน CMS ให้คัดลอกค่าคู่ใหม่แทนคู่เก่าแล้ว restart ทั้งสอง process ไม่ต้องแก้ source code หรือใส่ค่าใน Git

1. ขอ client-key/secret-key และตั้งค่าหน่วยบริการผ่านระบบ CMS ตามคู่มือของโรงพยาบาล
2. ให้ผู้รับเชื่อม LINE OA หมอพร้อมตามกระบวนการของหน่วยงาน ตรวจสอบ CID กับเจ้าของข้อมูลก่อนบันทึกหน้า บุคลากร → ผู้รับแจ้งเตือน ใช้ CID นี้เฉพาะการแจ้งนัด เก็บ AES-256-GCM และ HMAC ฝั่ง server
3. เริ่มจากเปิด worker ใน DRY_RUN ดู job log และใช้ preview ตรวจข้อความ ไม่มีคำขอ HTTP ออกไปในโหมดนี้
4. ตั้ง MOPH_CLIENT_KEY/MOPH_SECRET_KEY และ MOPH_LIVE_ENABLED=true ฝั่ง server แล้ว restart worker/app
5. Admin เลือก LIVE และยืนยันเปิดส่งจริงในหน้าแจ้งเตือน เมื่อถึงเวลา worker จึงส่งให้บุคคลที่เปิดรับแจ้งเตือนและมี CID ที่ตรวจสอบแล้ว

ไม่ใส่ token ใน browser, NEXT_PUBLIC_*, source control, audit หรือไฟล์ export. ไม่มีข้อความผลตรวจ/การวินิจฉัยใน reminder ข้อความมีวัน เวลา สถานที่ และช่องทางติดต่อเจ้าหน้าที่เท่านั้น

## ปุ่มส่งข้อความทดสอบ

Admin → แจ้งเตือน → ทดสอบแจ้งเตือนเข้า LINE หมอพร้อม เลือกบุคลากรที่เปิดรับและมีเลขบัตรที่ตรวจสอบแล้ว แล้วกด **ส่งข้อความทดสอบ**. ข้อความทดสอบแสดงบนหน้าจอก่อนกด และระบุว่าไม่ใช่ใบนัด ไม่ต้องสร้างนัดหรือรอ worker แต่ต้องผ่านทั้ง MOPH_LIVE_ENABLED/Client_ID/Secret และ enabled+LIVE ในฐานข้อมูลเหมือนการส่งจริง

เว็บส่งคำขอทันทีจาก app process พร้อมแสดงผล ACCEPTED, FAILED, BLOCKED หรือ UNKNOWN. ACCEPTED แปลว่า MOPH รับคำขอ ให้ผู้รับเปิด LINE หมอพร้อมตรวจข้อความด้วยตนเอง. กรณีเครือข่ายขาด กดตรวจผลคำขอเดิมได้โดยไม่ส่งซ้ำ; SENDING ที่ค้างเกิน 2 นาทีจะเป็น UNKNOWN เมื่อตรวจผล ไม่ retry อัตโนมัติ. เริ่มการทดสอบใหม่ได้อย่างชัดเจนหลังตรวจข้อความแล้ว โดยจำกัดต่อผู้รับหนึ่งครั้งต่อนาที

บันทึกผลใน notification_test_sends พร้อม audit โดยไม่มี CID หรือ credential ในผลตอบกลับ/log. STAFF/VIEWER ใช้ endpoint นี้ไม่ได้

## การทำงานของ worker

poll ทุก 60 วินาที หลัง 08:00 Asia/Bangkok สร้างงานสำหรับวันที่นัดล่วงหน้า 7/3/1 วัน (แก้รายการวัน 0–30 ได้จากเว็บ) ตรวจ active,ปี/แผนเปิด,สิทธิ์,นัด SCHEDULED. ใช้ unique appointment+schedule_version+rule กันงานซ้ำ จ่ายงานด้วย FOR UPDATE SKIP LOCKED, lease 2 นาที, 1 วินาทีระหว่างคำขอ สูงสุด 100 งานต่อ tick ตัวเลขนี้เป็นการจำกัดฝั่งเรา ไม่ใช่ quota ที่ MOPH รับรอง

ACCEPTED หมายถึง provider รับคำขอแล้ว ไม่ใช่ delivered/read. Timeout อาจเกิดหลัง provider รับข้อความ จึงไม่ retry อัตโนมัติ. ถ้า worker หายระหว่าง SENDING เปลี่ยนเป็น UNKNOWN หลัง lease หมด ผู้ดูแลต้องตรวจสอบและยืนยันความเสี่ยงข้อความซ้ำพร้อมเหตุผลก่อน retry สูงสุด 3 attempts. BLOCKED/FAILED/DRY_RUN สั่ง retry ได้เมื่อแก้สาเหตุแล้ว

หลัง reschedule จะยกเลิกงานเก่าและเปลี่ยน schedule_version. Worker ตรวจ eligibility อีกครั้งก่อนเรียก provider แต่ยังมีช่วงสั้น ๆ ระหว่างตรวจ DB และส่ง HTTP ที่ผู้ใช้อาจแก้นัดได้ การส่งแบบ exactly-once และการเรียกคืนข้อความที่ส่งแล้วทำไม่ได้ด้วย API ที่ได้รับมา. งานที่ CANCELLED เพราะปิดแผน/ปีจะไม่กลับมาส่งเองเมื่อเปิดใหม่ ให้เจ้าหน้าที่ตรวจทานก่อนจัดนัดใหม่

## สิ่งที่ทดสอบแล้ว / ยังต้องทดสอบที่หน่วยงาน

ทดสอบ classification, timeout ผ่าน fake transport, scheduler deduplication และ DRY_RUN ที่ไม่เรียก provider. **ยังไม่ได้ส่งข้อความจริง** และไม่มี credential จริงใน patch. ก่อนใช้งานจริงให้ทดสอบกับผู้รับที่ตรวจรับแล้วหนึ่งคน ตรวจรูปแบบ payload/สิทธิ์หน่วยบริการ/LINE OA กับ MOPH และยืนยันการรับข้อความปลายทางด้วยตนเอง
