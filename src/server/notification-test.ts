import { z } from 'zod';
import { rows,execute,transaction } from './db';
import { ensure,id } from '../domain/validation';
import { requirePermission,type Actor } from './auth';
import { decrypt } from './crypto';
import { audit } from './audit';
import { MophAlertProvider,type NotificationProvider,type Delivery } from '../providers/moph-alert';
import { TEST_NOTIFICATION_TEXT } from '../domain/test-message';

type TestResult={id:string;status:string;safe_error:string|null};
export async function sendTestNotification(body:unknown,actor:Actor,provider:NotificationProvider=new MophAlertProvider()):Promise<TestResult>{
  requirePermission(actor,'notification.manage');
  const input=z.object({employeeId:id,requestId:z.uuid()}).parse(body);
  const claimed=await transaction(async db=>{
    const [employee]=await rows<{id:number;active:number;notification_enabled:number;cid_verified_at:string|null;cid_ciphertext:string|null}>(
      'SELECT id,active,notification_enabled,cid_verified_at,cid_ciphertext FROM employees WHERE id=? FOR UPDATE',[input.employeeId],db);
    ensure(employee,'ไม่พบผู้รับ',404);
    const [old]=await rows<TestResult&{actor_user_id:number;employee_id:number;expired:number}>(
      'SELECT *,created_at<DATE_SUB(UTC_TIMESTAMP(6),INTERVAL 2 MINUTE) expired FROM notification_test_sends WHERE id=?',[input.requestId],db);
    if(old){
      ensure(old.actor_user_id===actor.id&&old.employee_id===input.employeeId,'รหัสคำขอถูกใช้กับผู้รับอื่นแล้ว',409);
      if(old.status==='SENDING'&&old.expired){old.status='UNKNOWN';old.safe_error='การส่งขาดช่วง กรุณาตรวจ LINE ของผู้รับก่อนทดสอบใหม่';await execute("UPDATE notification_test_sends SET status='UNKNOWN',safe_error=?,finished_at=UTC_TIMESTAMP(6) WHERE id=?",[old.safe_error,old.id],db);}
      return {result:{id:old.id,status:old.status,safe_error:old.safe_error}};
    }
    ensure(process.env.MOPH_LIVE_ENABLED==='true','ตั้ง MOPH_LIVE_ENABLED=true แล้ว restart เว็บก่อนส่งทดสอบ');
    ensure(process.env.MOPH_CLIENT_KEY&&process.env.MOPH_SECRET_KEY,'กรอก Client_ID และ Secret ใน .env แล้ว restart เว็บ');
    const [settings]=await rows<{enabled:number;mode:string}>('SELECT enabled,mode FROM notification_settings WHERE id=1',[],db);
    ensure(settings?.enabled&&settings.mode==='LIVE','เปิดการแจ้งเตือนและเลือกโหมดส่งจริง (LIVE) ก่อนส่งทดสอบ');
    ensure(employee.active&&employee.notification_enabled&&employee.cid_verified_at&&employee.cid_ciphertext,'ผู้รับต้องเปิดรับแจ้งเตือนและตรวจสอบเลขบัตรประชาชนแล้ว');
    const recent=await rows('SELECT id FROM notification_test_sends WHERE employee_id=? AND created_at>DATE_SUB(UTC_TIMESTAMP(6),INTERVAL 1 MINUTE) LIMIT 1',[input.employeeId],db);
    ensure(!recent.length,'เพิ่งส่งทดสอบให้ผู้รับนี้ กรุณารอ 1 นาทีและตรวจข้อความก่อนทดสอบใหม่',429);
    let cid:string;try{cid=decrypt(employee.cid_ciphertext);}catch{ensure(false,'กุญแจเข้ารหัสข้อมูลผู้รับไม่ตรง กรุณาตรวจ DATA_ENCRYPTION_KEY',503);}
    await execute("INSERT INTO notification_test_sends(id,actor_user_id,employee_id,status) VALUES(?,?,?,'SENDING')",[input.requestId,actor.id,input.employeeId],db);
    await audit(db,actor.id,'TEST_SEND_STARTED','notification_test_sends',input.requestId,{employeeId:input.employeeId});
    return {cid};
  });
  if(claimed.result)return claimed.result;
  let delivery:Delivery;
  try{delivery=await provider.send(claimed.cid,TEST_NOTIFICATION_TEXT);}catch{delivery={outcome:'UNKNOWN',safeError:'การเชื่อมต่อขัดข้อง กรุณาตรวจ LINE ของผู้รับก่อนทดสอบใหม่'};}
  const status=delivery.outcome==='ACCEPTED'?'ACCEPTED':delivery.outcome==='UNKNOWN'?'UNKNOWN':delivery.outcome==='NOT_SENT'?'BLOCKED':'FAILED';
  await transaction(async db=>{
    await execute('UPDATE notification_test_sends SET status=?,http_status=?,provider_code=?,safe_error=?,finished_at=UTC_TIMESTAMP(6) WHERE id=?',[status,delivery.httpStatus??null,delivery.providerCode??null,delivery.safeError??null,input.requestId],db);
    await audit(db,actor.id,'TEST_SEND_RESULT','notification_test_sends',input.requestId,{status,httpStatus:delivery.httpStatus,providerCode:delivery.providerCode});
  });
  return {id:input.requestId,status,safe_error:delivery.safeError??null};
}
