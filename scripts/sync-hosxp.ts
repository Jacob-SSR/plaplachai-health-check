import 'dotenv/config';
import { syncHosxpPersonnel, closeHosxpPool } from '../src/server/hosxp';
import { syncHosxpAppointments } from '../src/server/hosxp-sync';
import { closePool } from '../src/server/db';

async function main() {
  const personnel = await syncHosxpPersonnel();
  const appointments = await syncHosxpAppointments();
  console.log(JSON.stringify({personnel, appointments}));
}
main().catch(error=>{
  console.error(error?.code ?? 'HOSXP_SYNC_FAILED');process.exitCode=1;
}).finally(async()=>{await closePool();await closeHosxpPool();});
