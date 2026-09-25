# ผลตรวจสอบก่อนส่งมอบ

## บริการประจำและปุ่มส่งทดสอบ

- Migration 003/004 ผ่านบน MySQL ทดสอบ แยกพอร์ต 3308 จากฐานของผู้ใช้
- lint, typecheck และ production build ผ่าน
- Integration 12 tests ผ่าน: บริการทั้ง 4 ใช้ service_id เดิมข้ามปี แต่ทะเบียน/สิทธิ์แยกปี; เพิ่มปีพร้อมชุดบริการและเรียกเตรียมซ้ำไม่สร้างซ้ำ; ส่งทดสอบตรวจ permission, server switch, credential, LIVE mode และผู้รับ
- ทดสอบ request UUID เดิมพร้อมกันเรียก fake provider เพียงครั้งเดียว, จำกัดหนึ่งครั้งต่อนาทีต่อผู้รับ, replay ผลเดิม, timeout/คำขอค้างเป็น UNKNOWN ไม่ส่งซ้ำอัตโนมัติ
- Integration files รันเรียงกันเพราะแชร์ฐานและ notification_settings; กรณี concurrent booking/test send ยังคงทดสอบพร้อมกันภายใน case
- Playwright 5 journeys ผ่าน รวมเพิ่มปีผ่าน UI โดยไม่สร้างแผน, บริการครบ 4 และเลือกไว้ให้, ปุ่มส่งทดสอบปฏิเสธเมื่อปิด server switch และแสดงผล ACCEPTED ด้วย browser stub, STAFF/VIEWER ส่งทดสอบไม่ได้
- **ไม่ได้ส่งข้อความจริงออกไป MOPH** ผลสำเร็จในภาพทดสอบมาจาก stub/fake provider เท่านั้น ต้องตรวจรับการส่งจริงกับบัญชี LINE หมอพร้อมของผู้รับที่หน่วยงาน

## อัปเดต 25 กันยายน 2569: ปฏิทินหน้าแรกและนำเข้าบุคลากร

- lint, typecheck, production build และ unit tests 5 กรณีผ่าน
- Integration runner 10 tests ผ่าน รวม seed แบบ transaction, replay, ไม่ทับการแก้ไขภายหลัง, rollback เมื่อชื่อชนรหัสอื่น และเพิ่มทะเบียนทั้งชุดแบบไม่ซ้ำ
- Playwright 4 journeys ผ่าน: หน้าแรกสาธารณะและ Login ขวาบนบน desktop/mobile, Admin ไป /admin, นำเข้าบุคลากร JSON ผ่าน UI, workflow นัด/Excel เดิม; STAFF/VIEWER ไปปฏิทินและเข้า Admin หรือเขียนข้อมูลไม่ได้
- ทดสอบข้อมูลจริงจาก private seed ใน schema แยก `ppc_health_check_seed_test`: ครั้งแรก 183 คน, 47 ตำแหน่ง, 13 กลุ่มงาน, 30 หน่วยงาน; นำเข้าซ้ำ 0 คนใหม่/183 คนเดิม ไม่มีข้อมูลจริงใน Git หรือภาพ E2E
- รอบนี้ใช้ MySQL ทดสอบพอร์ต 3308 และ Next พอร์ต 3001 เพื่อแยกจาก Docker/เว็บของผู้ใช้ ไม่แก้ฐานใช้งานบน 3307
- Migration 002 ผ่านทั้งฐานเดิมและฐานใหม่; API ปฏิทินสาธารณะคืนเฉพาะวันเวลา/บริการ/สถานที่/จำนวน ไม่คืนชื่อ รหัสบุคลากร หรือผลตรวจ
- ตรวจ Client_ID/Secret กับเอกสาร Free Form/Postman ที่แนบและปรับคำอธิบาย .env แล้ว ยังไม่ได้เรียก MOPH จริงหรือยืนยันการรับข้อความปลายทาง

## หลักฐานรุ่นเริ่มต้น

