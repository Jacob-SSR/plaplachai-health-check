import { NextRequest,NextResponse } from 'next/server';
import { z } from 'zod';
import { authenticate,login,logout,requirePermission,scopeSql } from '@/src/server/auth';
import { rows,execute,transaction } from '@/src/server/db';
import { jsonBody,boundedBody,errorResponse,download } from '@/src/server/http';
import { ensure,id,text,statuses } from '@/src/domain/validation';
import { masters,saveMaster,employees,createEmployee,updateEmployee,setRecipient,createYear,closeYear,createPlan,updatePlan,enroll,members,saveUser } from '@/src/server/registry';
import { appointmentInput,createAppointment,updateAppointment,changeStatus,listAppointments } from '@/src/server/appointments';
import { reports } from '@/src/server/reports';
import { template,validateImport,confirmImport,exportAppointments,MAX_UPLOAD } from '@/src/server/excel';
import { notificationSettings,retryNotification,reminderText } from '@/src/server/notifications';
import { audit } from '@/src/server/audit';

export const runtime='nodejs';
export const dynamic='force-dynamic';
async function handle(req:NextRequest,{params}:{params:Promise<{path:string[]}>}) {
  try {
    const path=(await params).path,route=path.join('/'),method=req.method,url=req.nextUrl.searchParams;
    if(route==='auth/login'&&method==='POST') {const data=z.object({username:text(100),password:z.string().min(1).max(200)}).parse(await jsonBody(req));return await login(req,data.username,data.password);}
    const actor=await authenticate(req),allow=(permission:string)=>requirePermission(actor,permission);
    let result:unknown;
    if(route==='me'&&method==='GET')result=actor;
    else if(route==='auth/logout'&&method==='POST')return await logout(req,actor);
    else if(route==='masters'&&method==='GET'){allow('master.read');result=await masters(actor);}
    else if(path[0]==='masters'&&['POST','PATCH'].includes(method)){allow('master.write');result=await saveMaster(path[1],method==='PATCH'?id.parse(path[2]):undefined,await jsonBody(req),actor);}
    else if(route==='employees'&&method==='GET'){allow('employee.read');result=await employees(actor);}
    else if(route==='employees'&&method==='POST'){allow('employee.write');result=await createEmployee(await jsonBody(req),actor);}
    else if(path[0]==='employees'&&path.length===2&&method==='PATCH'){allow('employee.write');result=await updateEmployee(id.parse(path[1]),await jsonBody(req),actor);}
    else if(path[0]==='employees'&&path[2]==='recipient'&&method==='PATCH'){allow('notification.manage');result=await setRecipient(id.parse(path[1]),await jsonBody(req),actor);}
    else if(route==='years'&&method==='POST'){allow('year.write');result=await createYear(await jsonBody(req),actor);}
    else if(path[0]==='years'&&path.length===2&&method==='PATCH'){allow('year.write');result=await closeYear(id.parse(path[1]),await jsonBody(req),actor);}
    else if(route==='plans'&&method==='POST'){allow('plan.write');result=await createPlan(await jsonBody(req),actor);}
    else if(path[0]==='plans'&&path.length===2&&method==='PATCH'){allow('plan.write');result=await updatePlan(id.parse(path[1]),await jsonBody(req),actor);}
    else if(route==='members'&&method==='GET'){allow('employee.read');result=await members(id.parse(url.get('year')),actor);}
    else if(route==='members'&&method==='POST'){allow('roster.write');result=await enroll(await jsonBody(req),actor);}
    else if(route==='appointments'&&method==='GET'){allow('appointment.read');result=await listAppointments(url,actor);}
    else if(route==='calendar'&&method==='GET'){allow('appointment.read');result=await listAppointments(url,actor,true);}
    else if(route==='appointments'&&method==='POST'){allow('appointment.write');const input=appointmentInput.parse(await jsonBody(req));result=await transaction(db=>createAppointment(input,actor,db));}
    else if(path[0]==='appointments'&&path.length===2&&method==='PATCH'){allow('appointment.write');const input=appointmentInput.extend({version:id,reason:text(500)}).parse(await jsonBody(req));result=await transaction(db=>updateAppointment(id.parse(path[1]),input,input.version,input.reason,actor,db));}
    else if(path[0]==='appointments'&&path[2]==='status'&&method==='PATCH'){allow('attendance.write');const input=z.object({status:z.enum(statuses),version:id,reason:text(500)}).parse(await jsonBody(req));result=await changeStatus(id.parse(path[1]),input.status,input.version,input.reason,actor);}
    else if(route==='reports'&&method==='GET'){allow('report.read');id.parse(url.get('year'));result=await reports(url,actor);}
    else if(route==='imports/template'&&method==='GET'){allow('import.execute');return download(await template(id.parse(url.get('year')),id.parse(url.get('plan')),actor),'ppc-appointments-template.xlsx');}
    else if(route==='imports/validate'&&method==='POST'){
      allow('import.execute');const raw=await boundedBody(req,MAX_UPLOAD+65536);
      const form=await new Request(req.url,{method:'POST',headers:{'content-type':req.headers.get('content-type')??''},body:new Uint8Array(raw)}).formData();
      const file=form.get('file');ensure(file instanceof File,'กรุณาเลือกไฟล์');
      result=await validateImport(Buffer.from(await file.arrayBuffer()),file.name,id.parse(form.get('year')),id.parse(form.get('plan')),actor);
    }
    else if(path[0]==='imports'&&path[2]==='confirm'&&method==='POST'){allow('import.execute');const input=z.object({digest:z.string().length(64)}).parse(await jsonBody(req));result=await confirmImport(z.uuid().parse(path[1]),input.digest,actor);}
    else if(route==='imports'&&method==='GET'){allow('import.execute');result=await rows('SELECT * FROM import_batches WHERE imported_by=? ORDER BY created_at DESC LIMIT 100',[actor.id]);}
    else if(route==='exports/appointments'&&method==='GET'){allow('export.execute');return download(await exportAppointments(url,actor),'ppc-appointments.xlsx');}
    else if(route==='notification-settings'&&method==='GET'){allow('notification.manage');result=await notificationSettings();}
    else if(route==='notification-settings'&&method==='PATCH'){
      allow('notification.manage');const input=z.object({enabled:z.boolean(),mode:z.enum(['DRY_RUN','LIVE']),version:id,days:z.array(z.number().int().min(0).max(30)).max(10),confirmLive:z.boolean().default(false)}).parse(await jsonBody(req));
      if(input.enabled&&input.mode==='LIVE')ensure(input.confirmLive&&process.env.MOPH_LIVE_ENABLED==='true'&&process.env.MOPH_CLIENT_KEY&&process.env.MOPH_SECRET_KEY,'ต้องยืนยันเปิดส่งจริงและตั้งค่าฝั่ง server ครบก่อน');
      result=await transaction(async db=>{
        const r=await execute('UPDATE notification_settings SET enabled=?,mode=?,version=version+1 WHERE id=1 AND version=?',[input.enabled,input.mode,input.version],db);ensure(r.affectedRows,'ข้อมูลเปลี่ยนแล้ว กรุณาโหลดใหม่',409);
        await execute('UPDATE notification_rules SET active=0',[],db);
        for(const day of new Set(input.days))await execute('INSERT INTO notification_rules(days_before,active) VALUES(?,1) ON DUPLICATE KEY UPDATE active=1',[day],db);
        await execute("UPDATE notification_jobs j JOIN notification_rules r ON r.id=j.rule_id SET j.status='CANCELLED',j.safe_error='RULE_DISABLED' WHERE r.active=0 AND j.status='PENDING'",[],db);
        await audit(db,actor.id,'SETTINGS','notification_settings',1,{enabled:input.enabled,mode:input.mode,days:input.days});return {ok:true};
      });
    }
    else if(route==='notifications'&&method==='GET'){
      allow('notification.read');const scope=scopeSql(actor);result=await rows(`SELECT j.*,m.display_name,a.appointment_date,a.appointment_time,r.days_before FROM notification_jobs j JOIN health_check_appointments a ON a.id=j.appointment_id JOIN fiscal_year_members m ON m.id=a.member_id JOIN notification_rules r ON r.id=j.rule_id WHERE a.fiscal_year_id=? AND ${scope.sql} ORDER BY j.created_at DESC LIMIT 200`,[id.parse(url.get('year')),...scope.params]);
    }
    else if(path[0]==='notifications'&&path[2]==='retry'&&method==='POST'){allow('notification.manage');const input=z.object({reason:text(500),acknowledgeUnknown:z.boolean().default(false)}).parse(await jsonBody(req));result=await retryNotification(z.uuid().parse(path[1]),input.reason,input.acknowledgeUnknown,actor);}
    else if(route==='notifications/preview'&&method==='POST'){allow('notification.manage');const input=z.object({appointmentId:id}).parse(await jsonBody(req));const [a]=await rows('SELECT appointment_date,appointment_time,location FROM health_check_appointments WHERE id=?',[input.appointmentId]);ensure(a,'ไม่พบนัด',404);result={message:reminderText(a),sent:false};}
    else if(route==='audit'&&method==='GET'){allow('audit.read');result=await rows('SELECT a.id,a.action,a.entity_type,a.entity_id,a.changes,a.created_at,u.display_name actor FROM audit_logs a LEFT JOIN users u ON u.id=a.actor_user_id ORDER BY a.id DESC LIMIT 200');}
    else if(route==='users'&&method==='POST'){allow('user.manage');result=await saveUser(await jsonBody(req),actor);}
    else if(route==='users'&&method==='GET'){allow('user.manage');result=await rows('SELECT u.id,u.username,u.display_name,u.active,GROUP_CONCAT(r.code) roles FROM users u LEFT JOIN user_roles ur ON ur.user_id=u.id LEFT JOIN roles r ON r.id=ur.role_id GROUP BY u.id ORDER BY u.username');}
    else if(path[0]==='users'&&path.length===2&&method==='PATCH'){
      allow('user.manage');const userId=id.parse(path[1]),input=z.object({active:z.boolean()}).parse(await jsonBody(req));ensure(userId!==actor.id,'ปิดบัญชีที่กำลังใช้งานอยู่ไม่ได้');
      result=await transaction(async db=>{const r=await execute('UPDATE users SET active=?,auth_version=auth_version+1 WHERE id=?',[input.active,userId],db);ensure(r.affectedRows,'ไม่พบบัญชี',404);await audit(db,actor.id,'ACCOUNT_STATUS','users',userId,{active:input.active});return {ok:true};});
    }
    else ensure(false,'ไม่พบ API',404,'NOT_FOUND');
    const response=NextResponse.json(result);response.headers.set('Cache-Control','no-store');return response;
  } catch(error) {const response=errorResponse(error);response.headers.set('Cache-Control','no-store');return response;}
}
export {handle as GET,handle as POST,handle as PATCH};
