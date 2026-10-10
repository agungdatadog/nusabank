// Continuous, realistic customer traffic for Nusa Bank — the traffic history EP1's SLOs,
// baselines and dashboards depend on. Runs forever in-cluster; volume follows a WIB
// day curve so dashboards show a believable daily rhythm, not a flat line.
import http from "k6/http";
import { check, group, sleep } from "k6";
import { Counter } from "k6/metrics";

const BASE = __ENV.BASE_URL || "http://136.69.32.40";
// "Other banks" deliver inbound credits straight to the rail endpoint (cluster-only).
const RAIL_INBOUND = __ENV.RAIL_INBOUND_URL || "http://payment-service.nusabank.svc.cluster.local:8080/internal/rails/inbound";
const PASSWORD = __ENV.DEMO_CUSTOMER_PASSWORD;
const OTP = __ENV.DEMO_MFA_OTP;
const PEAK_RPS = Number(__ENV.PEAK_JOURNEYS_PER_SECOND || "0.8");

const seed = JSON.parse(open("./customers.json")).customers;
const customers = seed.map((c) => ({
  username: c.username,
  cif: c.cif,
  nik: c.nik,
  phone: c.phone.replace(/^\+62/, "0"),
  mfa: c.mfa_enabled,
  savings: c.accounts.filter((a) => (a.product_type === "SAVINGS" || a.product_type === "CURRENT") && a.currency === "IDR").map((a) => a.account_number),
  all: c.accounts.map((a) => a.account_number),
})).filter((c) => c.savings.length);
const intrabankTargets = customers.flatMap((c) => c.savings);

const journeys = new Counter("nusabank_journeys");

export const options = {
  scenarios: {
    customers: {
      executor: "constant-arrival-rate",
      rate: Math.max(1, Math.round(PEAK_RPS * 60)),
      timeUnit: "1m",
      duration: "8760h",
      preAllocatedVUs: 20,
      maxVUs: 80,
    },
  },
  // Never fail the run on thresholds: this is a traffic source, not a test gate.
  thresholds: {},
  summaryTrendStats: ["avg", "p(95)"],
};

// Share of peak traffic by WIB hour: quiet nights, morning ramp, lunch and evening peaks.
const DAY_CURVE = [0.08, 0.05, 0.04, 0.04, 0.06, 0.15, 0.35, 0.6, 0.8, 0.85, 0.8, 0.85,
  1.0, 0.95, 0.8, 0.75, 0.8, 0.9, 0.95, 1.0, 0.9, 0.7, 0.45, 0.2];

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const uuid = () => "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (ch) => {
  const r = (Math.random() * 16) | 0;
  return (ch === "x" ? r : (r & 0x3) | 0x8).toString(16);
});
const json = { "Content-Type": "application/json" };
const think = (min, max) => sleep(min + Math.random() * (max - min));
const tag = (name) => ({ tags: { journey: name } });

// Lognormal-ish rupiah amounts, rounded the way people type them.
function amount(median, spread, step) {
  const z = Math.sqrt(-2 * Math.log(Math.random() || 1e-9)) * Math.cos(2 * Math.PI * Math.random());
  return String(Math.max(step, Math.round((median * Math.exp(spread * z)) / step) * step));
}

function externalAccount() {
  // ~2% hit a closed account: a normal, visible business rejection — not an outage.
  const n = String(Math.floor(1e9 + Math.random() * 9e9));
  return Math.random() < 0.02 ? n.slice(0, 6) + "0000" : n;
}

function login(c) {
  const res = http.post(`${BASE}/api/auth/login`, JSON.stringify({ username: c.username, password: PASSWORD }), { headers: json, ...tag("login") });
  if (!check(res, { "login 200": (r) => r.status === 200 })) return null;
  const body = res.json();
  if (!body.mfa_required) return body.tokens.access_token;
  think(2, 6); // reading the SMS
  const v = http.post(`${BASE}/api/auth/mfa/verify`, JSON.stringify({ mfa_token: body.mfa_token, otp: OTP }), { headers: json, ...tag("login") });
  return check(v, { "mfa 200": (r) => r.status === 200 }) ? v.json().access_token : null;
}

