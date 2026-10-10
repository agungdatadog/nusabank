// The biller catalogue. Static on purpose: what Nusa Bank sells is product config, and
// keeping it in code makes it reviewable next to the OpenAPI contract. Codes match
// BillerCode in catalog/openapi.yaml and the billers partner-mock knows.

export type Category = "EWALLET" | "PULSA" | "PAKET_DATA" | "INTERNET_TV" | "PLN_PREPAID" | "PLN_POSTPAID" | "PDAM" | "BPJS";

export interface Biller {
  code: string;
  name: string;
  customerNumberLabel: string;
  customerNumber: RegExp;
  fee: number; // IDR admin fee charged on top of the amount
}

export interface Product {
  code: string;
  name: string;
  category: Category;
  description?: string;
  price: number; // IDR the customer pays, before fee
  nominal?: number; // face value sent to the biller, when it differs from price
}

const PHONE = /^08\d{8,11}$/;

const b = (code: string, name: string, customerNumberLabel: string, customerNumber: RegExp, fee: number): Biller =>
  ({ code, name, customerNumberLabel, customerNumber, fee });

export const BILLERS: Record<string, Biller> = Object.fromEntries([
  b("gopay", "GoPay", "Nomor HP", PHONE, 1000),
  b("ovo", "OVO", "Nomor HP", PHONE, 1500),
  b("shopeepay", "ShopeePay", "Nomor HP", PHONE, 1000),
  b("dana", "DANA", "Nomor HP", PHONE, 1000),
  b("linkaja", "LinkAja", "Nomor HP", PHONE, 1000),
  b("telkomsel", "Telkomsel", "Nomor HP", PHONE, 0),
  b("indosat", "Indosat", "Nomor HP", PHONE, 0),
  b("xl", "XL", "Nomor HP", PHONE, 0),
  b("tri", "Tri", "Nomor HP", PHONE, 0),
  b("smartfren", "Smartfren", "Nomor HP", PHONE, 0),
  b("indihome", "IndiHome", "Nomor Pelanggan", /^\d{12}$/, 2500),
  b("biznet", "Biznet Home", "ID Pelanggan", /^\d{8,12}$/, 2500),
  b("firstmedia", "First Media", "Nomor Pelanggan", /^\d{8,12}$/, 2500),
  b("pln", "PLN", "Nomor Meter / ID Pelanggan", /^\d{11,12}$/, 2500),
  b("pdam-jakarta", "PAM JAYA (DKI Jakarta)", "Nomor Pelanggan", /^\d{6,10}$/, 2500),
  b("bpjs-kesehatan", "BPJS Kesehatan", "Nomor VA Keluarga", /^\d{16}$/, 2500),
].map((x) => [x.code, x]));

// Which billers each category shows, in display order. PLN appears twice (token vs bill),
// and every operator sells both pulsa and data.
export const CATEGORIES: { code: Category; name: string; billers: string[]; openAmount: boolean }[] = [
  { code: "EWALLET", name: "Top Up E-Wallet", billers: ["gopay", "ovo", "shopeepay", "dana", "linkaja"], openAmount: true },
  { code: "PULSA", name: "Pulsa", billers: ["telkomsel", "indosat", "xl", "tri", "smartfren"], openAmount: false },
  { code: "PAKET_DATA", name: "Paket Data", billers: ["telkomsel", "indosat", "xl", "tri", "smartfren"], openAmount: false },
  { code: "PLN_PREPAID", name: "Token Listrik", billers: ["pln"], openAmount: false },
  { code: "PLN_POSTPAID", name: "Tagihan Listrik", billers: ["pln"], openAmount: false },
  { code: "INTERNET_TV", name: "Internet & TV Kabel", billers: ["indihome", "biznet", "firstmedia"], openAmount: false },
  { code: "PDAM", name: "Air PDAM", billers: ["pdam-jakarta"], openAmount: false },
  { code: "BPJS", name: "BPJS Kesehatan", billers: ["bpjs-kesehatan"], openAmount: false },
];

export const EWALLET_MIN = 10_000;
export const EWALLET_MAX = 2_000_000;

