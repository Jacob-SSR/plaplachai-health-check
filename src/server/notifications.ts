import { randomUUID } from 'node:crypto';
import { rows,execute,transaction } from './db';
import { ensure,bangkokNow,addDays } from '../domain/validation';
import { type RecordRow } from './appointments';
import { type Actor } from './auth';
import { decrypt } from './crypto';
import { audit } from './audit';
import { MophAlertProvider,type NotificationProvider } from '../providers/moph-alert';
import { futureHosxpAppointment,hosxpAppointmentStillCurrent,refreshHosxpAppointment } from './hosxp-sync';
import { noticeMessage,noticeText,type Notice,type NoticeKind } from '../domain/notice';
import { hosxpRoom } from '../domain/hosxp';
import { appointmentExtras } from './hosxp';

export function noticeFromRow(a:Record<string,unknown>,kind:string='NEW',daysBefore?:number,extras:{tests?:string[];preparation?:string[]}={}):Notice {
  const name=String(a.hosxp_doctor_name||`${a.prefix??''}${a.first_name??''} ${a.last_name??''}`).trim();
  const noticeKind:NoticeKind=kind==='CANCELLED'?'CANCELLED':kind==='REMINDER'?'REMINDER':kind==='MANUAL'?'MANUAL':Number(a.schedule_version)>1?'CHANGED':'NEW';
  return {kind:noticeKind,name,date:String(a.appointment_date).slice(0,10),time:a.appointment_time?String(a.appointment_time):null,
    service:hosxpRoom(a.depcode)?.name??'',location:String(a.location??''),daysBefore,...extras};
}
export const reminderText=(a:Record<string,unknown>)=>noticeText(noticeFromRow(a));
export async function notificationSettings() {
  const [settings]=await rows('SELECT * FROM notification_settings WHERE id=1');
  const [hosxp]=await rows('SELECT initialized,last_success_at FROM hosxp_sync_state WHERE id=1');
  return {...settings,hosxp,rules:await rows('SELECT * FROM notification_rules ORDER BY days_before DESC'),credentialConfigured:!!(process.env.MOPH_CLIENT_KEY&&process.env.MOPH_SECRET_KEY),serverLiveEnabled:process.env.MOPH_LIVE_ENABLED==='true'};
}
export async function scheduleReminders(now=new Date()) {
  const [settings]=await rows<RecordRow>('SELECT * FROM notification_settings WHERE id=1');if(!settings?.enabled)return 0;
  const {day,clock}=bangkokNow(now);if(clock<String(settings.send_local_time).slice(0,5))return 0;
  const rules=await rows<RecordRow>('SELECT * FROM notification_rules WHERE active=1');let count=0;
  for(const rule of rules) {
    const target=addDays(day,Number(rule.days_before));
    const appointments=await rows<RecordRow>(`SELECT a.id,a.schedule_version FROM health_check_appointments a JOIN fiscal_year_members m ON m.id=a.member_id
     JOIN employees e ON e.id=m.employee_id JOIN fiscal_years y ON y.id=a.fiscal_year_id JOIN health_check_plans p ON p.id=a.plan_id
     WHERE a.status='SCHEDULED' AND y.status='OPEN' AND p.status='OPEN' AND m.eligibility_status='ELIGIBLE' AND e.active=1 AND a.appointment_date=? AND CONCAT(a.appointment_date,' ',a.appointment_time)>?`,[target,`${day} ${clock}:00`]);
    const scheduledAt=new Date(`${day}T${String(settings.send_local_time).slice(0,8)}+07:00`).toISOString().slice(0,23).replace('T',' ');
    for(const a of appointments){const result=await execute('INSERT IGNORE INTO notification_jobs(id,appointment_id,schedule_version,rule_id,scheduled_at,available_at) VALUES(?,?,?,?,?,?)',[randomUUID(),a.id,a.schedule_version,rule.id,scheduledAt,scheduledAt]);count+=result.affectedRows;}
  }
  return count;
}
// manual=true: an admin pressed send, so the automatic on/off switch and DRY_RUN mode do not apply.
export async function dispatchOne(provider:NotificationProvider=new MophAlertProvider(),jobId?:string,manual=false) {
  // A lost worker lease is uncertain, never an automatic retry.
  await execute("UPDATE notification_jobs SET status='UNKNOWN',safe_error='WORKER_LEASE_EXPIRED' WHERE status='SENDING' AND lease_until<UTC_TIMESTAMP(6)");
  const claimed=await transaction(async db=>{
    const [settings]=await rows<RecordRow>('SELECT * FROM notification_settings WHERE id=1');if(!manual&&!settings?.enabled)return null;
    const [job]=await rows<RecordRow>(`SELECT j.*,r.days_before FROM notification_jobs j LEFT JOIN notification_rules r ON r.id=j.rule_id WHERE j.status='PENDING' AND j.available_at<=UTC_TIMESTAMP(6) ${jobId?'AND j.id=?':''} ORDER BY j.available_at LIMIT 1 FOR UPDATE OF j SKIP LOCKED`,jobId?[jobId]:[],db);if(!job)return null;
    const [a]=job.hosxp_oapp_id?await rows<RecordRow>(`SELECT a.*,a.active source_active,e.cid_ciphertext,e.cid_verified_at,e.notification_enabled,e.active,e.hosxp_doctor_name,e.prefix,e.first_name,e.last_name
     FROM hosxp_appointments a JOIN employees e ON e.id=a.employee_id WHERE a.oapp_id=?`,[job.hosxp_oapp_id],db):await rows<RecordRow>(`SELECT a.*,e.cid_ciphertext,e.cid_verified_at,e.notification_enabled,e.active,m.eligibility_status,p.status plan_status,y.status year_status
     FROM health_check_appointments a JOIN fiscal_year_members m ON m.id=a.member_id JOIN employees e ON e.id=m.employee_id JOIN health_check_plans p ON p.id=a.plan_id JOIN fiscal_years y ON y.id=a.fiscal_year_id WHERE a.id=?`,[job.appointment_id],db);
    const {day,clock}=bangkokNow();
    const cancelNotice=job.kind==='CANCELLED';
    // A cancellation notice needs the appointment to still be cancelled (not re-activated) and not yet past.
    const ineligible=job.hosxp_oapp_id?(!a||(cancelNotice?!!a.source_active:!a.source_active)||!a.active||Number(a.schedule_version)!==Number(job.schedule_version)||!futureHosxpAppointment(String(a.appointment_date),a.appointment_time as string|null)):
      (!a||a.status!=='SCHEDULED'||a.plan_status!=='OPEN'||a.year_status!=='OPEN'||!a.active||a.eligibility_status!=='ELIGIBLE'||Number(a.schedule_version)!==Number(job.schedule_version)||`${a.appointment_date} ${a.appointment_time}`<=`${day} ${clock}:00`);
    if(ineligible) {
      await execute("UPDATE notification_jobs SET status='CANCELLED',safe_error='APPOINTMENT_NO_LONGER_ELIGIBLE' WHERE id=?",[job.id],db);return {skipped:true};
    }
    if(!manual&&settings.mode==='DRY_RUN') {
      await execute("UPDATE notification_jobs SET status='DRY_RUN',safe_error='No network request was made' WHERE id=?",[job.id],db);return {skipped:true};
    }
    if(!a.notification_enabled||!a.cid_ciphertext||!a.cid_verified_at) {
      await execute("UPDATE notification_jobs SET status='BLOCKED',safe_error='ผู้รับยังไม่เปิดแจ้งเตือนหรือยังไม่ตรวจรับ CID' WHERE id=?",[job.id],db);return {skipped:true};
    }
    let cid:string;try{cid=decrypt(String(a.cid_ciphertext));}catch{await execute("UPDATE notification_jobs SET status='BLOCKED',safe_error='กุญแจข้อมูลผู้รับไม่พร้อม' WHERE id=?",[job.id],db);return {skipped:true};}
    if(job.hosxp_oapp_id&&!cancelNotice&&!await hosxpAppointmentStillCurrent(a)) {
      await execute("UPDATE notification_jobs SET status='CANCELLED',safe_error='HOSXP_APPOINTMENT_CHANGED' WHERE id=?",[job.id],db);return {skipped:true};
    }
    await execute("UPDATE notification_jobs SET status='SENDING',attempt_count=attempt_count+1,lease_until=DATE_ADD(UTC_TIMESTAMP(6),INTERVAL 2 MINUTE) WHERE id=?",[job.id],db);
    await execute("INSERT INTO notification_attempts(job_id,attempt_no,outcome) VALUES(?,?,'STARTED')",[job.id,Number(job.attempt_count)+1],db);
    return {skipped:false,jobId:String(job.id),attemptNo:Number(job.attempt_count)+1,cid,message:job.hosxp_oapp_id?noticeMessage(noticeFromRow(a,String(job.kind??'NEW'),job.days_before==null?undefined:Number(job.days_before),
      cancelNotice?{}:await appointmentExtras(String(job.hosxp_oapp_id),String(a.appointment_date).slice(0,10)))):noticeText(noticeFromRow(a))};
  });
  if(!claimed)return false;if(claimed.skipped)return true;
  const delivery=await provider.send(claimed.cid!,claimed.message!);
  await transaction(async db=>{
    const status=delivery.outcome==='ACCEPTED'?'ACCEPTED':delivery.outcome==='UNKNOWN'?'UNKNOWN':delivery.outcome==='NOT_SENT'?'BLOCKED':'FAILED';
    await execute('UPDATE notification_jobs SET status=?,safe_error=?,accepted_at=IF(?=\'ACCEPTED\',UTC_TIMESTAMP(6),NULL),lease_until=NULL WHERE id=? AND status=\'SENDING\'',[status,delivery.safeError??null,status,claimed.jobId],db);
    await execute('UPDATE notification_attempts SET outcome=?,http_status=?,provider_code=?,safe_error=? WHERE job_id=? AND attempt_no=?',[delivery.outcome,delivery.httpStatus??null,delivery.providerCode??null,delivery.safeError??null,claimed.jobId,claimed.attemptNo],db);
    await audit(db,null,'NOTIFICATION_ATTEMPT','notification_jobs',claimed.jobId!,{outcome:delivery.outcome});
  });return true;
}
export async function retryNotification(jobId:string,reason:string,acknowledgeUnknown:boolean,actor:Actor) {
  return transaction(async db=>{
    const [job]=await rows<RecordRow>('SELECT * FROM notification_jobs WHERE id=? FOR UPDATE',[jobId],db);ensure(job,'ไม่พบข้อความ',404);
    ensure(job.hosxp_oapp_id,'นัดเดิมในเว็บหยุดใช้แล้ว กรุณาจัดการนัดใน HOSxP',410);
    ensure(['FAILED','BLOCKED','UNKNOWN','DRY_RUN'].includes(String(job.status)),'สถานะนี้สั่งส่งซ้ำไม่ได้',409);
    ensure(job.status!=='UNKNOWN'||acknowledgeUnknown,'ต้องยืนยันว่าตรวจสอบแล้วและยอมรับโอกาสส่งซ้ำ');
    ensure(Number(job.attempt_count)<3,'ครบ 3 ครั้งแล้ว ต้องตรวจแก้สาเหตุก่อน');
    await execute("UPDATE notification_jobs SET status='PENDING',safe_error=NULL,available_at=UTC_TIMESTAMP(6) WHERE id=?",[jobId],db);
    await audit(db,actor.id,'MANUAL_RETRY','notification_jobs',jobId,{reason,previousStatus:job.status,acknowledgeUnknown});return {ok:true};
  });
}

