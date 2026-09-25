# ระบบตารางตรวจสุขภาพบุคลากร โรงพยาบาลพลับพลาชัย

Next.js + Node.js + MySQL สำหรับจัดนัดตรวจตามปีงบประมาณไทย มีบัญชี Admin/Staff/Viewer, ทะเบียนและตำแหน่งย้อนหลัง, แผน/รอบตรวจ, ปฏิทิน, attendance, Excel import แบบตรวจสอบและยืนยัน, export, รายงาน, audit และ worker MOPH Alert

ระบบนี้เป็น repository และฐานข้อมูลใหม่ แยกจาก `ppc-hos-10667` ซึ่งใช้อ้างอิง SQL เท่านั้น ไม่มีรายชื่อจริง เลขบัตร หรือ credential ของโรงพยาบาลใน source/seed. ข้อมูลตำแหน่งจากไฟล์ที่ให้มาอยู่ใน docs สำหรับอ้างอิง ไม่ถูก import อัตโนมัติ

## ติดตั้งแบบ Node บนเครื่อง + ฐานข้อมูล Docker

ใช้ Node.js 24 LTS, npm, Docker Engine + Compose และ Git. ก่อนเริ่ม ตรวจว่าพอร์ต 3307, 9090, 3000 ว่าง (PowerShell: `Get-NetTCPConnection -LocalPort 3307,9090,3000 -ErrorAction SilentlyContinue`). หากมีงานอื่นใช้อยู่ให้เปลี่ยนพอร์ตใน compose/.env ให้ตรงกัน ห้ามหยุดหรือลบ MySQL เดิมบน 3306

```powershell
Copy-Item .env.example .env
npm ci
```

ตั้งค่า `.env` ก่อนรัน: DB_PASSWORD กับ MYSQL_ROOT_PASSWORD ต้องเป็นคนละรหัสสุ่ม, ADMIN_PASSWORD อย่างน้อย 12 อักขระ (ไม่เกิน 72 bytes). ตั้ง DATA_ENCRYPTION_KEY เป็น base64 ของ random 32 bytes และ CID_HMAC_KEY เป็น secret แยกอีกตัว ความยาวอย่างน้อย 32 ตัว เก็บกุญแจในที่สำรองที่ปลอดภัย เพราะจำเป็นต่อการกู้ข้อมูลผู้รับ

```powershell
# รันสองครั้งเพื่อสร้างกุญแจคนละตัว แล้วบันทึกใน .env/secret store
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
docker compose up -d mysql phpmyadmin
npm run db:migrate
npm run db:bootstrap
npm run build
npm run start
```

เปิด http://localhost:3000, phpMyAdmin ที่ http://localhost:9090. MySQL ใหม่ bind เฉพาะ 127.0.0.1:3307, ใช้ named volume `ppc-health-check_health_mysql_data` ที่แยกจากของเดิม. ฐานชื่อ ppc_health_check และบัญชี health_app. Migration ปฏิเสธชื่อฐานที่ไม่ขึ้นต้น ppc_health_check เพื่อป้องกันชี้ผิดโดยไม่ตั้งใจ

เปิด terminal อีกหน้าสำหรับ worker:

```powershell
npm run worker
# หรือทำงานหนึ่งรอบแล้วจบ สำหรับตรวจระบบ
npm run worker:once
```

ค่าเริ่มต้น notification ปิดและเป็น DRY_RUN. ไม่เรียก MOPH จนกว่าเปิดทั้ง server switch และยืนยัน LIVE ในเว็บ อ่าน [MOPH-ALERT.md](docs/MOPH-ALERT.md) ก่อนเปิดส่งจริง

หลัง bootstrap ให้ลบ ADMIN_PASSWORD ออกจาก environment ที่ใช้รัน app/worker. Bootstrap ไม่เปลี่ยนรหัสผ่านบัญชีที่มีอยู่แล้ว. ใช้ `npm run dev` แทน build/start เฉพาะพัฒนา

## รัน application ใน Docker ทั้งหมด

Dockerfile ใช้ Node 24 และผู้ใช้ node ที่ไม่ใช่ root. Compose เปิด app/worker ผ่าน profile `app`:

```powershell
docker compose up -d mysql phpmyadmin
docker compose --profile app build
docker compose --profile app run --rm app npm run db:migrate
docker compose --profile app run --rm app npm run db:bootstrap
# เอา ADMIN_PASSWORD ออกจาก .env หลังสร้างบัญชี
docker compose --profile app up -d
```

compose กำหนด DB_HOST=mysql/DB_PORT=3306 ให้ app/worker ภายใน network อัตโนมัติ. ด้าน host ยังเป็น 3307. เปิดผ่าน reverse proxy HTTPS ของโรงพยาบาลและตั้ง APP_ORIGIN เป็น origin จริงแบบตรงตัว เช่น https://health.example-hospital.local แล้ว restart app/worker. ไม่เปิดพอร์ต MySQL/phpMyAdmin ต่ออินเทอร์เน็ต

ไฟล์ Compose/Dockerfile จัดเตรียมแล้ว แต่เครื่องที่ใช้พัฒนารอบนี้ไม่มี Docker Engine ทำงาน จึงยังไม่ได้รัน image MySQL 8.4 และ phpMyAdmin จริง การตรวจ migration/integration ใช้ MySQL 8.0.44 แยกในเครื่อง ดู [VALIDATION.md](docs/VALIDATION.md)

## เริ่มบันทึกงานในเว็บ

