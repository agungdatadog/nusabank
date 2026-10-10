import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import type { PoolConnection } from "mysql2/promise";
import {
  BILLERS, CATEGORIES, EWALLET_MAX, EWALLET_MIN, billingPeriod, findProduct, isEwallet, isOperator,
  operatorOf, postpaidCategory, productsFor, type Category,
} from "../catalog";
import { createHold, lookupAccount, ppob, ppobError } from "../clients";
import { config } from "../config";
import { exec, inTx, rows } from "../db";
import { ApiError, badRequest, notFound, unauthorized } from "../errors";
import { verify } from "../jwt";
import { logger } from "../logger";
import { finish, loadPayment, paymentView, type PaymentRow } from "../payments";
import tracer, { tag } from "../tracer";
import { ACCOUNT_NUMBER, UUID, idrAmount, jsonBody, str } from "../validate";

type Env = { Variables: { cif: string } };
export const billers = new Hono<Env>();

const money = (n: number) => ({ amount: String(n), currency: "IDR" });

billers.use("*", async (c, next) => {
  const header = c.req.header("Authorization");
  const claims = header?.startsWith("Bearer ") ? verify(header.slice(7), config.jwtSecret) : null;
  if (!claims || claims.role !== "customer") throw unauthorized();
  c.set("cif", claims.sub);
  tracer.setUser({ id: claims.sub, segment: claims.segment });
  await next();
});

billers.get("/categories", (c) =>
  c.json(CATEGORIES.map((cat) => ({
    code: cat.code,
    name: cat.name,
    billers: cat.billers.map((code) => ({
      code, name: BILLERS[code].name, customer_number_label: BILLERS[code].customerNumberLabel, open_amount: cat.openAmount,
    })),
  }))),
);

billers.get("/payments", async (c) => {
  const page = Math.max(1, Number(c.req.query("page") ?? 1) || 1);
  const size = Math.min(100, Math.max(1, Number(c.req.query("page_size") ?? 20) || 20));
  const list = await rows<PaymentRow>("SELECT * FROM payments WHERE cif = ? ORDER BY created_at DESC LIMIT ? OFFSET ?",
    [c.get("cif"), size, (page - 1) * size]);
  return c.json(list.map(paymentView));
});

billers.get("/payments/:paymentId", async (c) => {
  const id = c.req.param("paymentId");
  if (!UUID.test(id)) throw notFound("Pembayaran tidak ditemukan");
  const p = await loadPayment("id = ? AND cif = ?", [id, c.get("cif")]);
  if (!p) throw notFound("Pembayaran tidak ditemukan");
  return c.json(paymentView(p));
});

billers.get("/:billerCode/products", (c) => {
  const code = c.req.param("billerCode");
  if (!BILLERS[code]) throw notFound("Biller tidak ditemukan");
  return c.json(productsFor(code).map((p) => ({
    code: p.code, name: p.name, category: p.category, ...(p.description ? { description: p.description } : {}), price: money(p.price),
  })));
});

