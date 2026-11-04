import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import bcrypt from "bcryptjs";
import { Hono } from "hono";
import { config } from "../config";
import { pool } from "../db";
import { ApiError, unauthorized } from "../errors";
import { sign, verify } from "../jwt";
import { logger } from "../logger";
import tracer from "../tracer";
import { jsonBody, str, UUID } from "../validate";

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const MAX_FAILED_LOGINS = 5;
const LOCK_MINUTES = 15;

interface CustomerRow {
  cif: string;
  username: string;
  full_name: string;
  email: string;
  phone: string;
  segment: string;
  address: string;
  mfa_enabled: boolean;
  password_hash: string;
  failed_logins: number;
  locked: boolean;
}

async function issueTokens(c: CustomerRow) {
  const access_token = sign(
    { sub: c.cif, name: c.full_name, segment: c.segment, role: "customer" },
    config.jwtSecret,
    config.accessTokenTtlSeconds,
  );
  const refresh_token = randomBytes(32).toString("base64url");
  await pool.query(
    "INSERT INTO sessions (cif, refresh_token_hash, expires_at) VALUES ($1, $2, now() + make_interval(secs => $3))",
    [c.cif, sha256(refresh_token), config.refreshTokenTtlSeconds],
  );
  return { access_token, refresh_token, expires_in: config.accessTokenTtlSeconds };
}

export function bearerClaims(header: string | undefined) {
  const token = header?.startsWith("Bearer ") ? header.slice(7) : undefined;
  const claims = token ? verify(token, config.jwtSecret) : null;
  if (!claims) throw unauthorized();
  return claims;
}

function tagUser(cif: string, segment?: string) {
  tracer.setUser(segment ? { id: cif, segment } : { id: cif });
}

export const auth = new Hono();

auth.post("/login", async (c) => {
  const body = await jsonBody(c);
  const username = str(body, "username").toLowerCase();
  const password = str(body, "password");

  const { rows } = await pool.query<CustomerRow>(
    `SELECT *, (failed_logins >= $2 AND last_failed_login_at > now() - make_interval(mins => $3)) AS locked
     FROM customers WHERE username = $1`,
    [username, MAX_FAILED_LOGINS, LOCK_MINUTES],
  );
  const customer = rows[0];
  // Compare against a dummy hash for unknown users so timing doesn't reveal which usernames exist.
  const ok = await bcrypt.compare(password, customer?.password_hash ?? "$2b$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinva");
  if (!customer || !ok || customer.locked) {
    if (customer) await pool.query(
        "UPDATE customers SET failed_logins = failed_logins + 1, last_failed_login_at = now() WHERE cif = $1",
        [customer.cif],
      );
    tracer.loginFailure(username, !!customer);
    // network.client.ip lets a Cloud SIEM rule count distinct usernames per source (credential stuffing).
    const clientIp = c.req.header("x-forwarded-for")?.split(",")[0]?.trim();
    logger.info({ username, reason: !customer ? "unknown_user" : !ok ? "bad_password" : "locked", network: { client: { ip: clientIp } } }, "login rejected");
    throw new ApiError(401, "INVALID_CREDENTIALS", "Username atau password salah");
  }
  await pool.query("UPDATE customers SET failed_logins = 0 WHERE cif = $1", [customer.cif]);
  tagUser(customer.cif, customer.segment);
  tracer.loginSuccess(username, customer.cif);

  if (customer.mfa_enabled) {
    const { rows: ch } = await pool.query<{ token: string }>(
      "INSERT INTO mfa_challenges (cif, expires_at) VALUES ($1, now() + make_interval(secs => $2)) RETURNING token",
      [customer.cif, config.mfaChallengeTtlSeconds],
    );
    logger.info({ cif: customer.cif, phone_last4: customer.phone.slice(-4) }, "MFA OTP sent via simulated SMS gateway");
    return c.json({ mfa_required: true, mfa_token: ch[0].token });
  }
  return c.json({ mfa_required: false, tokens: await issueTokens(customer) });
});

auth.post("/mfa/verify", async (c) => {
  const body = await jsonBody(c);
  const mfaToken = str(body, "mfa_token", { pattern: UUID });
  const otp = str(body, "otp", { pattern: /^\d{6}$/ });

  const { rows } = await pool.query<{ cif: string; attempts: number }>(
    `UPDATE mfa_challenges SET attempts = attempts + 1
     WHERE token = $1 AND used_at IS NULL AND expires_at > now() AND attempts < 5
     RETURNING cif, attempts`,
    [mfaToken],
  );
  if (!rows[0]) throw new ApiError(401, "MFA_EXPIRED", "Kode OTP kedaluwarsa, silakan login kembali");
  const expected = Buffer.from(config.demoOtp);
  const given = Buffer.from(otp);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    throw new ApiError(401, "MFA_INVALID", "Kode OTP salah");
  }
  await pool.query("UPDATE mfa_challenges SET used_at = now() WHERE token = $1", [mfaToken]);
  const { rows: cust } = await pool.query<CustomerRow>("SELECT * FROM customers WHERE cif = $1", [rows[0].cif]);
  tagUser(cust[0].cif, cust[0].segment);
  return c.json(await issueTokens(cust[0]));
});

auth.post("/refresh", async (c) => {
  const body = await jsonBody(c);
  const refresh = str(body, "refresh_token");
  // Rotate: the old refresh token is revoked as the new pair is issued.
  const { rows } = await pool.query<{ cif: string }>(
    `UPDATE sessions SET revoked_at = now()
     WHERE refresh_token_hash = $1 AND revoked_at IS NULL AND expires_at > now()
     RETURNING cif`,
    [sha256(refresh)],
  );
  if (!rows[0]) throw unauthorized();
  const { rows: cust } = await pool.query<CustomerRow>("SELECT * FROM customers WHERE cif = $1", [rows[0].cif]);
  return c.json(await issueTokens(cust[0]));
});

auth.post("/logout", async (c) => {
  const claims = bearerClaims(c.req.header("Authorization"));
  await pool.query("UPDATE sessions SET revoked_at = now() WHERE cif = $1 AND revoked_at IS NULL", [claims.sub]);
  return c.body(null, 204);
});

auth.get("/me", async (c) => {
  const claims = bearerClaims(c.req.header("Authorization"));
  tagUser(claims.sub, claims.segment);
  const { rows } = await pool.query(
    "SELECT cif, full_name, email, phone, segment, address, mfa_enabled FROM customers WHERE cif = $1",
    [claims.sub],
  );
  if (!rows[0]) throw unauthorized();
  return c.json(rows[0]);
});