function authed(token, name) {
  return { headers: { ...json, Authorization: `Bearer ${token}` }, tags: { journey: name } };
}

function browse(token, c) {
  const p = authed(token, "browse");
  check(http.get(`${BASE}/api/auth/me`, p), { "me 200": (r) => r.status === 200 });
  check(http.get(`${BASE}/api/accounts`, p), { "accounts 200": (r) => r.status === 200 });
  http.get(`${BASE}/api/promotions`, p);
  think(2, 8);
  const acct = pick(c.all);
  check(http.get(`${BASE}/api/accounts/${acct}`, p), { "account 200": (r) => r.status === 200 });
  check(http.get(`${BASE}/api/accounts/${acct}/transactions?page_size=15`, p), { "mutasi 200": (r) => r.status === 200 });
  if (Math.random() < 0.3) {
    think(2, 5);
    http.get(`${BASE}/api/accounts/${acct}/transactions?page=2&page_size=15`, p);
  }
}

function statement(token, c) {
  const p = authed(token, "estatement");
  const acct = pick(c.savings);
  const list = http.get(`${BASE}/api/accounts/${acct}/statements`, p);
  if (list.status !== 200 || !list.json().length) return;
  think(1, 4);
  const period = pick(list.json().slice(0, 4)).period;
  check(http.get(`${BASE}/api/accounts/${acct}/statements/${period}`, p), { "pdf 200": (r) => r.status === 200 });
}

function transfer(token, c, rail) {
  const p = authed(token, `transfer_${rail.toLowerCase()}`);
  http.get(`${BASE}/api/accounts`, p);
  http.get(`${BASE}/api/transfers/banks`, p);
  think(3, 10); // filling the form
  const source = pick(c.savings);
  let bank = "899";
  let dest;
  let value;
  if (rail === "INTRABANK") {
    dest = pick(intrabankTargets.filter((n) => n !== source));
    value = amount(400_000, 0.9, 5_000);
  } else if (rail === "BIFAST") {
    bank = pick(["014", "014", "008", "008", "002", "009", "022", "451", "013", "542", "535"]);
    dest = externalAccount();
    value = amount(350_000, 0.9, 5_000);
  } else {
    bank = pick(["014", "008", "002", "009", "200"]);
    dest = externalAccount();
    value = amount(5_000_000, 0.7, 100_000);
  }
  const inq = http.post(`${BASE}/api/transfers/inquiry`, JSON.stringify({
    rail, source_account_number: source, destination_bank_code: bank, destination_account_number: dest,
    amount: { amount: value, currency: "IDR" },
  }), p);
  if (inq.status !== 200) return; // closed account / limit: the customer gives up
  think(2, 6); // checking the beneficiary name
  if (Math.random() < 0.08) return; // abandons at confirmation
  const res = http.post(`${BASE}/api/transfers`, JSON.stringify({ inquiry_id: inq.json().inquiry_id }), {
    headers: { ...p.headers, "Idempotency-Key": uuid() }, tags: p.tags,
  });
  check(res, { "transfer 201": (r) => r.status === 201 });
  if (res.status === 201 && Math.random() < 0.5) {
    think(1, 3);
    http.get(`${BASE}/api/transfers?page_size=10`, p);
  }
}

const LOAN_SHAPES = {
  KPR: () => { const price = Number(amount(850_000_000, 0.5, 5_000_000)); return { price, dp: Math.round(price * (0.1 + Math.random() * 0.2) / 1e6) * 1e6, tenor: [120, 180, 240][Math.floor(Math.random() * 3)], docs: ["KTP", "NPWP", "SLIP_GAJI", "SERTIFIKAT"] }; },
  KKB: () => { const price = Number(amount(320_000_000, 0.4, 1_000_000)); return { price, dp: Math.round(price * (0.2 + Math.random() * 0.15) / 1e6) * 1e6, tenor: [24, 36, 48, 60][Math.floor(Math.random() * 4)], docs: ["KTP", "SLIP_GAJI", "SPK_DEALER"] }; },
  KTA: () => ({ price: Number(amount(40_000_000, 0.6, 1_000_000)), dp: 0, tenor: [12, 24, 36][Math.floor(Math.random() * 3)], docs: ["KTP", "SLIP_GAJI"] }),
};
const pickLoan = () => { const r = Math.random(); return r < 0.7 ? "KTA" : r < 0.9 ? "KKB" : "KPR"; };
const idrMoney = (v) => ({ amount: String(v), currency: "IDR" });

