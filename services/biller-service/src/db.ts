import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import mysql, { type PoolConnection, type ResultSetHeader, type RowDataPacket } from "mysql2/promise";
import { config } from "./config";
import { logger } from "./logger";

// Every statement goes through query() (client-side placeholders), so the injected
// tracer can prepend its DBM trace comment to the SQL text.
export const pool = mysql.createPool({
  ...config.db,
  connectionLimit: 10,
  timezone: "Z",
  supportBigNumbers: true,
});

export async function rows<T>(sql: string, params: unknown[] = [], conn: Pick<PoolConnection, "query"> = pool): Promise<T[]> {
  const [r] = await conn.query<RowDataPacket[]>(sql, params);
  return r as T[];
}

export async function exec(sql: string, params: unknown[] = [], conn: Pick<PoolConnection, "query"> = pool): Promise<number> {
  const [r] = await conn.query<ResultSetHeader>(sql, params);
  return r.affectedRows;
}

export async function inTx<T>(fn: (conn: PoolConnection) => Promise<T>): Promise<T> {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const out = await fn(conn);
    await conn.commit();
    return out;
  } catch (err) {
    await conn.rollback().catch(() => undefined);
    throw err;
  } finally {
    conn.release();
  }
}

// Applies migrations/*.sql in order, once each. A named lock serialises replicas that
// start together. MySQL DDL auto-commits, so each file must be safe to re-run up to
// its first failing statement — keep files small.
export async function migrate(dir = join(__dirname, "..", "migrations")): Promise<void> {
  const conn = await mysql.createConnection({ ...config.db, multipleStatements: true });
  try {
    await conn.query("SELECT GET_LOCK('biller-service-migrations', 60)");
    await conn.query(
      "CREATE TABLE IF NOT EXISTS schema_migrations (version VARCHAR(128) PRIMARY KEY, applied_at DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)))",
    );
    const [done] = await conn.query<RowDataPacket[]>("SELECT version FROM schema_migrations");
    const applied = new Set(done.map((r) => r.version));
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
      if (applied.has(file)) continue;
      await conn.query(readFileSync(join(dir, file), "utf8"));
      await conn.query("INSERT INTO schema_migrations (version) VALUES (?)", [file]);
      logger.info({ migration: file }, "migration applied");
    }
  } finally {
    await conn.query("SELECT RELEASE_LOCK('biller-service-migrations')").catch(() => undefined);
    await conn.end();
  }
}
