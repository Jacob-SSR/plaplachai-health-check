import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from 'node:crypto';
import { ensure } from '../domain/validation';
export const sha256=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');
export function canonicalJson(value:unknown):string {
  if(Array.isArray(value))return '['+value.map(canonicalJson).join(',')+']';
  if(value!==null&&typeof value==='object')return '{'+Object.entries(value).filter(([,v])=>v!==undefined).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>JSON.stringify(k)+':'+canonicalJson(v)).join(',')+'}';
  return JSON.stringify(value)??'null';
}
function key() { const key=Buffer.from(process.env.DATA_ENCRYPTION_KEY ?? '', 'base64'); ensure(key.length===32,'ยังไม่ได้ตั้งกุญแจเข้ารหัสข้อมูล',503); return key; }
export function encrypt(value:string) {
  const iv=randomBytes(12), cipher=createCipheriv('aes-256-gcm',key(),iv);
  return ['v1',iv.toString('base64'),Buffer.concat([cipher.update(value,'utf8'),cipher.final()]).toString('base64'),cipher.getAuthTag().toString('base64')].join('.');
}
export function decrypt(value:string) {
  const [version,iv,data,tag]=value.split('.'); ensure(version==='v1','ไม่รองรับรุ่นกุญแจ',503);
  const c=createDecipheriv('aes-256-gcm',key(),Buffer.from(iv,'base64')); c.setAuthTag(Buffer.from(tag,'base64'));
  return Buffer.concat([c.update(Buffer.from(data,'base64')),c.final()]).toString('utf8');
}
export function cidHash(cid:string) {
  const secret=process.env.CID_HMAC_KEY; ensure(secret && secret.length>=32,'ยังไม่ได้ตั้ง HMAC key',503);
  return createHmac('sha256',secret).update(cid).digest('hex');
}