// Mobile number prefixes per operator, so a Telkomsel package can't go to an XL number.
const OPERATOR_PREFIXES: Record<string, string[]> = {
  telkomsel: ["0811", "0812", "0813", "0821", "0822", "0823", "0851", "0852", "0853"],
  indosat: ["0814", "0815", "0816", "0855", "0856", "0857", "0858"],
  xl: ["0817", "0818", "0819", "0859", "0877", "0878"],
  tri: ["0895", "0896", "0897", "0898", "0899"],
  smartfren: ["0881", "0882", "0883", "0884", "0885", "0886", "0887", "0888", "0889"],
};

export function operatorOf(phone: string): string | undefined {
  const prefix = phone.slice(0, 4);
  return Object.keys(OPERATOR_PREFIXES).find((op) => OPERATOR_PREFIXES[op].includes(prefix));
}

const rupiah = (n: number) => "Rp" + n.toLocaleString("id-ID");

// Retail pulsa prices: small denominations carry a margin, large ones a small discount.
const PULSA: [number, number][] = [[5_000, 6_500], [10_000, 11_500], [20_000, 21_000], [25_000, 26_000], [50_000, 50_500], [100_000, 99_500], [200_000, 198_000]];
const DATA_PACKS: Record<string, { gb: number; days: number; price: number }[]> = {
  telkomsel: [{ gb: 3, days: 7, price: 25_000 }, { gb: 15, days: 30, price: 85_000 }, { gb: 35, days: 30, price: 150_000 }],
  indosat: [{ gb: 5, days: 7, price: 22_000 }, { gb: 20, days: 30, price: 75_000 }, { gb: 50, days: 30, price: 130_000 }],
  xl: [{ gb: 4, days: 7, price: 24_000 }, { gb: 18, days: 30, price: 80_000 }, { gb: 40, days: 30, price: 140_000 }],
  tri: [{ gb: 6, days: 7, price: 20_000 }, { gb: 25, days: 30, price: 70_000 }, { gb: 60, days: 30, price: 120_000 }],
  smartfren: [{ gb: 6, days: 7, price: 20_000 }, { gb: 30, days: 30, price: 65_000 }, { gb: 60, days: 30, price: 110_000 }],
};
const PLN_TOKENS = [20_000, 50_000, 100_000, 200_000, 500_000, 1_000_000];
const PREFIX: Record<string, string> = { telkomsel: "TSEL", indosat: "ISAT", xl: "XL", tri: "TRI", smartfren: "SF" };

export function productsFor(billerCode: string): Product[] {
  if (billerCode === "pln") {
    return PLN_TOKENS.map((n) => ({ code: `PLN-${n / 1000}K`, name: `Token PLN ${rupiah(n)}`, category: "PLN_PREPAID", price: n, nominal: n }));
  }
  const p = PREFIX[billerCode];
  if (!p) return [];
  return [
    ...PULSA.map(([nominal, price]): Product => ({ code: `${p}-${nominal / 1000}K`, name: `Pulsa ${rupiah(nominal)}`, category: "PULSA", price, nominal })),
    ...DATA_PACKS[billerCode].map((d): Product => ({
      code: `${p}-DATA-${d.gb}GB`, name: `Internet ${d.gb} GB`, category: "PAKET_DATA",
      description: `Kuota ${d.gb} GB, berlaku ${d.days} hari`, price: d.price,
    })),
  ];
}

export function findProduct(billerCode: string, productCode: string): Product | undefined {
  return productsFor(billerCode).find((p) => p.code === productCode);
}

export function isEwallet(billerCode: string): boolean {
  return CATEGORIES[0].billers.includes(billerCode);
}

export function isOperator(billerCode: string): boolean {
  return billerCode in PREFIX;
}

// Category of a bill paid without a product (the biller decides the amount).
export function postpaidCategory(billerCode: string): Category | undefined {
  if (billerCode === "pln") return "PLN_POSTPAID";
  return CATEGORIES.find((c) => !c.openAmount && c.code !== "PULSA" && c.code !== "PAKET_DATA" && c.code !== "PLN_PREPAID" && c.billers.includes(billerCode))?.code;
}

// "OKT 2026" — the billing period shown for postpaid bills, in WIB.
const MONTHS = ["JAN", "FEB", "MAR", "APR", "MEI", "JUN", "JUL", "AGU", "SEP", "OKT", "NOV", "DES"];
export function billingPeriod(now = new Date()): string {
  const wib = new Date(now.getTime() + 7 * 3600_000);
  return `${MONTHS[wib.getUTCMonth()]} ${wib.getUTCFullYear()}`;
}