// Customers try the simulator far more often than they apply.
function loanSimulate(token) {
  const p = authed(token, "loan_simulate");
  http.get(`${BASE}/api/loans/products`, p);
  const code = pickLoan();
  const runs = 1 + Math.floor(Math.random() * 3); // tweaking price / tenor
  for (let i = 0; i < runs; i++) {
    const t = LOAN_SHAPES[code]();
    check(http.post(`${BASE}/api/loans/simulations`, JSON.stringify({ product_code: code, asset_price: idrMoney(t.price), down_payment: idrMoney(t.dp), tenor_months: t.tenor }), p),
      { "simulation 200": (r) => r.status === 200 });
    think(3, 10);
  }
}

function loanApply(token, c) {
  const p = authed(token, "loan_apply");
  const code = pickLoan();
  const t = LOAN_SHAPES[code]();
  const app = http.post(`${BASE}/api/loans/applications`, JSON.stringify({
    product_code: code, asset_price: idrMoney(t.price), down_payment: idrMoney(t.dp), tenor_months: t.tenor,
    disbursement_account_number: pick(c.savings), monthly_income: idrMoney(amount(18_000_000, 0.6, 500_000)), employment_type: "KARYAWAN", nik: c.nik,
  }), p);
  if (!check(app, { "loan application 201": (r) => r.status === 201 })) return;
  const id = app.json().id;
  const upload = { headers: { Authorization: `Bearer ${token}` }, tags: p.tags };
  for (const doc of t.docs) {
    think(2, 6);
    http.post(`${BASE}/api/loans/applications/${id}/documents`, { document_type: doc, file: http.file("contoh dokumen demo Nusa Bank", `${doc.toLowerCase()}.pdf`, "application/pdf") }, upload);
  }
  think(2, 5);
  check(http.post(`${BASE}/api/loans/applications/${id}/submit`, null, p), { "loan decided 200": (r) => r.status === 200 });
}

function onboarding() {
  const p = { headers: json, tags: { journey: "onboarding" } };
  const product = pick(["SAVINGS", "SAVINGS", "SAVINGS", "CREDIT_CARD", "TIME_DEPOSIT"]);
  const app = http.post(`${BASE}/api/onboarding/applications`, JSON.stringify({
    product_type: product, full_name: "Calon Nasabah", email: `calon${Math.floor(Math.random() * 1e6)}@mail.example`, phone: "+62812" + Math.floor(1e7 + Math.random() * 9e7),
  }), p);
  if (app.status !== 201) return;
  const id = app.json().id;
  think(5, 20);
  if (Math.random() < 0.35) return; // drop-off before e-KYC
  const nik = "3174" + String(Math.floor(1e11 + Math.random() * 9e11));
  if (http.post(`${BASE}/api/onboarding/applications/${id}/ekyc`, JSON.stringify({ nik, birth_date: "1994-03-17", mother_maiden_name: "Sri Wahyuni" }), p).status !== 200) return;
  think(3, 10);
  if (Math.random() < 0.15) return; // drop-off before submit
  http.post(`${BASE}/api/onboarding/applications/${id}/submit`, null, p);
}

// ---- Top Up & Tagihan (biller-service) ----