ทดสอบ implementation วันที่ 24 กันยายน 2569 และตรวจแพ็กเกจส่งมอบวันที่ 25 กันยายน 2569 บน Windows, Node.js 24.13.0, Next.js 16.3.6, MySQL 8.0.44. ใช้ schema `ppc_health_check_test` ใน instance แยกพอร์ต 3307 ไม่มีข้อมูลบุคลากรจริง

| การตรวจ | ผล |
|---|---|
| npm run lint | ผ่าน ไม่มี error/warning ในรอบสุดท้าย |
| npm run typecheck | ผ่าน |
| npm test | ผ่าน 5 tests: fiscal/date/Bangkok, validation, canonical digest, provider response, disabled/timeout transport |
| npm run test:integration | ผ่าน 8 กรณีย่อย และ parent test (runner แสดง 9 tests) บน MySQL จริง |
| npm run build | ผ่าน production build |
| npm run db:migrate | fresh migration ผ่าน; เรียกซ้ำผ่านโดยไม่ apply ซ้ำ |
| npm run db:bootstrap | สร้างบัญชี/roles/settings บนฐานใหม่ผ่าน |
| npm run worker:once | ผ่านเมื่อปิดส่งจริง |
| Playwright E2E | ผ่าน 2 journeys ด้วย Chrome ที่ติดตั้งในเครื่อง |

Integration ครอบคลุมนัดซ้ำ/รอบสอง/วันนอกแผน/version เก่า, scope หน่วยงาน, attendance และตัวหารรายงาน, template/สูตรต้องห้าม/literal Excel strings, INVALID batch, concurrent change ทำให้ rollback ทั้งชุด, canonical digest หลังเก็บ MySQL JSON, replay confirm ไม่สร้างซ้ำ, นัดคนเดียวกันเวลาเดียวกันต่างรอบที่บันทึกพร้อมกัน, scheduler deduplication และ DRY_RUN ที่ไม่เรียก provider

E2E ครอบคลุม login, เลือกปี, เพิ่มนัดจริงผ่านฟอร์ม, ค้นหา, ปฏิทิน, ดาวน์โหลดแม่แบบ, upload → preview → confirm ผ่านหน้าเว็บ, รายงาน, notification/settings, จอ 1440px และ 390px, ตรวจไม่มี page errors และ horizontal viewport overflow. API journey ทดสอบ Origin, CSRF, logout/revocation, VIEWER อ่านชื่อบุคลากร/นัด/export/notification ไม่ได้ และรายงานจำกัดหน่วยงาน

ภาพตัวอย่างมีแต่ข้อมูลสมมติ สร้างจากฐานที่ใช้ทดสอบ ไม่ใช่รายชื่อจาก Excel ของโรงพยาบาล

## ข้อจำกัดหลักฐาน

- Docker Engine ไม่ทำงานในเครื่องนี้ จึงไม่ได้รัน MySQL 8.4/phpMyAdmin container หรือ build Docker image จริง ต้อง smoke test environment นี้ตอนติดตั้ง
- ไม่ได้ส่ง MOPH Alert จริง ใช้ fake transport และ DRY_RUN เท่านั้น ไม่มี credential จริงใน repository
- ไม่ได้ benchmark 10,000 แถวหรือหลายผู้ใช้ระดับ production, ไม่ได้ทดสอบ browser ทุกยี่ห้อหรือ audit WCAG แบบเต็ม
- ใน sandbox นี้ tsx พบ os.userInfo/uv_os_get_passwd error จึงใช้ preload compatibility shim เฉพาะเครื่องทดสอบนอกรหัสที่ส่งมอบ ไม่มี shim ใน patch
- นโยบายกู้คืน/retention/สิทธิ์ดูผลทางคลินิกต้องกำหนดใน environment โรงพยาบาล ไม่มีการเพิ่มผลตรวจทางคลินิกจากสมมติฐาน

การใช้ patch และการเทียบ Git tree หลัง `git am` ระบุในคู่มือส่งมอบนอก repository เพื่อไม่อ้างอิง commit ของตัวเองในเนื้อหา commit
