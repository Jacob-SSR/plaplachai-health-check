export type Delivery={outcome:'ACCEPTED'|'REJECTED'|'UNKNOWN'|'NOT_SENT';httpStatus?:number;providerCode?:string;safeError?:string};
export interface NotificationProvider {send(cid:string,text:string):Promise<Delivery>}
export function classifyResponse(httpStatus:number,body:unknown):Delivery {
  const rawCode=body&&typeof body==='object'&&'message_code' in body?String(body.message_code):undefined;
  const code=rawCode&&/^\d{3}$/.test(rawCode)?rawCode:undefined;
  if(httpStatus>=200&&httpStatus<300&&code==='200')return {outcome:'ACCEPTED',httpStatus,providerCode:code};
  if(code==='401'||code==='404'||httpStatus===401||httpStatus===403)return {outcome:'REJECTED',httpStatus,providerCode:code,safeError:'ตรวจสอบ credential หรือการลงทะเบียนผู้รับกับ MOPH Alert'};
  return {outcome:'UNKNOWN',httpStatus,providerCode:code,safeError:'ยังยืนยันไม่ได้ว่าผู้ให้บริการรับข้อความหรือไม่ กรุณาตรวจสอบก่อนส่งซ้ำ'};
}
export class MophAlertProvider implements NotificationProvider {
  constructor(private transport:typeof fetch=fetch){}
  async send(cid:string,text:string):Promise<Delivery> {
    const client=process.env.MOPH_CLIENT_KEY,secret=process.env.MOPH_SECRET_KEY;
    if(process.env.MOPH_LIVE_ENABLED!=='true'||!client||!secret)return {outcome:'NOT_SENT',safeError:'ยังไม่เปิด live หรือยังไม่ได้ตั้ง credential ฝั่ง server'};
    try {
      const headers:Record<string,string>={'Content-Type':'application/json','client-key':client,'secret-key':secret};
      if(process.env.MOPH_BEARER_TOKEN)headers.Authorization=`Bearer ${process.env.MOPH_BEARER_TOKEN}`;
      const response=await this.transport('https://morpromt2c.moph.go.th/alert/v3.1/messages',{
        method:'POST',headers,redirect:'error',signal:AbortSignal.timeout(15000),
        body:JSON.stringify({cid:[cid],messages:[{type:'text',text}],message_title:'แจ้งเตือนนัดตรวจสุขภาพ',message_text:'นัดตรวจสุขภาพบุคลากร',message_type:'HPT'}),
      });
      const reader=response.body?.getReader();const chunks:Uint8Array[]=[];let size=0;
      if(reader)while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>65536){await reader.cancel();return {outcome:'UNKNOWN',httpStatus:response.status,safeError:'รูปแบบคำตอบจาก provider ไม่ตรงที่คาด'};}chunks.push(value);}
      const raw=Buffer.concat(chunks).toString('utf8');
      let body:unknown;try{body=JSON.parse(raw);}catch{return {outcome:'UNKNOWN',httpStatus:response.status,safeError:'provider ไม่ได้ตอบ JSON'};}
      return classifyResponse(response.status,body);
    } catch {return {outcome:'UNKNOWN',safeError:'การเชื่อมต่อขัดข้องหรือหมดเวลา อาจส่งแล้ว ต้องตรวจสอบก่อน retry'};}
  }
}
