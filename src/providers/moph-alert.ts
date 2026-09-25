export type Delivery={outcome:'ACCEPTED'|'REJECTED'|'UNKNOWN'|'NOT_SENT';httpStatus?:number;providerCode?:string;safeError?:string};
export interface NotificationProvider {send(cid:string,text:string):Promise<Delivery>}
export function classifyResponse(httpStatus:number,body:unknown):Delivery {
  const rawCode=body&&typeof body==='object'&&'message_code' in body?String(body.message_code):undefined;
  const code=rawCode&&/^\d{3}$/.test(rawCode)?rawCode:undefined;
  const rawMessage=body&&typeof body==='object'&&'message' in body?body.message:undefined;
  const message=typeof rawMessage==='string'&&rawMessage.length<=200?rawMessage.trim().toLowerCase().replace(/\s+/g,' '):'';
  const info={httpStatus,providerCode:code};
  // Never expose provider text: an unrecognized response may contain recipient IDs or credentials.
  const uncertain:Delivery={outcome:'UNKNOWN',...info,safeError:'ยังยืนยันไม่ได้ว่าผู้ให้บริการรับข้อความหรือไม่ กรุณาตรวจสอบก่อนส่งซ้ำ'};
  if(httpStatus>=500)return uncertain;
  if(httpStatus>=200&&httpStatus<300&&code==='200')return {outcome:'ACCEPTED',httpStatus,providerCode:code};
  if(code==='401'){
    if(message==='client-key or secret-key incorrect')return {outcome:'REJECTED',...info,safeError:'MOPH แจ้งว่า Client_ID หรือ Secret ไม่ถูกต้อง ให้คัดลอกคู่ที่เปิดใช้งานจาก CMS ใส่ MOPH_CLIENT_KEY/MOPH_SECRET_KEY แล้ว restart เว็บและ worker'};
    if(message==='no cid')return {outcome:'REJECTED',...info,safeError:'MOPH แจ้งว่าไม่พบ CID ที่ต้องการส่ง ให้ตรวจเลขบัตรประชาชนที่บันทึกกับบัญชีผู้รับใน LINE หมอพร้อม ข้อความนี้ไม่ได้ระบุว่า API Key ผิด'};
    if(message==='hospital logo is empty')return {outcome:'REJECTED',...info,safeError:'MOPH แจ้งว่ายังไม่มีรูปโรงพยาบาล ให้ตั้งโลโก้ใน CMS MOPH Alert แล้วทดสอบใหม่'};
    return {outcome:'REJECTED',...info,safeError:'MOPH ตอบรหัส 401 แต่ไม่ตรงข้อความที่ระบุในคู่มือ จึงยังแยกไม่ได้ว่าเป็น Key ข้อมูลผู้รับ หรือการตั้งค่าหน่วยบริการ ให้แจ้งรหัสคำขอนี้แก่ผู้ดูแล'};
  }
  if(code==='404')return {outcome:'REJECTED',...info,safeError:message==='error template'?'MOPH ตอบ Error template (404) ซึ่งคู่มือใช้กับหลายสาเหตุ ทั้ง template, LINE user และ CID ที่ลงทะเบียน ต้องให้ MOPH ตรวจผู้รับและสิทธิ์บริการ จึงยังฟันธงไม่ได้':'MOPH ตอบรหัส 404 กรุณาให้ผู้ดูแล MOPH ตรวจการลงทะเบียนผู้รับและสิทธิ์บริการโดยใช้รหัสผลตอบกลับ'};
  if(httpStatus===401||httpStatus===403)return {outcome:'REJECTED',...info,safeError:'เซิร์ฟเวอร์ MOPH ปฏิเสธการยืนยันตัวตนหรือสิทธิ์ ให้ตรวจ Client_ID/Secret และสถานะเปิดใช้ใน CMS โดยคำตอบนี้ยังไม่ได้ระบุปัญหา CID'};
  return uncertain;
}
export class MophAlertProvider implements NotificationProvider {
  constructor(private transport:typeof fetch=fetch){}
  async send(cid:string,text:string):Promise<Delivery> {
    const client=process.env.MOPH_CLIENT_KEY?.trim(),secret=process.env.MOPH_SECRET_KEY?.trim();
    if(process.env.MOPH_LIVE_ENABLED!=='true'||!client||!secret)return {outcome:'NOT_SENT',safeError:'ยังไม่เปิด live หรือยังไม่ได้ตั้ง credential ฝั่ง server'};
    try {
      const headers:Record<string,string>={'Content-Type':'application/json','client-key':client,'secret-key':secret};
      if(process.env.MOPH_BEARER_TOKEN?.trim())headers.Authorization=`Bearer ${process.env.MOPH_BEARER_TOKEN.trim()}`;
      const response=await this.transport('https://morpromt2c.moph.go.th/alert/v3.1/messages',{
        method:'POST',headers,redirect:'error',signal:AbortSignal.timeout(15000),
        body:JSON.stringify({cid:[cid],messages:[{type:'text',text}],message_title:'แจ้งเตือนนัดตรวจสุขภาพ',message_text:'นัดตรวจสุขภาพบุคลากร',message_type:'HPT'}),
      });
      const reader=response.body?.getReader();const chunks:Uint8Array[]=[];let size=0;
      if(reader)while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>65536){await reader.cancel();return {outcome:'UNKNOWN',httpStatus:response.status,safeError:'รูปแบบคำตอบจาก provider ไม่ตรงที่คาด'};}chunks.push(value);}
      const raw=Buffer.concat(chunks).toString('utf8');
      let body:unknown;try{body=JSON.parse(raw);}catch{if(response.status===401||response.status===403)return classifyResponse(response.status,null);return {outcome:'UNKNOWN',httpStatus:response.status,safeError:'provider ไม่ได้ตอบ JSON'};}
      return classifyResponse(response.status,body);
    } catch {return {outcome:'UNKNOWN',safeError:'การเชื่อมต่อขัดข้องหรือหมดเวลา อาจส่งแล้ว ต้องตรวจสอบก่อน retry'};}
  }
}
