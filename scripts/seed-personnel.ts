import 'dotenv/config';
import { readFile,stat } from 'node:fs/promises';
import { closePool } from '../src/server/db';
import { importPersonnelSeed } from '../src/server/personnel-seed';
async function main(){
  const file=process.argv[2]??'private/personnel.seed.json';
  if((await stat(file)).size>2*1024*1024)throw Error('Seed file exceeds 2 MB');
  const result=await importPersonnelSeed(JSON.parse(await readFile(file,'utf8')),null);
  console.log(JSON.stringify(result));
}
main().catch(e=>{console.error(e.code??e.message);process.exitCode=1;}).finally(closePool);
