import 'dotenv/config';
import { readFile, stat } from 'node:fs/promises';
import { closePool } from '../src/server/db';
import { importHrPersonnel } from '../src/server/hr-personnel';
async function main() {
  const file = process.argv[2];
  if (!file) throw Error('Usage: npm run hr:import -- "C:/path/INFOMATION_PERSON.xlsx"');
  if ((await stat(file)).size > 10 * 1024 * 1024) throw Error('File exceeds 10 MB');
  console.log(JSON.stringify(await importHrPersonnel(await readFile(file), null)));
}
main().catch(e => { console.error(e.message ?? e); process.exitCode = 1; }).finally(closePool);