// Stable per-customer numbers: the same household pays the same PLN meter and BPJS VA every month.
function digitsFor(c, salt, len) {
  let h = 2166136261;
  for (const ch of c.cif + salt) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  let out = "";
  while (out.length < len) { h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0; out += String(h % 10); }
  return out;
}
const OPERATORS = { telkomsel: ["0811", "0812", "0813", "0821", "0822", "0823", "0851", "0852", "0853"], indosat: ["0814", "0815", "0816", "0855", "0856", "0857", "0858"],
  xl: ["0817", "0818", "0819", "0859", "0877", "0878"], tri: ["0895", "0896", "0897", "0898", "0899"], smartfren: ["0881", "0882", "0883", "0884", "0885", "0886", "0887", "0888", "0889"] };
const operatorOf = (phone) => Object.keys(OPERATORS).find((op) => OPERATORS[op].includes(phone.slice(0, 4)));
// Market share, roughly: GoPay and DANA lead, then ShopeePay and OVO.
const EWALLETS = ["gopay", "gopay", "gopay", "dana", "dana", "dana", "shopeepay", "shopeepay", "ovo", "ovo", "linkaja"];

function payBill(token, c, journey, inquiryBody) {
  const p = authed(token, journey);
  const inq = http.post(`${BASE}/api/billers/inquiry`, JSON.stringify(inquiryBody), p);
  if (inq.status !== 200) return; // unknown customer number etc.: the customer gives up
  think(2, 6); // checking the name and amount
  if (Math.random() < 0.05) return; // abandons at confirmation
  const res = http.post(`${BASE}/api/billers/payments`, JSON.stringify({ inquiry_id: inq.json().inquiry_id, source_account_number: pick(c.savings) }), {
    headers: { ...p.headers, "Idempotency-Key": uuid() }, tags: p.tags,
  });
  check(res, { "bill payment 201": (r) => r.status === 201 });
  if (res.status === 201 && Math.random() < 0.3) {
    think(1, 3);
    http.get(`${BASE}/api/billers/payments?page_size=10`, p);
  }
}

function topupEwallet(token, c) {
  http.get(`${BASE}/api/billers/categories`, authed(token, "topup_ewallet"));
  think(2, 6);
  const value = pick(["50000", "100000", "100000", "200000", amount(150_000, 0.8, 10_000)]);
  payBill(token, c, "topup_ewallet", { biller_code: pick(EWALLETS), customer_number: c.phone, amount: { amount: String(Math.min(2_000_000, Math.max(10_000, Number(value)))), currency: "IDR" } });
}

function pulsa(token, c) {
  const p = authed(token, "pulsa_data");
  http.get(`${BASE}/api/billers/categories`, p);
  const op = operatorOf(c.phone);
  if (!op) return;
  const products = http.get(`${BASE}/api/billers/${op}/products`, p);
  if (products.status !== 200) return;
  think(2, 8); // choosing a denomination
  const wantData = Math.random() < 0.55;
  const options = products.json().filter((x) => x.category === (wantData ? "PAKET_DATA" : "PULSA"));
  if (!options.length) return;
  // Mid-sized denominations sell most.
  const product = options[Math.min(options.length - 1, Math.floor(Math.abs(Math.random() + Math.random() - 0.6) * options.length))];
  payBill(token, c, "pulsa_data", { biller_code: op, customer_number: c.phone, product_code: product.code });
}

function bill(token, c) {
  const p = authed(token, "bill");
  http.get(`${BASE}/api/billers/categories`, p);
  think(2, 6);
  const r = Math.random();
  let body;
  if (r < 0.35) {
    const tokens = ["PLN-20K", "PLN-50K", "PLN-100K", "PLN-100K", "PLN-200K", "PLN-500K"];
    http.get(`${BASE}/api/billers/pln/products`, p);
    body = { biller_code: "pln", customer_number: digitsFor(c, "pln", 12), product_code: pick(tokens) };
  } else if (r < 0.55) body = { biller_code: "pln", customer_number: digitsFor(c, "pln", 12) };
  else if (r < 0.72) body = { biller_code: pick(["indihome", "indihome", "biznet", "firstmedia"]), customer_number: digitsFor(c, "net", 12) };
  else if (r < 0.86) body = { biller_code: "bpjs-kesehatan", customer_number: "88888" + digitsFor(c, "bpjs", 11) };
  else body = { biller_code: "pdam-jakarta", customer_number: digitsFor(c, "pdam", 8) };
  // ~2% mistype the customer number into one the biller doesn't know.
  if (Math.random() < 0.02) body.customer_number = body.customer_number.slice(0, -4) + "0000";
  payBill(token, c, "bill", body);
}

