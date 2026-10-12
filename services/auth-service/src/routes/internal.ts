import { Hono } from "hono";
import { pool } from "../db";
import { badRequest } from "../errors";

// Cluster-internal (no Ingress path): admin-service's customer search. NIK, birth date
// and credentials never leave this service.
export const internal = new Hono();

internal.get("/customers", async (c) => {
  const q = (c.req.query("q") ?? "").trim();
  if (q.length < 3 || q.length > 100) throw badRequest("q must be 3-100 characters");
  const like = `%${q.replace(/[\\%_]/g, (ch) => "\\" + ch)}%`;
  const { rows } = await pool.query(
    `SELECT cif, full_name, email, phone, segment, address, mfa_enabled FROM customers
     WHERE cif = $1 OR full_name ILIKE $2 OR email ILIKE $2 ORDER BY full_name LIMIT 20`,
    [q, like],
  );
  return c.json(rows);
});