1. ข้อมูลตั้งต้น: เพิ่มปีงบประมาณ หน่วยงาน ตำแหน่ง กลุ่มบริการ และรายการตรวจ Admin แก้ชื่อ/เปิดปิดได้ ไม่ใช้ชื่อคนเป็นรหัส
2. บุคลากร: เพิ่ม employee_code ที่ตรวจรับแล้ว ชื่อ หน่วยงาน ตำแหน่ง และวันเริ่มประวัติ ไม่จำเป็นต้องกรอกเลขบัตรเพื่อจัดนัด
3. ผู้มีสิทธิ์ประจำปี: เพิ่มแผนก่อน แล้วเพิ่มบุคลากรเข้าแผน เลือกรายการตรวจและจำนวนรอบ วันอ้างอิงต้องอยู่ในปีและมีประวัติตำแหน่งครอบคลุม
4. ตารางนัด: เพิ่ม/เลื่อนนัด หรือดาวน์โหลดแม่แบบจากเมนูนำเข้า Excel กรอกตามรหัสใน sheet อ้างอิง ตรวจ preview และยืนยันเมื่อผ่านทุกแถว
5. วันรับบริการ: บันทึกเข้ารับบริการ ก่อนบันทึกตรวจแล้ว (ยืนยันครบทุกบริการในนัด); ขาดนัด/ยกเลิกต้องระบุเหตุผล
6. รายงานและ export เลือกปี/หน่วยงาน/บริการ/ช่วงวัน/สถานะได้ รายงานพิมพ์หรือ Save as PDF ผ่าน browser ได้

CSV/XLSX เดิมไม่ควรอัปโหลดตรง ๆ เพราะไม่มี employee_code และมีการตรวจหลายรอบ ต้องตรวจรับรหัสบุคคลและแปลงเป็นแม่แบบของระบบก่อน. การนำเข้าที่ให้มาในรุ่นนี้เป็น **ตารางนัด**; บุคลากร/ทะเบียนเพิ่มผ่านเว็บ ไม่มีการสร้างคนอัตโนมัติจากชื่อใน Excel

## บัญชีและข้อมูลย้อนหลัง

ADMIN ดูแลทุกหน่วยงาน, STAFF จัดนัด/attendance เฉพาะหน่วยงานที่กำหนด, VIEWER ดูเฉพาะสรุปไม่มีรายชื่อบุคคลหรือ export. ปิดบัญชีจะ invalidate sessions. การรีเซ็ตรหัสผ่านทำที่ server โดยตั้ง RESET_USERNAME และ RESET_PASSWORD ชั่วคราวใน environment แล้วรัน:

```powershell
npm run db:reset-password
```

ลบ RESET_PASSWORD ออกจาก environment หลังใช้ ห้ามใส่รหัสจริงใน Git/คำสั่งที่บันทึก history. CLI เก็บ audit และ revoke ทุก session ของบัญชีนั้น

การย้ายตำแหน่ง/หน่วยงานให้แก้บุคลากรพร้อมวันที่มีผล ระบบปิดช่วงเดิมและสร้างช่วงใหม่ ทะเบียนและ snapshot ของปีเดิมยังคงอยู่. ปิดปีงบประมาณได้เมื่อจบงาน เปิดคืนได้โดย Admin พร้อมเหตุผล. ไม่ลบประวัติผ่านหน้าเว็บ

## ทดสอบ

```powershell
npm run lint
npm run typecheck
npm test
npm run build
```

Integration/E2E สร้างข้อมูลสมมติในฐานทดสอบเท่านั้น ตั้ง DB_NAME ลงท้าย `_test`, `ALLOW_TEST_DATABASE=true`, `MOPH_LIVE_ENABLED=false`; สร้าง schema/สิทธิ์บน instance แยกและรัน migrate/bootstrap ในฐานนั้นก่อน ห้ามเปลี่ยน .env ของ process production ที่กำลังรันอยู่เพื่อทดสอบ

```powershell
npm run test:integration
npx playwright install chromium
# build/start server ด้วย test DB ไว้ก่อน หรือกำหนด E2E_START_SERVER=true
npm run test:e2e
```

หากใช้ Chrome ที่ติดตั้งไว้ กำหนด PLAYWRIGHT_EXECUTABLE_PATH ให้ชี้ chrome.exe ได้ ไม่ต้องดาวน์โหลด browser อีก. E2E ใช้ ADMIN_USERNAME/ADMIN_PASSWORD ของ test DB เท่านั้น ภาพ/trace อยู่ test-results และถูก gitignore

## เอกสารเพิ่มเติม

- [สถาปัตยกรรม, ตาราง, ER และขอบเขตข้อมูล](docs/ARCHITECTURE.md)
- [API และสิทธิ์](docs/API.md)
- [MOPH Alert และการจัดการผลส่งไม่ชัดเจน](docs/MOPH-ALERT.md)
- [ตำแหน่ง/หน่วยงานอ้างอิง](docs/POSITION-REFERENCE.md)
- [การสำรอง/กู้คืนและการดูแลระบบ](docs/OPERATIONS.md)
- [ผลทดสอบและข้อจำกัด](docs/VALIDATION.md)

รุ่นนี้ติดตามนัดและการรับบริการ ยังไม่มีหน้าบันทึก/แปลผลทางคลินิก ตารางผลเตรียมไว้เพื่อพัฒนาต่อเมื่อได้ data dictionary และสิทธิ์การเข้าถึงที่ยืนยันแล้ว
