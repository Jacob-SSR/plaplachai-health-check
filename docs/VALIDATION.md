# ผลตรวจสอบก่อนส่ง patch

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
- ไม่ได้ส่ง MOPH Alert จริง ไม่มี client-key/secret-key จริง ใช้ fake transport และ DRY_RUN เท่านั้น
- ไม่ได้ benchmark 10,000 แถวหรือหลายผู้ใช้ระดับ production, ไม่ได้ทดสอบ browser ทุกยี่ห้อหรือ audit WCAG แบบเต็ม
- ใน sandbox นี้ tsx พบ os.userInfo/uv_os_get_passwd error จึงใช้ preload compatibility shim เฉพาะเครื่องทดสอบนอกรหัสที่ส่งมอบ ไม่มี shim ใน patch
- นโยบายกู้คืน/retention/สิทธิ์ดูผลทางคลินิกต้องกำหนดใน environment โรงพยาบาล ไม่มีการเพิ่มผลตรวจทางคลินิกจากสมมติฐาน

การใช้ patch และการเทียบ Git tree หลัง `git am` ระบุในคู่มือส่งมอบนอก repository เพื่อไม่อ้างอิง commit ของตัวเองในเนื้อหา commit
