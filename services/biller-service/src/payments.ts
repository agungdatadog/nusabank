import { randomUUID } from "node:crypto";
import { releaseHold, ppob } from "./clients";
import { config } from "./config";
import { exec, inTx, rows } from "./db";
import { logger } from "./logger";
import { enqueue, publishNow, TOPIC_BILL_PAYMENT } from "./outbox";
import tracer from "./tracer";

export interface PaymentRow {
  id: string;
  cif: string;
  biller_code: string;
  biller_name: string;
  category: string;
  customer_number: string;
  customer_name: string;
  product_code: string | null;
  product_name: string | null;
  period: string | null;
  source_account_number: string;
  amount: number;
  fee: number;
  status: "SUCCESS" | "FAILED" | "PENDING";
  hold_id: string | null;
  biller_reference: string | null;
  token: string | null;
  failure_reason: string | null;
  attempts: number;
  created_at: Date;
}

export async function loadPayment(where: string, params: unknown[]): Promise<PaymentRow | undefined> {
  const [p] = await rows<PaymentRow>(`SELECT * FROM payments WHERE ${where}`, params);
  return p;
}

const money = (n: number) => ({ amount: String(n), currency: "IDR" });

// Matches catalog/openapi.yaml#/components/schemas/BillPayment.
export function paymentView(p: PaymentRow) {
  return {
    id: p.id, biller_code: p.biller_code, biller_name: p.biller_name, category: p.category,
    customer_number: p.customer_number, customer_name: p.customer_name,
    ...(p.product_name ? { product_name: p.product_name } : {}), ...(p.period ? { period: p.period } : {}),
    amount: money(p.amount), fee: money(p.fee), status: p.status,
    ...(p.biller_reference ? { biller_reference: p.biller_reference } : {}), ...(p.token ? { token: p.token } : {}),
    ...(p.failure_reason ? { failure_reason: p.failure_reason } : {}), created_at: p.created_at.toISOString(),
  };
}

interface Outcome {
  billerReference?: string;
  token?: string;
  failureReason?: string;
}

// Moves a PENDING payment to its final state and emits biller.payment.v1 in the same
// transaction. The status guard makes the request path and the reconciler race-safe:
// only one of them finishes a payment. Returns false if someone else already did.
export async function finish(p: PaymentRow, status: "SUCCESS" | "FAILED", o: Outcome): Promise<boolean> {
  const event = {
    event_id: randomUUID(), event_type: "bill_payment.completed", occurred_at: new Date().toISOString(), producer: "nusabank-biller",
    payment_id: p.id, cif: p.cif, category: p.category, biller_code: p.biller_code, status,
    source_account_number: p.source_account_number, amount: money(p.amount), fee: money(p.fee),
    ...(p.hold_id ? { hold_id: p.hold_id } : {}), biller_name: p.biller_name, customer_number: p.customer_number,
    ...(o.failureReason ? { failure_reason: o.failureReason } : {}),
  };
  const outboxId = await inTx(async (conn) => {
    const n = await exec(`UPDATE payments SET status = ?, biller_reference = ?, token = ?, failure_reason = ?, updated_at = UTC_TIMESTAMP(3)
        WHERE id = ? AND status = 'PENDING'`,
      [status, o.billerReference ?? null, o.token ?? null, o.failureReason ?? null, p.id], conn);
    return n === 0 ? null : enqueue(conn, TOPIC_BILL_PAYMENT, p.id, event);
  });
  if (outboxId === null) return false;
  await publishNow(outboxId);
  // SUCCESS holds are released by account-service when the ledger posts the debit.
  if (status === "FAILED" && p.hold_id) await releaseHold(p.hold_id);

  const tags = { category: p.category.toLowerCase(), biller: p.biller_code, status: status.toLowerCase() };
  tracer.dogstatsd.increment("nusabank.biller.payment.count", 1, tags);
  tracer.dogstatsd.distribution("nusabank.biller.payment.amount", p.amount, tags);
  logger.info({ payment_id: p.id, biller: p.biller_code, category: p.category, status, amount: p.amount, failure_reason: o.failureReason },
    "bill payment finished");
  return true;
}

// Resolves payments whose biller timed out (or whose pod died mid-payment) by asking
// the aggregator again with the same reference. Claiming by bumping updated_at gives
// each replica exclusive ownership of a payment for one reconcile interval.
export async function reconcileOnce(): Promise<void> {
  const due = await rows<PaymentRow>(
    "SELECT * FROM payments WHERE status = 'PENDING' AND updated_at < UTC_TIMESTAMP(3) - INTERVAL ? SECOND ORDER BY updated_at LIMIT 20",
    [config.reconcileAfterSeconds]);
  for (const p of due) {
    const claimed = await exec("UPDATE payments SET attempts = attempts + 1, updated_at = UTC_TIMESTAMP(3) WHERE id = ? AND status = 'PENDING' AND attempts = ?",
      [p.id, p.attempts]);
    if (!claimed) continue;
    await tracer.trace("biller.reconcile", { resource: p.biller_code, tags: { "payment.id": p.id, "biller.code": p.biller_code } }, async () => {
      if (!p.hold_id) {
        // Never reached the biller: nothing was reserved or charged.
        await finish(p, "FAILED", { failureReason: "HOLD_FAILED" });
        return;
      }
      const out = await ppob("payment", p.biller_code, {
        biller_code: p.biller_code, customer_number: p.customer_number,
        ...(p.product_code ? { product_code: p.product_code } : {}), amount: money(p.amount), reference: p.id,
      });
      if (out.kind === "ok") {
        await finish(p, "SUCCESS", { billerReference: String(out.body.biller_reference), token: out.body.token as string | undefined });
      } else if (out.kind === "rejected") {
        await finish(p, "FAILED", { failureReason: out.code });
      } else if (p.attempts + 1 >= config.reconcileMaxAttempts) {
        await finish(p, "FAILED", { failureReason: "BILLER_TIMEOUT" });
      } else {
        logger.warn({ payment_id: p.id, biller: p.biller_code, attempt: p.attempts + 1, partner: `ppob:${p.biller_code}` }, "biller still not answering");
      }
    });
  }
}

export function startReconciler(intervalMs = 30_000): NodeJS.Timeout {
  return setInterval(() => {
    reconcileOnce().catch((err) => logger.warn({ err }, "reconcile failed"));
  }, intervalMs);
}
