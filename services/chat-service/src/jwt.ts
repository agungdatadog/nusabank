import { createHmac, timingSafeEqual } from "node:crypto";

// Verify-only copy of auth-service's HS256 JWT: sub = CIF, role = customer|operator.
export interface Claims {
  sub: string;
  name: string;
  segment: string;
  role: "customer" | "operator";
  aud: string;
  exp: number;
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
