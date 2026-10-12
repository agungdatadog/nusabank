import assert from "node:assert/strict";
import { test } from "node:test";
import { answer } from "./faq";

test("rail questions get the rail's real fee and limit", () => {
  assert.equal(answer("Berapa biaya transfer BI FAST?").intent, "bifast");
  assert.match(answer("biaya bifast berapa ya").reply, /Rp2\.500/);
  assert.equal(answer("Kapan jadwal kliring SKN?").intent, "skn");
});

test("products route to their menu", () => {
  assert.equal(answer("Berapa cicilan KPR 750 juta tenor 15 tahun?").intent, "loan");
  assert.equal(answer("cara top up GoPay").intent, "topup");
  assert.equal(answer("token listrik PLN saya belum masuk").intent, "bill");
  assert.equal(answer("poin saya berapa").intent, "rewards");
});

test("fraud and explicit requests hand off to a human", () => {
  assert.deepEqual([answer("tolong blokir kartu saya, hilang").handoff, answer("saya mau bicara dengan petugas").handoff], [true, true]);
  // Security first: a fraud report mentioning a transfer still escalates.
  assert.equal(answer("ada transaksi mencurigakan transfer BI FAST").intent, "block_card");
});

test("greetings and unknowns", () => {
  assert.equal(answer("Halo, selamat pagi").intent, "greeting");
  assert.equal(answer("apa kabar cuaca hari ini").intent, "unknown");
  assert.equal(answer("apa kabar cuaca hari ini").handoff, false);
});
