import 'dotenv/config';
import { readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pool, rows, execute } from '../src/server/db';

export async function migrate() {
  if(!/^ppc_health_check(?:_[a-z0-9]+)*$/.test(process.env.DB_NAME??''))throw new Error('Refuse migration: use a separate ppc_health_check database (optional suffix allowed).');
  const db=await pool().getConnection();
  try {
    const [[lock]]=await db.query<import('mysql2').RowDataPacket[]>("SELECT GET_LOCK('ppc_health_check_migration',30) acquired");
    if(lock.acquired!==1) throw new Error('Migration lock unavailable');
    await db.query(`CREATE TABLE IF NOT EXISTS schema_migrations(name VARCHAR(200) PRIMARY KEY,checksum CHAR(64) NOT NULL,applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
    for(const name of (await readdir('database/migrations')).filter(x=>x.endsWith('.sql')).sort()) {
      const sql=await readFile(`database/migrations/${name}`,'utf8');
      const checksum=createHash('sha256').update(sql).digest('hex');
      const [existing]=await rows<{checksum:string}>('SELECT checksum FROM schema_migrations WHERE name=?',[name],db);
      if(existing) {if(existing.checksum!==checksum) throw new Error(`Applied migration changed: ${name}`);continue;}
      // These reviewed migrations contain no procedures or semicolons inside strings.
      for(const statement of sql.split(';').map(x=>x.trim()).filter(Boolean)) await db.query(statement);
      await execute('INSERT INTO schema_migrations(name,checksum) VALUES(?,?)',[name,checksum],db);
      console.log(`Applied ${name}`);
    }
  } finally {await db.query("SELECT RELEASE_LOCK('ppc_health_check_migration')");db.release();}
}
if(process.argv[1]?.endsWith('migrate.ts')) migrate().then(()=>pool().end()).catch(e=>{console.error(e.message);process.exitCode=1;void pool().end();});