billers.post("/inquiry", async (c) => {
  const cif = c.get("cif");
  const body = await jsonBody(c);
  const code = str(body, "biller_code", { pattern: /^[a-z0-9-]+$/ });
  const biller = BILLERS[code];
  if (!biller) throw new ApiError(400, "UNKNOWN_BILLER", "Biller tidak tersedia");
  const customerNumber = str(body, "customer_number");
  if (!biller.customerNumber.test(customerNumber)) throw badRequest(`${biller.customerNumberLabel} tidak valid`);
  const productCode = str(body, "product_code", { optional: true });
  const requested = idrAmount(body, "amount");

  // Resolve what is being bought and its price before asking the biller.
  let category: Category;
  let amount: number | undefined;
  let productName: string | undefined;
  if (isEwallet(code)) {
    if (requested === undefined || requested < EWALLET_MIN || requested > EWALLET_MAX) {
      throw badRequest(`Nominal top up antara Rp${EWALLET_MIN.toLocaleString("id-ID")} dan Rp${EWALLET_MAX.toLocaleString("id-ID")}`);
    }
    category = "EWALLET";
    amount = requested;
  } else if (productCode) {
    const product = findProduct(code, productCode);
    if (!product) throw badRequest("Produk tidak tersedia");
    if (isOperator(code) && operatorOf(customerNumber) !== code) {
      throw new ApiError(400, "NUMBER_OPERATOR_MISMATCH", `Nomor ini bukan nomor ${biller.name}`);
    }
    category = product.category;
    amount = product.price;
    productName = product.name;
  } else {
    const cat = postpaidCategory(code);
    if (!cat) throw badRequest("product_code is required for this biller");
    category = cat;
  }
  tag({ "biller.code": code, "biller.category": category.toLowerCase() });

  const out = await ppob("inquiry", code, {
    biller_code: code, customer_number: customerNumber,
    ...(productCode ? { product_code: productCode } : {}),
    ...(amount !== undefined ? { amount: money(amount) } : {}),
  });
  if (out.kind === "unavailable" || out.kind === "timeout") throw ppobError(biller.name, code, out.kind);
  if (out.kind === "rejected") {
    if (out.status === 404) throw new ApiError(404, "CUSTOMER_NOT_FOUND", out.message);
    throw new ApiError(400, out.code, out.message);
  }
  const due = Number((out.body.amount_due as { amount: string }).amount);
  const postpaid = amount === undefined;
  const id = randomUUID();
  const expiresAt = new Date(Date.now() + config.inquiryTtlSeconds * 1000);
  const inquiry = {
    inquiry_id: id, biller_code: code, biller_name: biller.name, customer_number: customerNumber,
    customer_name: String(out.body.customer_name), ...(productName ? { product_name: productName } : {}),
    ...(postpaid ? { period: billingPeriod() } : {}),
    amount: money(postpaid ? due : amount!), fee: money(biller.fee), expires_at: expiresAt.toISOString(),
  };
  await exec(`INSERT INTO inquiries (id, cif, biller_code, category, customer_number, customer_name, product_code, product_name,
      period, amount, fee, biller_reference, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, cif, code, category, customerNumber, inquiry.customer_name, productCode ?? null, productName ?? null,
      inquiry.period ?? null, Number(inquiry.amount.amount), biller.fee, out.body.biller_reference ?? null, expiresAt]);
  return c.json(inquiry);
});

interface InquiryRow {
  id: string;
  biller_code: string;
  category: Category;
  customer_number: string;
  customer_name: string;
  product_code: string | null;
  product_name: string | null;
  period: string | null;
  amount: number;
  fee: number;
  expires_at: Date;
  used_at: Date | null;
}

billers.post("/payments", async (c) => {
  const cif = c.get("cif");
  const key = c.req.header("Idempotency-Key");
  if (!key || !UUID.test(key)) throw badRequest("Idempotency-Key header must be a UUID");
  const body = await jsonBody(c);
  const inquiryId = str(body, "inquiry_id", { pattern: UUID });
  const source = str(body, "source_account_number", { pattern: ACCOUNT_NUMBER });

  const replay = await loadPayment("cif = ? AND idempotency_key = ?", [cif, key]);
  if (replay) return c.json(paymentView(replay), 201);

  const account = await lookupAccount(source);
  if (!account || account.cif !== cif) throw notFound("Rekening tidak ditemukan");
  if (account.currency !== "IDR" || account.status !== "ACTIVE") {
    throw new ApiError(422, "ACCOUNT_NOT_ELIGIBLE", "Rekening ini tidak dapat digunakan untuk pembayaran");
  }

  // Claim the inquiry and create the payment atomically: an inquiry is single-use.
  const id = randomUUID();
  try {
    await inTx(async (conn: PoolConnection) => {
      const [inq] = await rows<InquiryRow>("SELECT * FROM inquiries WHERE id = ? AND cif = ? FOR UPDATE", [inquiryId, cif], conn);
      if (!inq || inq.used_at || inq.expires_at.getTime() <= Date.now()) {
        throw new ApiError(409, "INQUIRY_EXPIRED", "Sesi pembayaran kedaluwarsa, silakan ulangi");
      }
      await exec("UPDATE inquiries SET used_at = UTC_TIMESTAMP(3) WHERE id = ?", [inquiryId], conn);
      await exec(`INSERT INTO payments (id, cif, idempotency_key, inquiry_id, biller_code, biller_name, category, customer_number,
          customer_name, product_code, product_name, period, source_account_number, amount, fee, status)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING')`,
        [id, cif, key, inquiryId, inq.biller_code, BILLERS[inq.biller_code].name, inq.category, inq.customer_number,
          inq.customer_name, inq.product_code, inq.product_name, inq.period, source, inq.amount, inq.fee], conn);
    });
  } catch (err) {
    // A concurrent replay of the same Idempotency-Key won the insert: return its result.
    if ((err as { code?: string }).code === "ER_DUP_ENTRY") {
      const winner = await loadPayment("cif = ? AND idempotency_key = ?", [cif, key]);
      if (winner) return c.json(paymentView(winner), 201);
    }
    throw err;
  }
  let p = (await loadPayment("id = ?", [id]))!;
  tag({ "payment.id": id, "biller.code": p.biller_code, "biller.category": p.category.toLowerCase() });

  try {
    p.hold_id = await createHold(source, p.amount + p.fee, id);
  } catch (err) {
    await finish(p, "FAILED", { failureReason: err instanceof ApiError ? err.code : "HOLD_FAILED" });
    throw err;
  }
  await exec("UPDATE payments SET hold_id = ? WHERE id = ?", [p.hold_id, id]);

  const out = await ppob("payment", p.biller_code, {
    biller_code: p.biller_code, customer_number: p.customer_number,
    ...(p.product_code ? { product_code: p.product_code } : {}), amount: money(p.amount), reference: id,
  });
  switch (out.kind) {
    case "ok":
      await finish(p, "SUCCESS", { billerReference: String(out.body.biller_reference), token: out.body.token as string | undefined });
      break;
    case "rejected":
      await finish(p, "FAILED", { failureReason: out.code });
      break;
    case "unavailable":
      await finish(p, "FAILED", { failureReason: "BILLER_UNAVAILABLE" });
      throw ppobError(p.biller_name, p.biller_code, "unavailable");
    case "timeout":
      // The biller may have charged: keep the hold and let the reconciler find out.
      await exec("UPDATE payments SET updated_at = UTC_TIMESTAMP(3) WHERE id = ?", [id]);
      logger.warn({ payment_id: id, biller: p.biller_code, partner: `ppob:${p.biller_code}` }, "biller timed out, payment pending");
      tag({ "partner.name": `ppob:${p.biller_code}`, "payment.status": "pending" });
      break;
  }
  p = (await loadPayment("id = ?", [id]))!;
  return c.json(paymentView(p), 201);
});
