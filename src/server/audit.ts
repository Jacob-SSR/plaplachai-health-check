import { randomUUID } from 'node:crypto';
import { execute, type DB } from './db';
export async function audit(db:DB,actor:number|null,action:string,entity:string,entityId:string|number|null,changes:unknown={}) {
  // Callers pass allowlisted diffs only. Never pass request bodies, CID, credentials, or clinical results.
  await execute('INSERT INTO audit_logs(actor_user_id,action,entity_type,entity_id,changes,request_id) VALUES(?,?,?,?,?,?)',
    [actor,action,entity,entityId==null?null:String(entityId),JSON.stringify(changes),randomUUID()],db);
}
