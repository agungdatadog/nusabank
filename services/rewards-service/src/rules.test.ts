import assert from "node:assert/strict";
import { test } from "node:test";
import { CATALOG, fromBill, fromTransfer, tierFor, welcomePoints } from "./rules";

const transfer = (rail: string, status: string, amount: string, extra: Record<string, unknown> = {}) => ({
  event_type: "transfer.completed", transfer_id: "t-1", cif: "1024307295", rail, status,
  amount: { amount, currency: "IDR" }, fee: { amount: "2500", currency: "IDR" }, ...extra,
});

test("BI FAST earns 1 point per Rp20.000, capped, with segment multiplier", () => {
  assert.equal(fromTransfer(transfer("BIFAST", "SUCCESS", "1500000"), "REGULAR")?.points, 75);
  assert.equal(fromTransfer(transfer("BIFAST", "SUCCESS", "1500000"), "PRIORITY")?.points, 112);
  assert.equal(fromTransfer(transfer("SKN", "SUCCESS", "250000000"), "PRIVATE")?.points, 1000);
  assert.equal(fromTransfer(transfer("BIFAST", "SUCCESS", "1500000"), "REGULAR")?.description, "Transfer BI FAST Rp1.500.000");
});

test("intrabank earns less; failures, inbound credits and small amounts earn nothing", () => {
  assert.equal(fromTransfer(transfer("INTRABANK", "SUCCESS", "1500000"), "REGULAR")?.points, 30);
  assert.equal(fromTransfer(transfer("BIFAST", "FAILED", "1500000"), "REGULAR"), null);
  assert.equal(fromTransfer({ event_type: "transfer.received", rail: "BIFAST", amount: { amount: "9000000" } }, "REGULAR"), null);
  assert.equal(fromTransfer(transfer("BIFAST", "SUCCESS", "15000"), "REGULAR"), null);
});

test("bill payments earn 1 point per Rp5.000 of the amount", () => {
  const e = { payment_id: "p-1", cif: "1024307295", category: "EWALLET", biller_code: "gopay", biller_name: "GoPay", status: "SUCCESS", amount: { amount: "100000" } };
  const earn = fromBill(e, "REGULAR");
  assert.equal(earn?.points, 20);
  assert.equal(earn?.description, "Top Up GoPay Rp100.000");
  assert.equal(fromBill({ ...e, status: "FAILED" }, "REGULAR"), null);
});

test("tiers from 90-day points", () => {
  assert.deepEqual(tierFor(0), { tier: "SILVER", next: "GOLD", toNext: 10_000 });
  assert.deepEqual(tierFor(12_000), { tier: "GOLD", next: "PLATINUM", toNext: 28_000 });
  assert.deepEqual(tierFor(50_000), { tier: "PLATINUM" });
});

test("welcome points are deterministic and put segments in their tier", () => {
  assert.equal(welcomePoints("1024307295", "REGULAR"), welcomePoints("1024307295", "REGULAR"));
  assert.equal(tierFor(welcomePoints("1024307295", "REGULAR")).tier, "SILVER");
  assert.equal(tierFor(welcomePoints("1024307295", "PRIORITY")).tier, "GOLD");
  assert.equal(tierFor(welcomePoints("1024307295", "PRIVATE")).tier, "PLATINUM");
  assert.equal(new Set(CATALOG.map((i) => i.code)).size, CATALOG.length);
});
