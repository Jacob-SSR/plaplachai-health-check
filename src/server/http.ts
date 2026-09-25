import { randomUUID } from 'node:crypto';
import { ZodError } from 'zod';
import { NextResponse } from 'next/server';
import { AppError,ensure } from '../domain/validation';
export async function boundedBody(req:Request,max:number) {
  if(req.headers.has('content-length'))ensure(Number(req.headers.get('content-length'))<=max,'ข้อมูลมีขนาดเกินกำหนด',413);
  const reader=req.body?.getReader();if(!reader)return Buffer.alloc(0);
  const chunks:Buffer[]=[];let size=0;
  while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>max){await reader.cancel();throw new AppError(413,'TOO_LARGE','ข้อมูลมีขนาดเกินกำหนด');}chunks.push(Buffer.from(value));}
  return Buffer.concat(chunks);
}
export async function jsonBody(req:Request) {
  ensure(req.headers.get('content-type')?.includes('application/json'),'ต้องส่ง application/json',415);
  const raw=await boundedBody(req,65536);try{return JSON.parse(raw.toString('utf8'));}catch{throw new AppError(400,'INVALID_JSON','รูปแบบ JSON ไม่ถูกต้อง');}
}
export function errorResponse(error:unknown) {
  const requestId=randomUUID();
  if(error instanceof AppError)return NextResponse.json({code:error.code,message:error.message,requestId},{status:error.status});
  if(error instanceof ZodError)return NextResponse.json({code:'VALIDATION',message:'กรุณาตรวจสอบข้อมูลในแบบฟอร์ม',fieldErrors:error.issues.map(e=>({field:e.path.join('.'),message:e.message})),requestId},{status:422});
  const code=error&&typeof error==='object'&&'code' in error?String(error.code):'';
  if(code==='ER_DUP_ENTRY')return NextResponse.json({code:'DUPLICATE',message:'มีรหัสหรือรายการนี้อยู่แล้ว',requestId},{status:409});
  if(code==='ER_NO_REFERENCED_ROW_2'||code==='ER_ROW_IS_REFERENCED_2')return NextResponse.json({code:'RELATIONSHIP',message:'ข้อมูลอ้างอิงไม่มีอยู่หรือมีประวัติใช้งานแล้ว',requestId},{status:409});
  if(code==='ER_LOCK_DEADLOCK'||code==='ER_LOCK_WAIT_TIMEOUT')return NextResponse.json({code:'BUSY',message:'มีการแก้ไขข้อมูลพร้อมกัน กรุณาลองใหม่',requestId},{status:409});
  console.error({requestId,code:code||'INTERNAL_ERROR'});
  return NextResponse.json({code:'UNAVAILABLE',message:'ระบบยังไม่พร้อม กรุณาตรวจการเชื่อมต่อฐานข้อมูลหรือติดต่อผู้ดูแล',requestId},{status:503});
}
export function download(buffer:Buffer,filename:string) {
  return new NextResponse(new Uint8Array(buffer),{headers:{'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':`attachment; filename="${filename}"`,'Cache-Control':'no-store'}});
}
