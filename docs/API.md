# API และสิทธิ์

Base path `/api/v1`. ทุก endpoint ต้องมี session cookie ยกเว้น login และ GET public-calendar. GET ไม่แก้ข้อมูล domain; POST/PATCH ต้อง `Origin` ตรง `APP_ORIGIN` และ `x-csrf-token` จาก GET `/me`. Login ใช้ Origin และ rate limit. ส่ง JSON ด้วย Content-Type application/json ยกเว้น upload multipart/form-data

| Method / path | สิทธิ์ | Input / ผลลัพธ์หลัก |
|---|---|---|
| GET public-calendar | สาธารณะ อ่านอย่างเดียว | year (id), month (YYYY-MM), department, group; ปี/ตัวกรอง/วันเวลา/สถานที่/จำนวน ไม่มีข้อมูลรายบุคคล |
| POST personnel-seed | employee.write (ADMIN) | JSON version:1,source,snapshotDate,people; จำกัด 2 MB/2,000 คน transaction ทั้งชุด คืนจำนวน created/unchanged |
| POST members/bulk | roster.write (ADMIN) | employeeIds,planId,snapshotDate,rounds,serviceIds; transaction ทั้งชุด ไม่สร้างทะเบียนซ้ำ |
| POST auth/login | สาธารณะ + Origin | username,password; ตั้ง HttpOnly cookie |
| GET me / POST auth/logout | เข้าสู่ระบบ | actor, roles, permissions, departments, csrf / revoke session |
| GET masters | master.read | years, plans, departments, positions, levels, employmentTypes, groups, services |
| POST masters/:kind / PATCH masters/:kind/:id | master.write | code,name,active,parentId/groupId,version เมื่อแก้ |
| GET/POST employees / PATCH employees/:id | employee.read/write | อ่านตาม department scope; employeeCode,prefix,firstName,lastName,departmentId,positionId,levelId,employmentTypeId,validFrom; version,active เมื่อแก้ |
| PATCH employees/:id/recipient | notification.manage | cid (optional เมื่อใช้เลขเดิม),enabled,verified; ไม่มี endpoint อ่าน CID เต็ม |
| POST years / PATCH years/:id | year.write | {year:2570} / {status,version,reason} |
| POST plans | plan.write | yearId,code,name,location,start,end,serviceIds |
| PATCH plans/:id | plan.write | name,location,start,end,status,version,reason; ห้ามทำให้นัดเดิมอยู่นอกช่วง |
| GET members?year=id / POST members | employee.read / roster.write | ทะเบียนรายปี / employeeId,planId,snapshotDate,rounds,serviceIds |
| GET appointments / GET calendar | appointment.read + scope | filter query; appointments แบ่งหน้าละ 50, calendar สูงสุด 10,000 |
| POST appointments | appointment.write + scope | memberId,planId,groupId,roundNo,attemptNo,date,time,location,queueLabel,serviceIds,note |
| PATCH appointments/:id | appointment.write + scope | input เช่น POST + version,reason; ไม่เปลี่ยน member/plan/group/round/attempt |
| PATCH appointments/:id/status | attendance.write + scope | status,version,reason; ลำดับใน ARCHITECTURE |
| GET reports | report.read + scope | summary,departments,daily,services,definitions; ไม่มีชื่อ/CID รายบุคคล |
| GET imports/template?year=id&plan=id | import.execute | .xlsx จาก master/roster ปัจจุบัน |
| POST imports/validate | import.execute | multipart file,year,plan; batchId,digest,total,valid,invalid,errors,preview |
| POST imports/:batchId/confirm | import.execute + owner | {digest}; transaction + idempotent confirmation |
| GET imports | import.execute | 100 batch ล่าสุดของผู้ใช้เอง |
| GET exports/appointments | export.execute + scope | Excel นัด,รายงาน,ตัวกรอง |
| GET/PATCH notification-settings | notification.manage | enabled,mode,version,days:number[],confirmLive |
| GET notifications?year=id | notification.read + scope | 200 job ล่าสุด ไม่แสดงข้อความเต็มหรือ CID |
| POST notifications/preview | notification.manage | appointmentId; ข้อความ preview เท่านั้นไม่ส่ง |
| POST notifications/:id/retry | notification.manage | reason,acknowledgeUnknown; สูงสุด 3 attempts |
| GET audit | audit.read | 200 เหตุการณ์ล่าสุด |
| GET/POST users / PATCH users/:id | user.manage | สร้าง username,displayName,password,role,departmentIds / เปลี่ยน active |

Filter นัด/รายงาน/export ใช้ `year` เป็น **id ของ fiscal_years** ไม่ใช่เลข 2570 และรองรับ department, group, member, status, from, to, service, q (ชื่อ/รหัส), page. ค่าที่ไม่ระบุไม่นำมากรอง

ADMIN มีสิทธิ์จัดการทั้งหมดและทุกหน่วยงาน, STAFF และ VIEWER ดูหน้าเว็บปฏิทิน อ่าน master และรายงานสรุปเฉพาะหน่วยงาน ไม่มีสิทธิ์อ่านรายชื่อบุคคล/นัด/export. Scope ว่างของ STAFF/VIEWER หมายถึงไม่เห็นข้อมูลใน API รายงาน; ปฏิทินสาธารณะแสดงภาพรวมทั้งโรงพยาบาลสำหรับทุกคน

Error response: `{code,message,requestId,fieldErrors?}`. HTTP 401 เข้าสู่ระบบใหม่, 403 ไม่มีสิทธิ์/CSRF, 409 conflict/version, 413 ขนาดเกิน, 415 MIME, 422 validation, 429 login limit, 503 ปัญหาฐาน/การทำงานพร้อมกัน. ไม่คืน SQL, stack, credential หรือ raw provider response
