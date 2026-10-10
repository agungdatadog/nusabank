import assert from "node:assert/strict";
import { test } from "node:test";
import { BILLERS, CATEGORIES, billingPeriod, findProduct, operatorOf, postpaidCategory, productsFor } from "./catalog";

test("every category biller exists in the catalogue", () => {
  for (const cat of CATEGORIES) for (const code of cat.billers) assert.ok(BILLERS[code], code);
});

test("operators are detected by number prefix", () => {
  assert.equal(operatorOf("081298765432"), "telkomsel");
  assert.equal(operatorOf("085766922089"), "indosat");
  assert.equal(operatorOf("087712345678"), "xl");
  assert.equal(operatorOf("089612345678"), "tri");
  assert.equal(operatorOf("088112345678"), "smartfren");
  assert.equal(operatorOf("021555123"), undefined);
});

test("operators sell pulsa and data; PLN sells tokens; bills have no products", () => {
  const tsel = productsFor("telkomsel");
  assert.ok(tsel.some((p) => p.category === "PULSA") && tsel.some((p) => p.category === "PAKET_DATA"));
  assert.equal(findProduct("pln", "PLN-100K")?.price, 100_000);
  assert.equal(findProduct("telkomsel", "TSEL-50K")?.name, "Pulsa Rp50.000");
  assert.deepEqual(productsFor("bpjs-kesehatan"), []);
  assert.equal(new Set(tsel.map((p) => p.code)).size, tsel.length);
});

test("postpaid categories", () => {
  assert.equal(postpaidCategory("pln"), "PLN_POSTPAID");
  assert.equal(postpaidCategory("indihome"), "INTERNET_TV");
  assert.equal(postpaidCategory("pdam-jakarta"), "PDAM");
  assert.equal(postpaidCategory("bpjs-kesehatan"), "BPJS");
  assert.equal(postpaidCategory("telkomsel"), undefined);
  assert.equal(postpaidCategory("gopay"), undefined);
});

test("billing period is the WIB month", () => {
  assert.equal(billingPeriod(new Date("2026-10-31T18:00:00Z")), "NOV 2026"); // 01:00 WIB on 1 Nov
  assert.equal(billingPeriod(new Date("2026-10-10T03:00:00Z")), "OKT 2026");
});
