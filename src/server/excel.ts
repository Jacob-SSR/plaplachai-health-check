import ExcelJS from 'exceljs';
import yauzl from 'yauzl';
import { randomUUID } from 'node:crypto';
import { rows,execute,transaction } from './db';
import { type Actor,scopeSql } from './auth';
import { ensure,appointmentInput,isDate,type AppointmentInput,AppError } from '../domain/validation';
import { createAppointment,updateAppointment,validateAppointment,listAppointments,type RecordRow } from './appointments';
import { sha256,canonicalJson } from './crypto';
import { audit } from './audit';

export const HEADERS=['action','appointment_code','expected_version','fiscal_year','plan_code','employee_code','service_group_code','round_no','attempt_no','appointment_date','appointment_time','queue_label','location','service_codes','note'] as const;
export type ImportItem={sourceRow:number;action:'CREATE'|'UPDATE';appointmentId?:number;expectedVersion?:number;input:AppointmentInput};
type ImportError={row:number;field:string;message:string};
export const MAX_UPLOAD=10*1024*1024;
export async function inspectXlsx(buffer:Buffer) {
  ensure(buffer.length<=MAX_UPLOAD,'ไฟล์ต้องไม่เกิน 10 MB',413);
  ensure(buffer[0]===0x50&&buffer[1]===0x4b,'ไฟล์ไม่ใช่ XLSX');
  await new Promise<void>((resolve,reject)=>{
    yauzl.fromBuffer(buffer,{lazyEntries:true,validateEntrySizes:true},(err,zip)=>{
      if(err||!zip){reject(new AppError(422,'INVALID_XLSX','โครงสร้าง XLSX เสียหาย'));return;}
      let total=0,actualTotal=0,count=0,hasWorkbook=false,failed=false;
      const fail=(message:string)=>{if(failed)return;failed=true;zip.close();reject(new AppError(422,'UNSAFE_XLSX',message));};
      zip.on('error',()=>fail('อ่านโครงสร้าง XLSX ไม่สำเร็จ'));
      zip.on('entry',(entry:yauzl.Entry)=>{
        count++;total+=entry.uncompressedSize;
        if(total>40*1024*1024||count>2000||entry.uncompressedSize>20*1024*1024){fail('ไฟล์มีขนาดหลังคลาย ZIP มากเกินกำหนด');return;}
        if(/vbaProject|externalLinks|embeddings|connections\.xml/i.test(entry.fileName)||entry.generalPurposeBitFlag&1){fail('ไม่รับ macro, external links หรือไฟล์เข้ารหัส');return;}
        if(entry.fileName==='xl/workbook.xml')hasWorkbook=true;
        // Validate actual inflated sizes before ExcelJS allocates workbook objects.
        zip.openReadStream(entry,(error,stream)=>{
          if(error||!stream){fail('อ่านข้อมูลภายใน ZIP ไม่สำเร็จ');return;}
          let entrySize=0;
          stream.on('data',(chunk:Buffer)=>{entrySize+=chunk.length;actualTotal+=chunk.length;if(entrySize>20*1024*1024||actualTotal>40*1024*1024){stream.destroy();fail('ข้อมูลหลังคลาย ZIP เกินกำหนด');}});
          stream.on('error',()=>fail('ขนาดข้อมูล ZIP ไม่ถูกต้อง'));
          stream.on('end',()=>{if(!failed)zip.readEntry();});
        });
      });
      zip.on('end',()=>{if(!failed){if(!hasWorkbook)reject(new AppError(422,'INVALID_XLSX','ไม่พบ workbook'));else resolve();}});
      zip.readEntry();
    });
  });
}
function decorate(sheet:ExcelJS.Worksheet) {
  sheet.views=[{state:'frozen',ySplit:1}];sheet.getRow(1).font={bold:true,color:{argb:'FFFFFFFF'}};
  sheet.getRow(1).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF18584A'}};
  sheet.getRow(1).height=26;sheet.columns.forEach(c=>c.width=24);
  sheet.autoFilter={from:{row:1,column:1},to:{row:1,column:sheet.columnCount}};
}
export async function template(yearId:number,planId:number,actor:Actor) {
  const [plan]=await rows<RecordRow>('SELECT p.*,y.fiscal_year FROM health_check_plans p JOIN fiscal_years y ON y.id=p.fiscal_year_id WHERE p.id=? AND p.fiscal_year_id=?',[planId,yearId]);ensure(plan,'ไม่พบแผนในปีที่เลือก');
  const book=new ExcelJS.Workbook();book.creator='โรงพยาบาลพลับพลาชัย';
  const sheet=book.addWorksheet('Appointments');sheet.addRow([...HEADERS]);decorate(sheet);
  for(let row=2;row<=501;row++) {
    sheet.getCell(row,1).dataValidation={type:'list',allowBlank:false,formulae:['"CREATE,UPDATE"']};
    sheet.getCell(row,4).numFmt='0';sheet.getCell(row,10).numFmt='yyyy-mm-dd';
    for(const c of [2,5,6,7,11,12,13,14,15])sheet.getCell(row,c).numFmt='@';
  }
  const instructions=book.addWorksheet('คำอธิบาย');instructions.addRows([
    ['หัวข้อ','คำอธิบาย'],['ปีงบประมาณ',Number(plan.fiscal_year)],['plan_code',plan.code],
    ['หนึ่งแถว','หนึ่งนัด; CREATE เว้น appointment_code/expected_version; UPDATE ใช้ code และ version จาก export'],
    ['วันที่','ค.ศ. YYYY-MM-DD หรือ Excel date; เวลา HH:mm'],['service_codes','รหัสรายการตรวจคั่นด้วย ; เช่น CBC;UA ต้องอยู่กลุ่มเดียวกันและกำหนดให้บุคลากรแล้ว'],
    ['รอบและครั้ง','round_no คือรอบตรวจ; attempt_no เริ่ม 1; ครั้งใหม่หลังยกเลิก/ขาดนัดต้องตรวจรับ'],
    ['ข้อมูลบุคลากร','ใช้ employee_code จาก sheet บุคลากร ไม่ใช้ชื่อหรือลำดับ'],['สถานะ','ไฟล์นี้จัดการตารางนัด ไม่ยืนยันผลตรวจ'],
    ['ความปลอดภัย','ไม่ใส่สูตร macro หรือลิงก์ภายนอก; ไม่เกิน 10 MB / 10,000 แถว'],
  ]);decorate(instructions);instructions.getColumn(2).width=100;
  const scope=scopeSql(actor);
  const people=await rows<RecordRow>(`SELECT e.employee_code,m.display_name,m.department_name FROM fiscal_year_members m JOIN employees e ON e.id=m.employee_id WHERE m.fiscal_year_id=? AND ${scope.sql} ORDER BY e.employee_code`,[yearId,...scope.params]);
  const peopleSheet=book.addWorksheet('บุคลากร');peopleSheet.addRow(['employee_code','ชื่อ','หน่วยงาน']);people.forEach(r=>peopleSheet.addRow([r.employee_code,r.display_name,r.department_name]));decorate(peopleSheet);
  const services=await rows<RecordRow>('SELECT s.code,s.name,g.code group_code,g.name group_name FROM health_check_services s JOIN service_groups g ON g.id=s.service_group_id JOIN plan_services ps ON ps.service_id=s.id WHERE ps.plan_id=? AND s.active=1 AND g.active=1',[planId]);
  const serviceSheet=book.addWorksheet('รายการตรวจ');serviceSheet.addRow(['service_code','ชื่อ','service_group_code','กลุ่มบริการ']);services.forEach(r=>serviceSheet.addRow([r.code,r.name,r.group_code,r.group_name]));decorate(serviceSheet);
  const requirements=await rows<RecordRow>(`SELECT e.employee_code,s.code,r.round_no FROM member_service_requirements r JOIN fiscal_year_members m ON m.id=r.member_id JOIN employees e ON e.id=m.employee_id JOIN health_check_services s ON s.id=r.service_id WHERE r.plan_id=? AND r.status='REQUIRED' AND ${scope.sql}`,[planId,...scope.params]);
  const reqSheet=book.addWorksheet('รายการรายคน');reqSheet.addRow(['employee_code','service_code','round_no']);requirements.forEach(r=>reqSheet.addRow([r.employee_code,r.code,r.round_no]));decorate(reqSheet);
  if(people.length){book.definedNames.add(`'บุคลากร'!$A$2:$A$${people.length+1}`,'EmployeeCodes');for(let r=2;r<=501;r++)sheet.getCell(r,6).dataValidation={type:'list',allowBlank:false,formulae:['EmployeeCodes']};}
  const meta=book.addWorksheet('Metadata');meta.addRows([['template_version','1'],['fiscal_year',Number(plan.fiscal_year)],['plan_code',plan.code]]);meta.state='hidden';
  return Buffer.from(await book.xlsx.writeBuffer());
}
function cellText(cell:ExcelJS.Cell):string {
  const v=cell.value;if(v==null)return '';
  ensure(typeof v==='string'||typeof v==='number'||v instanceof Date,'ไม่รับสูตร ข้อความ rich text หรือ hyperlink ในข้อมูล');
  if(v instanceof Date)return v.toISOString().slice(0,10);
  return String(v).trim();
}
export async function parseWorkbook(buffer:Buffer) {
  await inspectXlsx(buffer);const book=new ExcelJS.Workbook();await book.xlsx.load(buffer as never);
  const sheet=book.getWorksheet('Appointments');ensure(sheet,'ไม่พบ sheet Appointments ใช้ template จากระบบ');
  ensure(sheet.rowCount<=10001,'ไม่เกิน 10,000 แถว');ensure(sheet.columnCount===HEADERS.length,'จำนวนคอลัมน์ไม่ตรง template');
  HEADERS.forEach((h,i)=>ensure(cellText(sheet.getCell(1,i+1))===h,`หัวคอลัมน์ ${i+1} ต้องเป็น ${h}`));
  const data:{row:number;values:Record<string,string>}[]=[],errors:ImportError[]=[];
  for(let n=2;n<=sheet.rowCount;n++) {
    const row=sheet.getRow(n);if(!row.values || !row.hasValues)continue;
    try {const values=Object.fromEntries(HEADERS.map((h,i)=>[h,cellText(row.getCell(i+1))]));if(Object.values(values).some(Boolean))data.push({row:n,values});}
    catch(e){errors.push({row:n,field:'file',message:e instanceof AppError?e.message:'อ่านแถวไม่ได้'});}
  }
  ensure(data.length+errors.length>0,'ไฟล์ไม่มีข้อมูลนัด');return {data,errors};
}
export async function validateImport(buffer:Buffer,filename:string,yearId:number,planId:number,actor:Actor) {
  ensure(/\.xlsx$/i.test(filename),'รับเฉพาะ .xlsx');
  const parsed=await parseWorkbook(buffer),errors=[...parsed.errors],items:ImportItem[]=[],identities=new Set<string>(),slots=new Set<string>();
  const [plan]=await rows<RecordRow>('SELECT p.*,y.fiscal_year FROM health_check_plans p JOIN fiscal_years y ON y.id=p.fiscal_year_id WHERE p.id=? AND p.fiscal_year_id=?',[planId,yearId]);ensure(plan,'แผนไม่ตรงปี');
  for(const {row,values:v} of parsed.data) {
    try {
      ensure(v.action==='CREATE'||v.action==='UPDATE','action ต้องเป็น CREATE หรือ UPDATE');
      ensure(Number(v.fiscal_year)===Number(plan.fiscal_year)&&v.plan_code===plan.code,'ปีหรือรหัสแผนไม่ตรงกับที่เลือก');
      const [member]=await rows<RecordRow>('SELECT m.id,m.department_id FROM fiscal_year_members m JOIN employees e ON e.id=m.employee_id WHERE m.fiscal_year_id=? AND e.employee_code=?',[yearId,v.employee_code]);ensure(member&&hasMemberScope(actor,Number(member.department_id)),'ไม่พบ employee_code ในทะเบียนปีหรือขอบเขตสิทธิ์');
      const [group]=await rows<RecordRow>('SELECT id FROM service_groups WHERE code=?',[v.service_group_code]);ensure(group,'ไม่พบ service_group_code');
      const codes=v.service_codes.split(';').map(s=>s.trim()).filter(Boolean);ensure(codes.length&&codes.length<=50&&new Set(codes).size===codes.length,'รายการตรวจว่าง ซ้ำ หรือเกิน 50 รายการ');
      const services=await rows<RecordRow>(`SELECT id FROM health_check_services WHERE code IN (${codes.map(()=>'?').join(',')})`,codes);ensure(services.length===codes.length,'ไม่พบ service_codes บางรายการ');
      const input=appointmentInput.parse({memberId:member.id,planId,groupId:group.id,roundNo:Number(v.round_no),attemptNo:Number(v.attempt_no),date:v.appointment_date,time:v.appointment_time,queueLabel:v.queue_label,location:v.location,note:v.note,serviceIds:services.map(s=>s.id)});
      let appointmentId:number|undefined,expectedVersion:number|undefined;
      if(v.action==='UPDATE') {
        const [a]=await rows<RecordRow>('SELECT * FROM health_check_appointments WHERE appointment_code=?',[v.appointment_code]);
        ensure(a && Number(a.member_id)===input.memberId && Number(a.plan_id)===planId,'ไม่พบรหัสนัดที่ตรงบุคลากร/แผน');
        ensure(a.status==='SCHEDULED','แก้ไขได้เฉพาะนัดรอตรวจ');
        ensure(Number(a.round_no)===input.roundNo&&Number(a.attempt_no)===input.attemptNo&&Number(a.service_group_id)===input.groupId,'บริการ/รอบ/ครั้งเปลี่ยนไม่ได้');
        ensure(Number(a.version)===Number(v.expected_version),'version ไม่ตรง กรุณา export ใหม่');appointmentId=Number(a.id);expectedVersion=Number(a.version);
      } else ensure(!v.appointment_code&&!v.expected_version,'CREATE ต้องเว้นรหัสนัดและ version');
      const identity=[input.memberId,input.planId,input.groupId,input.roundNo,input.attemptNo].join(':'),slot=[input.memberId,input.date,input.time].join(':');
      ensure(!identities.has(identity)&&!slots.has(slot),'นัดหรือวันเวลาซ้ำภายในไฟล์');identities.add(identity);slots.add(slot);
      await transaction(db=>validateAppointment(input,actor,db,appointmentId));
      items.push({sourceRow:row,action:v.action,appointmentId,expectedVersion,input});
    } catch(e) {errors.push({row,field:'row',message:e instanceof AppError?e.message:'ชนิดข้อมูล/วันที่/เวลา/รหัสไม่ถูกต้อง'});}
  }
  const batchId=randomUUID(),digest=sha256(canonicalJson(items));
  await transaction(async db=>{
    await execute(`INSERT INTO import_batches(id,fiscal_year_id,plan_id,filename,file_sha256,preview_digest,status,total_rows,valid_rows,invalid_rows,imported_by,expires_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,DATE_ADD(UTC_TIMESTAMP(),INTERVAL 24 HOUR))`,
     [batchId,yearId,planId,filename.slice(0,255),sha256(buffer),digest,errors.length?'INVALID':'READY',items.length+errors.length,items.length,errors.length,actor.id],db);
    for(const item of items)await execute('INSERT INTO import_rows(batch_id,source_row,payload) VALUES(?,?,?)',[batchId,item.sourceRow,JSON.stringify(item)],db);
    for(const error of errors)await execute('INSERT INTO import_errors(batch_id,source_row,field,message) VALUES(?,?,?,?)',[batchId,error.row,error.field,error.message],db);
    await audit(db,actor.id,'VALIDATE','import_batches',batchId,{valid:items.length,invalid:errors.length});
  });
  return {batchId,digest,total:items.length+errors.length,valid:items.length,invalid:errors.length,errors,preview:items};
}
function hasMemberScope(actor:Actor,departmentId:number){return actor.roles.includes('ADMIN')||actor.departments.includes(departmentId);}
export async function confirmImport(batchId:string,digest:string,actor:Actor) {
  return transaction(async db=>{
    const [batch]=await rows<RecordRow>('SELECT *,expires_at>UTC_TIMESTAMP() unexpired FROM import_batches WHERE id=? FOR UPDATE',[batchId],db);
    ensure(batch&&Number(batch.imported_by)===actor.id,'ไม่พบงานนำเข้าของคุณ',404);ensure(batch.preview_digest===digest,'Preview เปลี่ยน กรุณาตรวจสอบใหม่',409);
    if(batch.status==='COMMITTED')return {success:Number(batch.success_rows),alreadyCommitted:true};
    ensure(batch.status==='READY'&&batch.unexpired,'Preview หมดอายุหรือยังมีข้อผิดพลาด',409);
    const staged=await rows<{payload:ImportItem|string}>('SELECT payload FROM import_rows WHERE batch_id=? ORDER BY source_row',[batchId],db);
    const items=staged.map(r=>typeof r.payload==='string'?JSON.parse(r.payload) as ImportItem:r.payload);
    ensure(sha256(canonicalJson(items))===digest,'Preview integrity check failed',409);
    items.sort((a,b)=>a.input.memberId-b.input.memberId);
    for(const item of items) {
      if(item.action==='CREATE') await createAppointment(item.input,actor,db);
      else await updateAppointment(item.appointmentId!,item.input,item.expectedVersion!,'ยืนยันนำเข้าจาก Excel',actor,db);
    }
    await execute("UPDATE import_batches SET status='COMMITTED',success_rows=? WHERE id=?",[items.length,batchId],db);
    await audit(db,actor.id,'COMMIT','import_batches',batchId,{success:items.length});return {success:items.length,alreadyCommitted:false};
  });
}
export async function exportAppointments(params:URLSearchParams,actor:Actor) {
  const {data}=await listAppointments(params,actor,true),book=new ExcelJS.Workbook();
  const sheet=book.addWorksheet('Appointments');sheet.addRow([...HEADERS]);
  for(const a of data) {
    const [ref]=await rows<RecordRow>('SELECT p.code plan_code,y.fiscal_year,g.code group_code FROM health_check_plans p JOIN fiscal_years y ON y.id=p.fiscal_year_id JOIN service_groups g ON g.id=? WHERE p.id=?',[a.service_group_id,a.plan_id]);
    const services=await rows<RecordRow>('SELECT s.code FROM appointment_services aps JOIN health_check_services s ON s.id=aps.service_id WHERE aps.appointment_id=? ORDER BY aps.id',[a.id]);
    sheet.addRow(['UPDATE',String(a.appointment_code),Number(a.version),Number(ref.fiscal_year),String(ref.plan_code),String(a.employee_code),String(ref.group_code),Number(a.round_no),Number(a.attempt_no),new Date(String(a.appointment_date)+'T00:00:00Z'),String(a.appointment_time).slice(0,5),String(a.queue_label),String(a.location),services.map(s=>s.code).join(';'),String(a.note)]);
  }
  decorate(sheet);sheet.getColumn(10).numFmt='yyyy-mm-dd';for(const i of [2,5,6,7,11,12,13,14,15])sheet.getColumn(i).numFmt='@';
  const report=book.addWorksheet('รายงาน');report.addRow(['รหัสนัด','รหัสบุคลากร','ชื่อ','หน่วยงานในทะเบียน','บริการ','วันที่นัด','เวลา','สถานะ','รายการตรวจ']);
  data.forEach(a=>report.addRow([String(a.appointment_code),String(a.employee_code),String(a.display_name),String(a.department_name),String(a.group_name),String(a.appointment_date),String(a.appointment_time),String(a.status),String(a.services)]));decorate(report);
  const info=book.addWorksheet('ตัวกรอง');info.addRow(['รายการ','ค่า']);for(const [k,v] of params)info.addRow([k,v]);info.addRow(['generated_at',new Date().toISOString()]);info.addRow(['ข้อควรทราบ','Appointments สำหรับแก้ไขนัด SCHEDULED เท่านั้น; sheet รายงานรวมสถานะตามตัวกรอง']);decorate(info);
  await transaction(db=>audit(db,actor.id,'EXPORT','appointments',null,{count:data.length,year:params.get('year')}));
  return Buffer.from(await book.xlsx.writeBuffer());
}
export {isDate};
