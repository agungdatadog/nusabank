import { config } from "./config";
import { ApiError } from "./errors";
import { logger } from "./logger";
import tracer from "./tracer";

const ACCOUNT = "account-service";

interface CallResult {
  status: number;
  body: Record<string, unknown>;
}

// fetch is traced by the injected tracer, which also propagates trace headers.
async function call(base: string, method: string, path: string, body?: unknown, headers: Record<string, string> = {}, timeoutMs = 5000): Promise<CallResult> {
  const res = await fetch(base + path, {
    method,
    headers: { ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...headers },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  let parsed: Record<string, unknown> = {};
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    /* non-JSON error body */
  }
  return { status: res.status, body: parsed };
}

const accountDown = () => new ApiError(502, "PARTNER_UNAVAILABLE", "Layanan rekening sedang tidak tersedia", ACCOUNT);

// ---- account-service (/internal) ----

export interface AccountRef {
  account_number: string;
  cif: string;
  owner_name: string;
  currency: string;
  status: string;
}

export async function lookupAccount(number: string): Promise<AccountRef | null> {
  let res: CallResult;
  try {
    res = await call(config.accountServiceUrl, "GET", `/internal/accounts/${number}`);
  } catch {
    throw accountDown();
  }
  if (res.status === 404) return null;
  if (res.status !== 200) throw accountDown();
  return res.body as unknown as AccountRef;
}

// Reserves amount + fee. 422 is a business rejection (insufficient balance) and is
// passed through with account-service's own code and message.
export async function createHold(number: string, total: number, paymentId: string): Promise<string> {
  let res: CallResult;
  try {
    res = await call(config.accountServiceUrl, "POST", `/internal/accounts/${number}/holds`,
      { amount: { amount: String(total), currency: "IDR" }, reference: paymentId, purpose: "BILL_PAYMENT" },
      { "Idempotency-Key": paymentId });
  } catch {
    throw accountDown();
  }
  if (res.status === 422) {
    throw new ApiError(422, String(res.body.code ?? "INSUFFICIENT_BALANCE"), String(res.body.message ?? "Saldo tidak mencukupi"));
  }
  if (res.status !== 201) throw accountDown();
  return String(res.body.id);
}

export async function releaseHold(holdId: string): Promise<void> {
  try {
    const res = await call(config.accountServiceUrl, "DELETE", `/internal/holds/${holdId}`);
    if (res.status !== 204 && res.status !== 404) logger.warn({ hold_id: holdId, status: res.status }, "hold release failed");
  } catch (err) {
    // The hold expires on its own; a failed release only delays the customer's funds.
    logger.warn({ hold_id: holdId, err }, "hold release failed");
  }
}

// ---- PPOB aggregator (partner-mock) ----

export type PpobOutcome =
  | { kind: "ok"; body: Record<string, unknown> }
  | { kind: "rejected"; status: number; code: string; message: string } // 4xx: the biller said no
  | { kind: "unavailable" } // 503: nothing was charged
  | { kind: "timeout" }; // 504 or no answer: the biller may or may not have charged

// Each call is its own client span with the biller in the resource name, so APM shows
// latency and errors per biller — the basis for per-partner SLOs. peer.service makes each
// biller an inferred service of its own (Service Map: biller-service -> ppob-ovo).
export function ppob(op: "inquiry" | "payment", billerCode: string, body: Record<string, unknown>): Promise<PpobOutcome> {
  return tracer.trace("ppob.request", { resource: `${op} ${billerCode}`, tags: { "partner.name": `ppob:${billerCode}`, "biller.code": billerCode, "span.kind": "client", "peer.service": `ppob-${billerCode}` } }, async (span): Promise<PpobOutcome> => {
    let res: CallResult;
    try {
      res = await call(config.partnerMockUrl, "POST", `/ppob/v1/${op}`, body, {}, config.partnerTimeoutMs);
    } catch (err) {
      span.setTag("error", err);
      return { kind: "timeout" };
    }
    span.setTag("http.status_code", res.status);
    if (res.status === 200) return { kind: "ok", body: res.body };
    if (res.status === 504) {
      span.setTag("error", true);
      span.setTag("error.type", "PARTNER_TIMEOUT");
      return { kind: "timeout" };
    }
    if (res.status >= 500) {
      span.setTag("error", true);
      span.setTag("error.type", "PARTNER_UNAVAILABLE");
      return { kind: "unavailable" };
    }
    return { kind: "rejected", status: res.status, code: String(res.body.code ?? "REJECTED_BY_BILLER"), message: String(res.body.message ?? "Ditolak oleh biller") };
  });
}

export function ppobError(billerName: string, billerCode: string, outcome: "unavailable" | "timeout"): ApiError {
  return outcome === "timeout"
    ? new ApiError(503, "PARTNER_TIMEOUT", `${billerName} tidak merespons, silakan coba lagi`, `ppob:${billerCode}`)
    : new ApiError(502, "PARTNER_UNAVAILABLE", `${billerName} sedang gangguan, silakan coba lagi`, `ppob:${billerCode}`);
}
