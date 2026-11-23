import { BILLERS } from "./catalog";
import { ppob } from "./clients";
import { exec, rows } from "./db";
import { ApiError } from "./errors";
import { logger } from "./logger";
import tracer from "./tracer";

// Biller availability: operations (EP2: the Digital Channels workflows) can take a biller out of
// service so customers stop failing at a broken partner. A disabled biller whose auto_enable_at
// has passed counts as available: the safety net needs no background job.

export interface BillerState {
  code: string;
  name: string;
  available: boolean;
  unavailable_reason?: string;
  unavailable_since?: string;
  auto_enable_at?: string;
  changed_by?: string;
}

interface Row {
  biller_code: string;
  available: number;
  reason: string | null;
  changed_by: string;
  unavailable_since: Date | null;
  auto_enable_at: Date | null;
}

const LIVE = "available OR COALESCE(auto_enable_at <= UTC_TIMESTAMP(3), FALSE) AS available";

export async function billerStates(): Promise<Record<string, BillerState>> {
  const out: Record<string, BillerState> = {};
  for (const [code, b] of Object.entries(BILLERS)) out[code] = { code, name: b.name, available: true };
  const list = await rows<Row>(`SELECT biller_code, ${LIVE}, reason, changed_by, unavailable_since, auto_enable_at FROM biller_availability`);
  for (const r of list) {
    const st = out[r.biller_code];
    if (!st) continue;
    st.changed_by = r.changed_by;
    if (r.available) continue;
    st.available = false;
    st.unavailable_reason = r.reason ?? "";
    st.unavailable_since = r.unavailable_since?.toISOString();
    st.auto_enable_at = r.auto_enable_at?.toISOString();
  }
  return out;
}

/** 422 BILLER_DISABLED while operations has the biller switched off. */
export async function assertAvailable(code: string): Promise<void> {
  const [r] = await rows<{ available: number }>(`SELECT ${LIVE} FROM biller_availability WHERE biller_code = ?`, [code]);
  if (!r || r.available) return;
  tracer.scope().active()?.setTag("biller.disabled", true);
  throw new ApiError(422, "BILLER_DISABLED", `${BILLERS[code].name} sedang tidak tersedia sementara, silakan gunakan e-wallet atau metode lain`);
}

export async function setAvailability(code: string, available: boolean, changedBy: string, reason: string, autoEnableAfterMinutes: number) {
  if (available) {
    await exec(`INSERT INTO biller_availability (biller_code, available, reason, changed_by) VALUES (?, TRUE, ?, ?)
        ON DUPLICATE KEY UPDATE available = TRUE, reason = VALUES(reason), changed_by = VALUES(changed_by),
          changed_at = UTC_TIMESTAMP(3), unavailable_since = NULL, auto_enable_at = NULL`, [code, reason, changedBy]);
  } else {
    // Keep the original outage start when it is switched off again while already off.
    await exec(`INSERT INTO biller_availability (biller_code, available, reason, changed_by, unavailable_since, auto_enable_at)
        VALUES (?, FALSE, ?, ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3) + INTERVAL ? MINUTE)
        ON DUPLICATE KEY UPDATE
          unavailable_since = IF(available OR COALESCE(auto_enable_at <= UTC_TIMESTAMP(3), FALSE), UTC_TIMESTAMP(3), unavailable_since),
          available = FALSE, reason = VALUES(reason), changed_by = VALUES(changed_by), changed_at = UTC_TIMESTAMP(3),
          auto_enable_at = VALUES(auto_enable_at)`, [code, reason, changedBy, autoEnableAfterMinutes]);
  }
  logger.info({ biller: code, available, changed_by: changedBy, reason, partner: `ppob:${code}` }, "biller availability changed");
  return (await billerStates())[code];
}

// While a biller is off, no customer traffic reaches it, so its error rate would go silent. One
// inquiry (no money involved) per disabled biller every interval keeps the partner's health visible:
// recovery is proven with data before anyone switches it back on.
export async function healthCheckOnce(): Promise<void> {
  const states = await billerStates();
  for (const st of Object.values(states)) {
    tracer.dogstatsd.gauge("nusabank.biller.available", st.available ? 1 : 0, { biller: st.code });
    if (st.available || !BILLERS[st.code].customerNumber.test(HEALTH_CHECK_NUMBER)) continue;
    await tracer.trace("biller.health_check", { resource: st.code, tags: { "biller.code": st.code } }, async () => {
      const out = await ppob("inquiry", st.code, {
        biller_code: st.code, customer_number: HEALTH_CHECK_NUMBER, amount: { amount: "10000", currency: "IDR" },
      });
      logger.info({ biller: st.code, outcome: out.kind, partner: `ppob:${st.code}` }, "disabled biller health check");
    });
  }
}

// A number Nusa Bank registered with the aggregator for these checks; inquiries never charge it.
const HEALTH_CHECK_NUMBER = "081100012345";

export function startHealthCheck(intervalMs = 30_000): NodeJS.Timeout {
  return setInterval(() => {
    healthCheckOnce().catch((err) => logger.warn({ err }, "biller health check failed"));
  }, intervalMs);
}