// Reminder N days before the appointment (rule days_before, default 2), once per schedule version.
// Skipped when the first notice for the same version went out within the last day.
export async function scheduleHosxpReminders(now=new Date()) {
  const [settings]=await rows<RecordRow>('SELECT * FROM notification_settings WHERE id=1');if(!settings?.enabled)return 0;
  const {day,clock}=bangkokNow(now);if(clock<String(settings.send_local_time).slice(0,5))return 0;
  let count=0;
  for(const rule of await rows<RecordRow>('SELECT * FROM notification_rules WHERE active=1')) {
    const target=addDays(day,Number(rule.days_before));
    const due=await rows<RecordRow>(`SELECT a.oapp_id,a.schedule_version FROM hosxp_appointments a WHERE a.active=1 AND a.appointment_date=?
      AND NOT EXISTS(SELECT 1 FROM notification_jobs n WHERE n.hosxp_oapp_id=a.oapp_id AND n.schedule_version=a.schedule_version
        AND n.kind='NEW' AND n.created_at>DATE_SUB(UTC_TIMESTAMP(6),INTERVAL 1 DAY) AND n.status NOT IN ('CANCELLED','FAILED','BLOCKED'))`,[target]);
    for(const a of due){const r=await execute(`INSERT IGNORE INTO notification_jobs(id,hosxp_oapp_id,schedule_version,rule_id,kind,dedupe_key,scheduled_at,available_at)
      VALUES(?,?,?,?,'REMINDER',?,UTC_TIMESTAMP(6),UTC_TIMESTAMP(6))`,[randomUUID(),a.oapp_id,a.schedule_version,rule.id,`d${Number(rule.days_before)}`]);count+=r.affectedRows;}
  }
  return count;
}