const SENDERS = ["BUDI SANTOSO", "SITI RAHMAWATI", "AGUS PRATAMA", "DEWI KUSUMA", "HENDRA WIJAYA", "RINA HIDAYAT", "ANDI NASUTION"];
const EMPLOYERS = ["PT SINAR MAS TEKNOLOGI", "PT GARUDA LOGISTIK NUSANTARA", "PT MITRA RETAIL INDONESIA", "PT CAHAYA ENERGI PERSADA", "UNIVERSITAS NUSANTARA"];

// Money arriving from other banks keeps balances healthy: without it, outbound
// transfers drain regular customers within a day and transfers start failing.
function inbound(c) {
  const payroll = Math.random() < 0.3;
  const body = {
    rail_reference: `IN${Date.now()}${Math.floor(Math.random() * 1e6)}`,
    rail: payroll ? "SKN" : "BIFAST",
    sender_bank_code: pick(["014", "008", "002", "009", "022", "451"]),
    sender_account_number: String(Math.floor(1e9 + Math.random() * 9e9)),
    sender_name: payroll ? pick(EMPLOYERS) : pick(SENDERS),
    destination_account_number: pick(c.savings),
    amount: { amount: payroll ? amount(9_000_000, 0.5, 50_000) : amount(1_200_000, 0.9, 5_000), currency: "IDR" },
    ...(payroll ? { description: "GAJI" } : {}),
  };
  check(http.post(RAIL_INBOUND, JSON.stringify(body), { headers: json, tags: { journey: "inbound" } }), { "inbound 201": (r) => r.status === 201 });
}

function wrongPassword(c) {
  http.post(`${BASE}/api/auth/login`, JSON.stringify({ username: c.username, password: "salah-ketik" }), { headers: json, ...tag("login_failed") });
}

export default function () {
  const hour = (new Date().getUTCHours() + 7) % 24; // WIB
  if (Math.random() > DAY_CURVE[hour]) return; // thin traffic outside peak hours

  const c = pick(customers);
  const r = Math.random();
  if (r < 0.05) {
    group("onboarding", onboarding);
    journeys.add(1, { journey: "onboarding" });
    return;
  }
  if (r < 0.13) {
    inbound(c);
    journeys.add(1, { journey: "inbound" });
    return;
  }
  if (r < 0.15) {
    wrongPassword(c);
    journeys.add(1, { journey: "login_failed" });
    return;
  }
  const token = login(c);
  if (!token) return;
  const j = Math.random();
  let name;
  if (j < 0.29) { name = "browse"; group(name, () => browse(token, c)); }
  else if (j < 0.37) { name = "topup_ewallet"; group(name, () => topupEwallet(token, c)); }
  else if (j < 0.415) { name = "pulsa_data"; group(name, () => pulsa(token, c)); }
  else if (j < 0.45) { name = "bill"; group(name, () => bill(token, c)); }
  else if (j < 0.57) { name = "transfer_intrabank"; group(name, () => transfer(token, c, "INTRABANK")); }
  else if (j < 0.75) { name = "transfer_bifast"; group(name, () => transfer(token, c, "BIFAST")); }
  else if (j < 0.79) { name = "transfer_skn"; group(name, () => transfer(token, c, "SKN")); }
  else if (j < 0.86) { name = "loan_simulate"; group(name, () => loanSimulate(token)); }
  else if (j < 0.865) { name = "loan_apply"; group(name, () => loanApply(token, c)); }
  else { name = "estatement"; group(name, () => statement(token, c)); }
  journeys.add(1, { journey: name });
  if (Math.random() < 0.6) http.post(`${BASE}/api/auth/logout`, null, authed(token, name));
}
