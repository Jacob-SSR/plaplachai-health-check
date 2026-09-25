import { randomUUID } from 'node:crypto';
import { rows,execute,transaction } from './db';
import { ensure,bangkokNow,addDays } from '../domain/validation';
import { type RecordRow } from './appointments';
import { type Actor } from './auth';
import { decrypt } from './crypto';
import { audit } from './audit';
import { MophAlertProvider,type NotificationProvider } from '../providers/moph-alert';

export function reminderText(appointment:Record<string,unknown>) {
  const d=new Date(String(appointment.appointment_date)+'T00:00:00+07:00');
  const thai=new Intl.DateTimeFormat('th-TH',{day:'numeric',month:'long',year:'numeric',timeZone:'Asia/Bangkok'}).format(d);
  return `โรงพยาบาลพลับพลาชัย ขอแจ้งนัดตรวจสุขภาพวันที่ ${thai} เวลา ${String(appointment.appointment_time).slice(0,5)} น. ณ ${appointment.location} หากต้องการเลื่อนนัด โปรดติดต่อเจ้าหน้าที่`;
}
export async function notificationSettings() {
  const [settings]=await rows('SELECT * FROM notification_settings WHERE id=1');
  return {...settings,rules:await rows('SELECT * FROM notification_rules ORDER BY days_before DESC'),credentialConfigured:!!(process.env.MOPH_CLIENT_KEY&&process.env.MOPH_SECRET_KEY),serverLiveEnabled:process.env.MOPH_LIVE_ENABLED==='true'};
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
export async function dispatchOne(provider:NotificationProvider=new MophAlertProvider()) {
  // A lost worker lease is uncertain, never an automatic retry.
  await execute("UPDATE notification_jobs SET status='UNKNOWN',safe_error='WORKER_LEASE_EXPIRED' WHERE status='SENDING' AND lease_until<UTC_TIMESTAMP(6)");
  const claimed=await transaction(async db=>{
    const [settings]=await rows<RecordRow>('SELECT * FROM notification_settings WHERE id=1');if(!settings?.enabled)return null;
    const [job]=await rows<RecordRow>("SELECT * FROM notification_jobs WHERE status='PENDING' AND available_at<=UTC_TIMESTAMP(6) ORDER BY available_at LIMIT 1 FOR UPDATE SKIP LOCKED",[],db);if(!job)return null;
    const [a]=await rows<RecordRow>(`SELECT a.*,e.cid_ciphertext,e.cid_verified_at,e.notification_enabled,e.active,m.eligibility_status,p.status plan_status,y.status year_status
     FROM health_check_appointments a JOIN fiscal_year_members m ON m.id=a.member_id JOIN employees e ON e.id=m.employee_id JOIN health_check_plans p ON p.id=a.plan_id JOIN fiscal_years y ON y.id=a.fiscal_year_id WHERE a.id=?`,[job.appointment_id],db);
    const {day,clock}=bangkokNow();
    if(!a||a.status!=='SCHEDULED'||a.plan_status!=='OPEN'||a.year_status!=='OPEN'||!a.active||a.eligibility_status!=='ELIGIBLE'||Number(a.schedule_version)!==Number(job.schedule_version)||`${a.appointment_date} ${a.appointment_time}`<=`${day} ${clock}:00`) {
      await execute("UPDATE notification_jobs SET status='CANCELLED',safe_error='APPOINTMENT_NO_LONGER_ELIGIBLE' WHERE id=?",[job.id],db);return {skipped:true};
    }
    if(settings.mode==='DRY_RUN') {
      await execute("UPDATE notification_jobs SET status='DRY_RUN',safe_error='No network request was made' WHERE id=?",[job.id],db);return {skipped:true};
    }
    if(!a.notification_enabled||!a.cid_ciphertext||!a.cid_verified_at) {
      await execute("UPDATE notification_jobs SET status='BLOCKED',safe_error='ผู้รับยังไม่เปิดแจ้งเตือนหรือยังไม่ตรวจรับ CID' WHERE id=?",[job.id],db);return {skipped:true};
    }
    let cid:string;try{cid=decrypt(String(a.cid_ciphertext));}catch{await execute("UPDATE notification_jobs SET status='BLOCKED',safe_error='กุญแจข้อมูลผู้รับไม่พร้อม' WHERE id=?",[job.id],db);return {skipped:true};}
    await execute("UPDATE notification_jobs SET status='SENDING',attempt_count=attempt_count+1,lease_until=DATE_ADD(UTC_TIMESTAMP(6),INTERVAL 2 MINUTE) WHERE id=?",[job.id],db);
    await execute("INSERT INTO notification_attempts(job_id,attempt_no,outcome) VALUES(?,?,'STARTED')",[job.id,Number(job.attempt_count)+1],db);
    return {skipped:false,jobId:String(job.id),attemptNo:Number(job.attempt_count)+1,cid,message:reminderText(a)};
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
    ensure(['FAILED','BLOCKED','UNKNOWN','DRY_RUN'].includes(String(job.status)),'สถานะนี้สั่งส่งซ้ำไม่ได้',409);
    ensure(job.status!=='UNKNOWN'||acknowledgeUnknown,'ต้องยืนยันว่าตรวจสอบแล้วและยอมรับโอกาสส่งซ้ำ');
    ensure(Number(job.attempt_count)<3,'ครบ 3 ครั้งแล้ว ต้องตรวจแก้สาเหตุก่อน');
    await execute("UPDATE notification_jobs SET status='PENDING',safe_error=NULL,available_at=UTC_TIMESTAMP(6) WHERE id=?",[jobId],db);
    await audit(db,actor.id,'MANUAL_RETRY','notification_jobs',jobId,{reason,previousStatus:job.status,acknowledgeUnknown});return {ok:true};
  });
}
