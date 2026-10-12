import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import type { PoolConnection } from "mysql2/promise";
import { config } from "./config";
import { exec, inTx, rows } from "./db";
import { ApiError, notFound } from "./errors";
import { CATALOG, welcomePoints, type Earn, type Segment } from "./rules";

// UUID derived from a stable key, so replays of the same source map to the same row.
export function derivedId(...parts: string[]): string {
  const h = createHash("sha1").update(parts.join(":")).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

// CIF -> segment from the shared synthetic customer base, for the earn multiplier.
export const segments = new Map<string, Segment>();

async function addPoints(conn: PoolConnection, cif: string, delta: number): Promise<void> {
  await exec(`INSERT INTO balances (cif, points) VALUES (?, ?)
      ON DUPLICATE KEY UPDATE points = points + VALUES(points), updated_at = UTC_TIMESTAMP(3)`, [cif, delta], conn);
}

// Records one earn; the unique source_event_id makes Kafka redelivery a no-op.
// Returns false for a duplicate.
export async function earn(e: Earn, sourceEventId: string, occurredAt: Date): Promise<boolean> {
  return inTx(async (conn) => {
    const inserted = await exec(`INSERT IGNORE INTO entries (id, cif, type, points, description, reference, source_event_id, created_at)
        VALUES (?, ?, 'EARN', ?, ?, ?, ?, ?)`,
      [derivedId("earn", sourceEventId), e.cif, e.points, e.description, e.reference, sourceEventId, occurredAt], conn);
    if (inserted) await addPoints(conn, e.cif, e.points);
    return inserted > 0;
  });
}

// Loads segments and grants the one-off welcome balance. Idempotent across restarts and replicas.
export async function seedWelcome(): Promise<number> {
  const { customers } = JSON.parse(readFileSync(config.seedFile, "utf8")) as { customers: { cif: string; segment: Segment }[] };
  let granted = 0;
  for (const c of customers) {
    segments.set(c.cif, c.segment);
    const id = derivedId("welcome", c.cif);
    const ok = await earn({ cif: c.cif, points: welcomePoints(c.cif, c.segment), description: "Poin Selamat Datang", reference: "WELCOME", source: "transfer" },
      id, new Date());
    if (ok) granted++;
  }
  return granted;
}

export interface EntryRow {
  id: string;
  type: "EARN" | "REDEEM" | "EXPIRE";
  points: number;
  description: string;
  reference: string | null;
  voucher_code: string | null;
  created_at: Date;
}

export const entryView = (e: EntryRow) => ({
  id: e.id, type: e.type, points: e.points, description: e.description,
  ...(e.reference ? { reference: e.reference } : {}), ...(e.voucher_code ? { voucher_code: e.voucher_code } : {}),
  created_at: e.created_at.toISOString(),
});

export async function balanceOf(cif: string): Promise<{ points: number; points90d: number }> {
  const [b] = await rows<{ points: number }>("SELECT points FROM balances WHERE cif = ?", [cif]);
  const [t] = await rows<{ p: string | null }>(
    "SELECT SUM(points) AS p FROM entries WHERE cif = ? AND type = 'EARN' AND created_at >= UTC_TIMESTAMP(3) - INTERVAL 90 DAY", [cif]);
  return { points: b?.points ?? 0, points90d: Number(t?.p ?? 0) };
}

export async function history(cif: string, page: number, size: number): Promise<EntryRow[]> {
  return rows<EntryRow>("SELECT * FROM entries WHERE cif = ? ORDER BY created_at DESC, id LIMIT ? OFFSET ?", [cif, size, (page - 1) * size]);
}

// Voucher codes look like NSB-KOPI-7Q4M-2XKD (no 0/O/1/I to avoid misreading).
function voucherCode(itemCode: string): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const pick = (n: number) => Array.from(randomBytes(n), (b) => alphabet[b % alphabet.length]).join("");
  return `NSB-${itemCode.split("-")[1]}-${pick(4)}-${pick(4)}`;
}

// Spends points under a row lock on the balance, so two concurrent redemptions can't overdraw.
export async function redeem(cif: string, itemCode: string, idempotencyKey: string): Promise<EntryRow> {
  const item = CATALOG.find((i) => i.code === itemCode);
  if (!item) throw notFound("Hadiah tidak ditemukan");
  const [replay] = await rows<EntryRow>("SELECT * FROM entries WHERE cif = ? AND idempotency_key = ?", [cif, idempotencyKey]);
  if (replay) return replay;
  const id = randomUUID();
  await inTx(async (conn) => {
    const [b] = await rows<{ points: number }>("SELECT points FROM balances WHERE cif = ? FOR UPDATE", [cif], conn);
    if ((b?.points ?? 0) < item.points_cost) {
      throw new ApiError(422, "INSUFFICIENT_POINTS", `Poin tidak cukup: perlu ${item.points_cost.toLocaleString("id-ID")} poin`);
    }
    await exec(`INSERT INTO entries (id, cif, type, points, description, reference, idempotency_key, voucher_code, created_at)
        VALUES (?, ?, 'REDEEM', ?, ?, ?, ?, ?, UTC_TIMESTAMP(3))`,
      [id, cif, -item.points_cost, `Tukar ${item.name}`, item.code, idempotencyKey, voucherCode(item.code)], conn);
    await addPoints(conn, cif, -item.points_cost);
  });
  const [row] = await rows<EntryRow>("SELECT * FROM entries WHERE id = ?", [id]);
  return row;
}
