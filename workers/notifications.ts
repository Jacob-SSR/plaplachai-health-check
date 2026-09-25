import 'dotenv/config';
import { pool,execute } from '../src/server/db';
import { scheduleReminders,dispatchOne } from '../src/server/notifications';
let stopping=false;
process.on('SIGINT',()=>{stopping=true;});process.on('SIGTERM',()=>{stopping=true;});
async function tick() {
  await scheduleReminders();
  for(let n=0;n<100&&!stopping;n++){if(!await dispatchOne())break;await new Promise(resolve=>setTimeout(resolve,1000));}
  await execute("UPDATE import_batches SET status='EXPIRED' WHERE status IN ('READY','INVALID') AND expires_at<UTC_TIMESTAMP()");
  // Staging contains scheduling data only. Keep audit/counts, remove expired payloads.
  await execute("DELETE r FROM import_rows r JOIN import_batches b ON b.id=r.batch_id WHERE b.expires_at<DATE_SUB(UTC_TIMESTAMP(),INTERVAL 7 DAY)");
  await execute('DELETE FROM user_sessions WHERE expires_at<UTC_TIMESTAMP()');
  await execute('DELETE FROM login_limits WHERE reset_at<UTC_TIMESTAMP()');
}
async function main(){
  do{try{await tick();}catch(e){console.error('Notification worker failed:',e&&typeof e==='object'&&'code' in e?e.code:'WORKER_ERROR');if(process.argv.includes('--once'))process.exitCode=1;}
    if(process.argv.includes('--once'))break;
    for(let i=0;i<60&&!stopping;i++)await new Promise(resolve=>setTimeout(resolve,1000));
  }while(!stopping);
  await pool().end();
}
void main();
