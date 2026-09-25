import mysql, { type PoolConnection, type ResultSetHeader, type RowDataPacket } from 'mysql2/promise';
import 'dotenv/config';

export type DB = PoolConnection;
export type Row = Record<string, unknown>;
function bindings(values: unknown[]) {
  return values.map(value => {
    if(value===null || typeof value==='string' || typeof value==='number' || typeof value==='boolean' || value instanceof Date || Buffer.isBuffer(value)) return value;
    throw new Error('INVALID_SQL_BINDING');
  });
}
const globalDb = globalThis as unknown as { healthPool?: mysql.Pool };
export function pool() {
  if (!process.env.DB_NAME || !process.env.DB_USER) throw new Error('DATABASE_NOT_CONFIGURED');
  if(globalDb.healthPool)return globalDb.healthPool;
  const created=mysql.createPool({
    host: process.env.DB_HOST ?? '127.0.0.1', port: Number(process.env.DB_PORT ?? 3307),
    database: process.env.DB_NAME, user: process.env.DB_USER, password: process.env.DB_PASSWORD,
    charset: 'utf8mb4', timezone: 'Z', dateStrings: true, decimalNumbers: true,
    connectionLimit: 10, queueLimit: 100, connectTimeout: 10000, multipleStatements: false,
  });
  created.on('connection',connection=>{connection.query("SET SESSION time_zone='+00:00'");});
  globalDb.healthPool=created;
  return created;
}
export async function rows<T = Row>(sql: string, values: unknown[] = [], db?: DB): Promise<T[]> {
  const [r] = await (db ?? pool()).execute<RowDataPacket[]>(sql, bindings(values));
  return r as T[];
}
export async function execute(sql: string, values: unknown[] = [], db?: DB) {
  const [r] = await (db ?? pool()).execute<ResultSetHeader>(sql, bindings(values));
  return r;
}
export async function transaction<T>(fn: (db: DB) => Promise<T>): Promise<T> {
  const db = await pool().getConnection();
  try { await db.beginTransaction(); const result = await fn(db); await db.commit(); return result; }
  catch (error) { await db.rollback(); throw error; }
  finally { db.release(); }
}
export async function closePool(){const active=globalDb.healthPool;globalDb.healthPool=undefined;if(active)await active.end();}
