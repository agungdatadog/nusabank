import assert from "node:assert/strict";
import { test } from "node:test";
import { sign, verify } from "./jwt";

const secret = "test-secret-not-used-anywhere";
const claims = { sub: "1024307295", name: "Yusuf Tanjung", segment: "REGULAR", role: "customer" as const };

test("round-trips a valid token", () => {
  const got = verify(sign(claims, secret, 60), secret);
  assert.equal(got?.sub, "1024307295");
  assert.equal(got?.aud, "nusabank");
});

test("rejects a token signed with another secret", () => {
  assert.equal(verify(sign(claims, "other", 60), secret), null);
});

test("rejects an expired token", () => {
  assert.equal(verify(sign(claims, secret, -1), secret), null);
});

test("rejects alg=none and tampered payloads", () => {
  const [, payload, sig] = sign(claims, secret, 60).split(".");
  const none = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
  assert.equal(verify(`${none}.${payload}.${sig}`, secret), null);
  const forged = Buffer.from(JSON.stringify({ ...claims, sub: "1000000000" })).toString("base64url");
  const [header] = sign(claims, secret, 60).split(".");
  assert.equal(verify(`${header}.${forged}.${sig}`, secret), null);
});
