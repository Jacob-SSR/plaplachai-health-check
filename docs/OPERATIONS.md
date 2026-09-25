# ดูแลระบบ

## Environment และเครือข่าย

เก็บ .env ใน server/secret store นอก source control. ไม่ใช้ NEXT_PUBLIC_ สำหรับ DB, CID หรือ MOPH credential. Deploy หลัง HTTPS reverse proxy ที่ส่ง Origin เดิมถึงแอป ตั้ง APP_ORIGIN ให้ตรงเพื่อให้ login และ CSRF ทำงาน Secure cookie เปิดอัตโนมัติเมื่อ APP_ORIGIN เป็น https. Proxy ควรกำหนด upload body limit ประมาณ 11 MB และ request timeouts ให้รองรับ import 10,000 แถว

Session อายุสูงสุด 8 ชั่วโมง และหมดอายุเมื่อ idle 30 นาที. Login จำกัด 10 attempts/username และ 300 attempts ทั้งระบบใน 15 นาที (นับทุก attempt) โดยเก็บใน MySQL ใช้งานได้เมื่อมีหลาย app process. เพิ่ม rate limit ตาม IP ที่ reverse proxy ได้ถ้าสภาพใช้งานต้องการ แต่ไม่ใช้ X-Forwarded-For ที่ไม่ตรวจแหล่งเพื่อเชื่อถือสิทธิ์

Runtime database account ควรมี SELECT/INSERT/UPDATE/DELETE เท่าที่ app/worker ใช้; บัญชี migration ต้อง CREATE/ALTER/INDEX/REFERENCES และสิทธิ์ทำ migration. บัญชี health_app ใน compose สำหรับการติดตั้งเริ่มต้นมีสิทธิ์ทุกอย่างใน schema ใหม่จาก MySQL image ให้แยกบัญชี migration/runtime เมื่อขึ้น server ตามนโยบายหน่วยงาน

## สำรองและกู้คืน

สำรองเฉพาะ schema ใหม่ด้วย mysqldump --single-transaction โดยใช้ option file ที่จำกัดสิทธิ์ หรือระบบ backup ของหน่วยงาน ไม่ใส่รหัสผ่านใน argument. เก็บไฟล์สำรองเข้ารหัส พร้อม DATA_ENCRYPTION_KEY และ CID_HMAC_KEY ใน secret backup แยกชุด ทดสอบ restore ไปยัง instance ใหม่ก่อนนำกลับใช้งาน ห้าม restore ทับฐาน HIS/ระบบเดิม

1. หยุด app/worker ใหม่ชั่วคราวก่อน deploy schema ที่เปลี่ยนย้อนหลังไม่ได้
2. ตรวจชื่อฐาน/instance และทำ backup สำเร็จก่อน migration
3. รัน db:migrate; migration มี checksum และ advisory lock แต่ MySQL DDL **ไม่ rollback ทั้งไฟล์** หากล้มกลางทาง
4. หาก migration แรกสำเร็จบางส่วน ห้ามแก้ checksum หรือสั่ง DROP แบบเดาสุ่ม ให้ตรวจ error/ตารางจริงและกู้ backup บน instance ใหม่ หรือให้ DBA จัด forward recovery ตามส่วนที่ apply ไปแล้ว
5. ตรวจปี/จำนวนบุคลากร/นัด/รายงาน และ login ก่อนเปิด app/worker

ไม่มี down migration ที่ลบตารางเพื่อป้องกันการลบข้อมูลนัดโดยไม่ตั้งใจ. `docker compose down` หยุด container โดยเก็บ volume; อย่าใช้ `down -v` กับฐานที่มีข้อมูล

## กุญแจและผู้รับแจ้งเตือน

DATA_ENCRYPTION_KEY เป็น AES-256-GCM key 32 bytes; CID_HMAC_KEY เป็น keyed hash เพื่อเทียบซ้ำ. เปลี่ยนค่า key ตรง ๆ หลังมีข้อมูลแล้วจะทำให้ถอด CID เดิมไม่ได้/เทียบซ้ำไม่ได้ รุ่นนี้ไม่มี key rotation CLI ให้ดำเนินแผน decrypt/re-encrypt และ re-HMAC ที่ตรวจรับก่อนหมุนกุญแจ. ขาด key จะบล็อกส่ง ไม่ log CID หรือกุญแจ

MOPH แจ้งนัดอัตโนมัติส่งจาก worker ส่วนปุ่มส่งข้อความทดสอบส่งทันทีจาก app process สถานะ ACCEPTED ไม่ใช่ delivery receipt. UNKNOWN ต้องตรวจสอบกับ provider ก่อน retry เก็บเหตุผลและผู้สั่งทุกครั้ง. หากต้องหยุดการส่ง ให้ปิด enabled ที่หน้าแจ้งเตือน และ/หรือ MOPH_LIVE_ENABLED=false แล้ว restart worker กรณีคำขอเริ่มส่งไปแล้วอาจหยุดคำขอที่ provider ได้รับไม่ทัน

## Retention และ logs

Worker ลบ staging payload ที่เลย expires_at มากกว่า 7 วัน (preview มีอายุ 24 ชั่วโมง), เก็บ batch counts/audit/import errors ไว้; ลบ sessions และ login limit ที่หมดอายุ. กำหนดอายุ audit/ข้อมูลนัด/backup ตามนโยบายหน่วยงานก่อนเปิดจริง ไม่ลบข้อมูลคลินิกอัตโนมัติจากข้อสมมติทั่วไป

application error log มี requestId และรหัส error ที่กรองแล้ว ใช้ requestId ตามปัญหา ห้ามเปิด request-body logging ที่ proxy/APM สำหรับ login, recipient, upload หรือ provider call. API แสดง error ที่ควบคุมแล้ว ไม่มี stack trace/SQL/secret. Audit เก็บเฉพาะ diff ที่กำหนดใน service; note/reason เป็นข้อความผู้ใช้ จึงหลีกเลี่ยงการพิมพ์ข้อมูลคลินิกหรือเลขบัตรลงช่องเหตุผล

## ข้อจำกัดการใช้งานปัจจุบัน

- App deployment หนึ่งแห่งต่อหนึ่งโรงพยาบาล ไม่รองรับหลายโรงพยาบาลในฐานเดียว
- Export/calendar สูงสุด 10,000 นัดต่อ query ให้ลดช่วงวันเมื่อเกิน; reports aggregate ทั้งปีได้
- Import ตรวจและเขียนตามแถวแบบ transaction อาจใช้เวลานานกับไฟล์ใหญ่ ไม่ได้ทำ benchmark 10,000 แถวในเครื่องทดสอบ
- นัดไม่กำหนด duration จึงกันเฉพาะเวลาเริ่มชนกัน ไม่คำนวณความจุห้อง/ผู้ให้บริการ
- ไม่มี SMS/LINE direct หรือ fallback ถ้า MOPH ส่งไม่ได้
- ไม่มี workflow clinical results, partial service completion, roster exemptions หรือเชื่อม HIS อัตโนมัติในรุ่นนี้
- phpMyAdmin และ MySQL Docker 8.4 ต้อง smoke test ใน environment ติดตั้งจริง รายงานทดสอบระบุเวอร์ชันที่ได้รันไว้ชัดเจน