// Manual "send now" from the web. Uses the same checks as automatic sends and reports the result.
export async function sendManualNotification(oappId:string,actor:Actor,provider:NotificationProvider=new MophAlertProvider()) {
  const jobId=randomUUID();
  // Read this appointment from HOSxP now, so the button works without waiting for the worker.
  ensure(await refreshHosxpAppointment(oappId),'ไม่พบนัดนี้ใน HOSxP หรือเลยวันนัดแล้ว',404);
  await transaction(async db=>{
    const [a]=await rows<RecordRow>('SELECT oapp_id,schedule_version,active FROM hosxp_appointments WHERE oapp_id=? FOR UPDATE',[oappId],db);
    ensure(a,'ไม่พบนัดนี้ใน HOSxP',404);
    ensure(a.active,'นัดนี้ไม่อยู่ในสถานะที่ส่งได้แล้ว (เลยวันนัด ยกเลิก หรือเปลี่ยนแปลง)',409);
    const recent=await rows("SELECT id FROM notification_jobs WHERE hosxp_oapp_id=? AND kind='MANUAL' AND created_at>DATE_SUB(UTC_TIMESTAMP(6),INTERVAL 1 MINUTE)",[oappId],db);
    ensure(!recent.length,'เพิ่งส่งนัดนี้ไป กรุณารอ 1 นาที',429);
    await execute(`INSERT INTO notification_jobs(id,hosxp_oapp_id,schedule_version,kind,dedupe_key,requested_by,scheduled_at,available_at)
      VALUES(?,?,?,'MANUAL',?,?,UTC_TIMESTAMP(6),UTC_TIMESTAMP(6))`,[jobId,oappId,a.schedule_version,jobId,actor.id],db);
    await audit(db,actor.id,'MANUAL_NOTIFICATION','notification_jobs',jobId,{oappId});
  });
  await dispatchOne(provider,jobId,true);
  const [job]=await rows<RecordRow>('SELECT id,status,safe_error FROM notification_jobs WHERE id=?',[jobId]);
  return {id:jobId,status:String(job.status),safe_error:job.safe_error??null};
}
