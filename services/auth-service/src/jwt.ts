import { createHmac, timingSafeEqual } from "node:crypto";

// Minimal HS256 JWT. Every service verifies with the shared JWT_SECRET, so the
// claim set is part of the platform contract: sub = CIF, role = customer|operator.
export interface Claims {
  sub: string;
  name: string;
  segment: string;
  role: "customer" | "operator";
  iss: string;
  aud: string;
  iat: number;
  exp: number;
}

const b64url = (buf: Buffer | string) => Buffer.from(buf).toString("base64url");

export function sign(claims: Omit<Claims, "iat" | "exp" | "iss" | "aud">, secret: string, ttlSeconds: number): string {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = b64url(
    JSON.stringify({ ...claims, iss: "nusabank-auth", aud: "nusabank", iat: now, exp: now + ttlSeconds }),
  );
  const sig = createHmac("sha256", secret).update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${sig}`;
}

export function verify(token: string, secret: string): Claims | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [header, payload, sig] = parts;
  const expected = createHmac("sha256", secret).update(`${header}.${payload}`).digest();
  const given = Buffer.from(sig, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const h = JSON.parse(Buffer.from(header, "base64url").toString());
    if (h.alg !== "HS256") return null;
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString()) as Claims;
    if (claims.aud !== "nusabank" || claims.exp <= Math.floor(Date.now() / 1000)) return null;
    return claims;
  } catch {
    return null;
  }
}
