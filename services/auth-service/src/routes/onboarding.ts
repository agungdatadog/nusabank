import { createHash } from "node:crypto";
import { Hono } from "hono";
import { pool } from "../db";
import { ApiError, badRequest, notFound } from "../errors";
import tracer from "../tracer";
import { jsonBody, PRODUCT_TYPES, str, UUID } from "../validate";

// Funnel step counter — the EP1 conversion business metric.
function countStep(product: string, step: string) {
  tracer.dogstatsd.increment("nusabank.onboarding.step.count", 1, { product: product.toLowerCase(), step });
}

const COLUMNS = "id, product_type, step, created_at, updated_at";

async function load(id: string) {
  if (!UUID.test(id)) throw notFound("Pengajuan tidak ditemukan");
  const { rows } = await pool.query(`SELECT ${COLUMNS}, nik FROM onboarding_applications WHERE id = $1`, [id]);
  if (!rows[0]) throw notFound("Pengajuan tidak ditemukan");
  return rows[0];
}

export const onboarding = new Hono();

onboarding.post("/", async (c) => {
  const body = await jsonBody(c);
  const productType = str(body, "product_type");
  if (!PRODUCT_TYPES.includes(productType)) throw badRequest("product_type is not a known product");
  const fullName = str(body, "full_name");
  const email = str(body, "email", { pattern: /^[^@\s]+@[^@\s]+\.[^@\s]+$/ });
  const phone = str(body, "phone", { pattern: /^\+?\d{9,15}$/ });
  const promo = str(body, "promotion_code", { optional: true });

  const { rows } = await pool.query(
    `INSERT INTO onboarding_applications (product_type, full_name, email, phone, promotion_code)
     VALUES ($1, $2, $3, $4, $5) RETURNING ${COLUMNS}`,
    [productType, fullName, email, phone, promo ?? null],
  );
  countStep(productType, "started");
  return c.json(rows[0], 201);
});

onboarding.get("/:applicationId", async (c) => {
  const { nik: _nik, ...app } = await load(c.req.param("applicationId"));
  return c.json(app);
});

onboarding.post("/:applicationId/ekyc", async (c) => {
  const app = await load(c.req.param("applicationId"));
  const body = await jsonBody(c);
  const nik = str(body, "nik", { pattern: /^\d{16}$/ });
  const birthDate = str(body, "birth_date", { pattern: /^\d{4}-\d{2}-\d{2}$/ });
  const mother = str(body, "mother_maiden_name");
  if (app.step !== "started" && app.step !== "ekyc_submitted") {
    throw new ApiError(409, "INVALID_STEP", "Pengajuan sudah dikirim");
  }
  const { rows } = await pool.query(
    `UPDATE onboarding_applications
     SET nik = $2, birth_date = $3, mother_maiden_name = $4, step = 'ekyc_submitted', updated_at = now()
     WHERE id = $1 RETURNING ${COLUMNS}`,
    [app.id, nik, birthDate, mother],
  );
  countStep(app.product_type, "ekyc_submitted");
  return c.json(rows[0]);
});

onboarding.post("/:applicationId/submit", async (c) => {
  const app = await load(c.req.param("applicationId"));
  if (app.step !== "ekyc_submitted") throw new ApiError(409, "INVALID_STEP", "Lengkapi e-KYC terlebih dahulu");
  countStep(app.product_type, "submitted");

  // Deterministic decision keyed on NIK: roughly 1 in 10 applicants is declined.
  const declined = createHash("sha256").update(app.nik).digest()[0] % 10 === 0;
  const step = declined ? "rejected" : "approved";
  const { rows } = await pool.query(
    `UPDATE onboarding_applications SET step = $2, updated_at = now() WHERE id = $1 RETURNING ${COLUMNS}`,
    [app.id, step],
  );
  countStep(app.product_type, step);
  return c.json(rows[0]);
});

export const promotions = new Hono();

promotions.get("/", async (c) => {
  const { rows } = await pool.query(
    "SELECT code, title, product_type, to_char(valid_until, 'YYYY-MM-DD') AS valid_until FROM promotions WHERE valid_until >= current_date ORDER BY code",
  );
  return c.json(rows);
});
