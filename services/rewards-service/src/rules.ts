// Loyalty rules. Pure functions over Kafka event payloads (catalog/openapi.yaml
// TransferEvent / BillPaymentEvent), so the points maths is unit-testable.

export type Segment = "REGULAR" | "PRIORITY" | "PRIVATE";
export type Tier = "SILVER" | "GOLD" | "PLATINUM";

export interface Earn {
  cif: string;
  points: number;
  description: string;
  reference: string;
  source: "transfer" | "bill";
}

type Event = Record<string, unknown>;
const text = (e: Event, k: string) => (typeof e[k] === "string" ? (e[k] as string) : "");
const amountOf = (e: Event, k: string) => Number((e[k] as { amount?: string } | undefined)?.amount ?? 0);
export const rupiah = (n: number) => "Rp" + n.toLocaleString("id-ID");

const MULTIPLIER: Record<Segment, number> = { REGULAR: 1, PRIORITY: 1.5, PRIVATE: 2 };

function points(amount: number, perPoint: number, cap: number, segment: Segment): number {
  return Math.min(cap, Math.floor(amount / perPoint)) * MULTIPLIER[segment] | 0;
}

const RAIL_NAME: Record<string, string> = { INTRABANK: "Sesama Nusa Bank", BIFAST: "BI FAST", SKN: "SKN" };

// payments.transfer.v1 — successful outgoing transfers only. Inbound credits
// (transfer.received) earn nothing: the customer didn't do anything.
export function fromTransfer(e: Event, segment: Segment): Earn | null {
  if (text(e, "event_type") !== "transfer.completed" || text(e, "status") !== "SUCCESS" || !text(e, "cif")) return null;
  const rail = text(e, "rail");
  const amount = amountOf(e, "amount");
  // Intrabank moves are cheap for the bank, so they earn less than interbank rails.
  const p = rail === "INTRABANK" ? points(amount, 50_000, 100, segment) : points(amount, 20_000, 500, segment);
  if (p <= 0) return null;
  return { cif: text(e, "cif"), points: p, description: `Transfer ${RAIL_NAME[rail] ?? rail} ${rupiah(amount)}`, reference: text(e, "transfer_id"), source: "transfer" };
}

const BILL_LABEL: Record<string, string> = {
  EWALLET: "Top Up", PULSA: "Pulsa", PAKET_DATA: "Paket Data", PLN_PREPAID: "Token", PLN_POSTPAID: "Tagihan",
  INTERNET_TV: "Tagihan", PDAM: "Tagihan", BPJS: "Iuran",
};

// biller.payment.v1 — successful payments; the fee doesn't earn points.
export function fromBill(e: Event, segment: Segment): Earn | null {
  if (text(e, "status") !== "SUCCESS" || !text(e, "cif")) return null;
  const amount = amountOf(e, "amount");
  const p = points(amount, 5_000, 200, segment);
  if (p <= 0) return null;
  const biller = text(e, "biller_name") || text(e, "biller_code").toUpperCase();
  const label = BILL_LABEL[text(e, "category")] ?? "Pembayaran";
  return { cif: text(e, "cif"), points: p, description: `${label} ${biller} ${rupiah(amount)}`, reference: text(e, "payment_id"), source: "bill" };
}

// Tier from points earned in the last 90 days.
export const TIERS: { tier: Tier; min: number }[] = [
  { tier: "SILVER", min: 0 },
  { tier: "GOLD", min: 10_000 },
  { tier: "PLATINUM", min: 40_000 },
];

export function tierFor(points90d: number): { tier: Tier; next?: Tier; toNext?: number } {
  let i = 0;
  while (i + 1 < TIERS.length && points90d >= TIERS[i + 1].min) i++;
  const next = TIERS[i + 1];
  return { tier: TIERS[i].tier, ...(next ? { next: next.tier, toNext: next.min - points90d } : {}) };
}

// Deterministic welcome balance from the seed, so the demo opens on plausible numbers
// (Prioritas customers start in GOLD, Private in PLATINUM).
export function welcomePoints(cif: string, segment: Segment): number {
  let h = 2166136261;
  for (const ch of cif) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  const [lo, hi] = segment === "PRIVATE" ? [45_000, 90_000] : segment === "PRIORITY" ? [12_000, 30_000] : [1_500, 8_000];
  return Math.round((lo + (h % (hi - lo))) / 50) * 50;
}

export interface RewardItem {
  code: string;
  name: string;
  description: string;
  points_cost: number;
}

// Non-monetary rewards only: redemption never moves money outside the ledger.
export const CATALOG: RewardItem[] = [
  { code: "VOUCHER-PULSA-20K", name: "Voucher Pulsa Rp20.000", description: "Berlaku untuk semua operator", points_cost: 2_000 },
  { code: "VOUCHER-KOPI-25K", name: "Voucher Kopi Rp25.000", description: "Berlaku di gerai kopi mitra", points_cost: 2_500 },
  { code: "TIKET-BIOSKOP-2D", name: "Tiket Bioskop 2D", description: "Satu tiket, Senin–Kamis", points_cost: 4_000 },
  { code: "DONASI-BENCANA-50K", name: "Donasi Tanggap Bencana Rp50.000", description: "Disalurkan melalui lembaga kemanusiaan mitra", points_cost: 4_500 },
  { code: "VOUCHER-BELANJA-50K", name: "Voucher Belanja Online Rp50.000", description: "Minimal belanja Rp150.000", points_cost: 5_000 },
  { code: "VOUCHER-HOTEL-500K", name: "Voucher Menginap Rp500.000", description: "Hotel mitra di seluruh Indonesia", points_cost: 45_000 },
];
