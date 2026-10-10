import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import bcrypt from "bcryptjs";
import { Pool } from "pg";
import { config } from "./config";
import { logger } from "./logger";

export const pool = new Pool({ ...config.db, max: 10, idleTimeoutMillis: 30_000 });

// Applies migrations/*.sql in order, once each. Plain SQL keeps the schema reviewable
// next to the OpenAPI contract.
export async function migrate(dir = join(__dirname, "..", "migrations")): Promise<void> {
  // Replicas start together; a session-level advisory lock serialises their migrations.
  const lock = await pool.connect();
  try {
    await lock.query("SELECT pg_advisory_lock(hashtext('auth-service-migrations'))");
    await applyMigrations(dir);
  } finally {
    await lock.query("SELECT pg_advisory_unlock(hashtext('auth-service-migrations'))").catch(() => undefined);
    lock.release();
  }
}

async function applyMigrations(dir: string): Promise<void> {
  await pool.query(
    "CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())",
  );
  const applied = new Set((await pool.query("SELECT version FROM schema_migrations")).rows.map((r) => r.version));
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    if (applied.has(file)) continue;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(readFileSync(join(dir, file), "utf8"));
      await client.query("INSERT INTO schema_migrations (version) VALUES ($1)", [file]);
      await client.query("COMMIT");
      logger.info({ migration: file }, "migration applied");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }
}

interface SeedCustomer {
  cif: string;
  username: string;
  full_name: string;
  email: string;
  phone: string;
  segment: string;
  address: string;
  nik: string;
  birth_date: string;
  mfa_enabled: boolean;
}

// Loads the shared synthetic customer base. Idempotent: existing CIFs are left alone,
// so customers who changed settings in a demo keep them across restarts.
export async function seedCustomers(): Promise<number> {
  const { customers } = JSON.parse(readFileSync(config.seedFile, "utf8")) as { customers: SeedCustomer[] };
  const hash = await bcrypt.hash(config.demoCustomerPassword, 10);
  let inserted = 0;
  for (const c of customers) {
    const res = await pool.query(
      `INSERT INTO customers (cif, username, full_name, email, phone, segment, address, nik, birth_date, mfa_enabled, password_hash)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT (cif) DO NOTHING`,
      [c.cif, c.username, c.full_name, c.email, c.phone, c.segment, c.address, c.nik, c.birth_date, c.mfa_enabled, hash],
    );
    inserted += res.rowCount ?? 0;
  }
  return inserted;
}
