import { test,expect } from '@playwright/test';
import { testGuard,fixture } from '../fixture';
import { closePool,execute } from '../../src/server/db';
import { encrypt } from '../../src/server/crypto';
import { randomUUID } from 'node:crypto';
testGuard();
test.afterAll(closePool);
test('admin browser journey, permissions and responsive layout',async({page,request})=>{
 const f=await fixture();
 await page.route('**/api/v1/hosxp/options',async route=>route.fulfill({json:{rooms:[],doctors:[]}}));
 await execute('UPDATE employees SET notification_enabled=1,cid_ciphertext=?,cid_verified_at=UTC_TIMESTAMP() WHERE id=?',[encrypt('1234567890121'),f.people[0].employeeId]);
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 expect((await request.get('/api/v1/employees')).status()).toBe(401);
 await page.goto('/');await expect(page.getByRole('heading',{name:'ตารางตรวจสุขภาพบุคลากร',exact:true})).toBeVisible();
 await expect(page.getByRole('region',{name:'ปฏิทินตรวจสุขภาพ'})).toBeVisible();
 await page.screenshot({path:'test-results/public-calendar-desktop.png',fullPage:true});
 await page.setViewportSize({width:390,height:844});
 await expect(page.getByRole('link',{name:'เข้าสู่ระบบ',exact:true})).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
 await page.screenshot({path:'test-results/public-calendar-mobile.png',fullPage:true});
 await page.setViewportSize({width:1440,height:1000});
 await page.getByRole('link',{name:'เข้าสู่ระบบ',exact:true}).click();await expect(page).toHaveURL(/login/);
 await page.getByLabel('ชื่อผู้ใช้',{exact:true}).fill(process.env.ADMIN_USERNAME!);
 await page.getByLabel('รหัสผ่าน',{exact:true}).fill(process.env.ADMIN_PASSWORD!);
 await page.getByRole('button',{name:'เข้าสู่ระบบ',exact:true}).click();
 await expect(page.getByRole('heading',{name:'งานตรวจสุขภาพบุคลากร'})).toBeVisible();
 await expect(page).toHaveURL(/\/admin$/);
 await page.getByRole('button',{name:'บุคลากร',exact:true}).click();
 await page.getByRole('button',{name:'นำเข้าบุคลากรทั้งชุด',exact:true}).click();
 const tag=randomUUID().slice(0,8),person={employeeCode:`WEB-${tag}`,prefix:'',firstName:`นำเข้าเว็บ${tag}`,lastName:'สมมติ',position:`ตำแหน่งเว็บ${tag}`,group:`กลุ่มเว็บ${tag}`,department:`หน่วยเว็บ${tag}`,active:true,sourceRow:3};
 await page.getByLabel('ไฟล์ข้อมูลบุคลากร').setInputFiles({name:'synthetic.seed.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({version:1,source:'synthetic.xlsx',snapshotDate:f.day,people:[person]}))});
 await expect(page.getByText(/พร้อมนำเข้า 1 คน/)).toBeVisible();
 await page.getByRole('button',{name:'บันทึกข้อมูล',exact:true}).click();
 await expect(page.getByRole('region',{name:'นำเข้าบุคลากร หน่วยงาน และตำแหน่งพร้อมกัน'})).toBeHidden();
 await expect(page.getByText(person.firstName+' '+person.lastName,{exact:true})).toBeVisible();
 // Browser fixture covers display only; no hospital or MOPH connection is used.
 await page.route('**/api/v1/hosxp/oapp?*',async route=>route.fulfill({json:{source:'HOSXP',total:1,data:[{oapp_id:'synthetic-oapp',display_name:'บุคลากรทดสอบ HOSxP',appointment_date:f.day,appointment_time:'09:30:00',clinic:'015',depcode:'015',location:'ห้องทดสอบ'}]}}));
 await page.getByRole('button',{name:'นัดหมายจาก HOSxP',exact:true}).click();
 await expect(page.getByRole('heading',{name:'นัดหมายจาก HOSxP',exact:true})).toBeVisible();
 await expect(page.getByText('บุคลากรทดสอบ HOSxP',{exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'เพิ่มนัดหมาย',exact:true})).toHaveCount(0);
 await expect(page.getByRole('button',{name:'นำเข้า Excel',exact:true})).toHaveCount(0);
 await expect(page.getByRole('button',{name:'แก้ไข',exact:true})).toHaveCount(0);
 const retired=await page.evaluate(async()=>{
  const me=await(await fetch('/api/v1/me')).json();const statuses=[];
  for(const [path,method] of [['appointments','POST'],['appointments/1','PATCH'],['appointments/1/status','PATCH'],['imports/validate','POST'],['imports/old/confirm','POST']]) {
   const r=await fetch('/api/v1/'+path,{method,headers:{'Content-Type':'application/json','x-csrf-token':me.csrf},body:'{}'});statuses.push(r.status);
  }
  return statuses;
 });expect(retired).toEqual([410,410,410,410,410]);
 await page.screenshot({path:'test-results/dashboard-desktop.png',fullPage:true});
 await page.getByRole('button',{name:'รายงานข้อมูลเดิม',exact:true}).click();await expect(page.getByRole('heading',{name:'รายงานการตรวจสุขภาพ'})).toBeVisible();
 await page.getByRole('button',{name:'แจ้งเตือน',exact:true}).click();await expect(page.getByText('ปิดการแจ้งเตือน',{exact:true})).toBeVisible();
 await page.getByLabel('ผู้รับข้อความทดสอบ',{exact:true}).selectOption(String(f.people[0].employeeId));
 await page.getByRole('button',{name:'ส่งข้อความทดสอบ',exact:true}).click();
 await expect(page.getByRole('region',{name:'ทดสอบแจ้งเตือน',exact:true}).getByRole('alert')).toContainText('MOPH_LIVE_ENABLED');
 // Verify success feedback with an explicit browser stub, never contact MOPH in E2E.
 await page.route('**/api/v1/notifications/test',async route=>{const input=route.request().postDataJSON();expect(input.employeeId).toBe(f.people[0].employeeId);expect(input.requestId).toMatch(/^[a-f0-9-]{36}$/);await route.fulfill({json:{id:input.requestId,status:'ACCEPTED',safe_error:null,http_status:200,provider_code:'200'}});});
 await page.getByRole('button',{name:'ตรวจผลคำขอเดิม',exact:true}).click();
 await expect(page.getByRole('status')).toContainText('MOPH รับคำขอแล้ว');
 await expect(page.getByText('HTTP 200 · MOPH 200',{exact:false})).toBeVisible();
 await page.screenshot({path:'test-results/test-notification.png',fullPage:true});
 await page.unroute('**/api/v1/notifications/test');
 await expect(page.getByRole('button',{name:'ข้อมูลตั้งต้น',exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'นัดหมายจาก HOSxP',exact:true}).click();await expect(page.getByRole('heading',{name:'นัดหมายจาก HOSxP'})).toBeVisible();
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:'test-results/dashboard-mobile.png',fullPage:true});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
 const csrf=await page.evaluate(async()=>{const r=await fetch('/api/v1/me');return (await r.json()).csrf;});
 expect(await page.evaluate(async()=>{const r=await fetch('/api/v1/years',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({year:2575})});return r.status;})).toBe(403);
 expect(await page.evaluate(async token=>{const r=await fetch('/api/v1/years',{method:'POST',headers:{'Content-Type':'application/json','x-csrf-token':token},body:JSON.stringify({year:2027})});return r.status;},csrf)).toBe(410);
 expect(errors).toEqual([]);
});

test('menu has only the six HOSxP-backed sections',async({page})=>{
 await fixture();
 await page.goto('/login');await page.getByLabel('ชื่อผู้ใช้',{exact:true}).fill(process.env.ADMIN_USERNAME!);await page.getByLabel('รหัสผ่าน',{exact:true}).fill(process.env.ADMIN_PASSWORD!);await page.getByRole('button',{name:'เข้าสู่ระบบ',exact:true}).click();
 const nav=page.getByRole('navigation',{name:'เมนูหลัก'});
 await expect(nav.getByRole('button')).toHaveText(['นัดหมายจาก HOSxP','บุคลากร','รายงานข้อมูลเดิม','แจ้งเตือน','บัญชีผู้ใช้','ประวัติการใช้งาน']);
 await nav.getByRole('button',{name:'บุคลากร',exact:true}).click();
 await expect(page.getByRole('heading',{name:'บุคลากรจาก HOSxP'})).toBeVisible();
 await expect(page.getByRole('button',{name:'เพิ่มบุคลากร',exact:true})).toHaveCount(0);
 await expect(page.getByRole('button',{name:'เพิ่มผู้มีสิทธิ์',exact:true})).toHaveCount(0);
});
