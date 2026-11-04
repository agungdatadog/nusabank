// Thin client for the Nusa Bank API (catalog/openapi.yaml). Same-origin, so RUM can
// attach trace headers and no CORS is involved.
import { translate } from "./i18n";

export interface Money {
  amount: string;
  currency: "IDR" | "USD" | "JPY";
}

export interface ApiError {
  code: string;
  message: string;
  partner?: string;
  trace_id?: string;
}

export class RequestError extends Error {
  constructor(public status: number, public body: ApiError) {
    super(body.message);
  }
}

const TOKEN_KEY = "nusabank.token";

export const session = {
  get token() {
    return sessionStorage.getItem(TOKEN_KEY);
  },
  set(token: string) {
    sessionStorage.setItem(TOKEN_KEY, token);
  },
  clear() {
    sessionStorage.removeItem(TOKEN_KEY);
  },
};

let onUnauthorized: () => void = () => undefined;
export function setUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn;
}

async function request<T>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: {
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(session.token ? { Authorization: `Bearer ${session.token}` } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401 && session.token) {
    session.clear();
    onUnauthorized();
  }
  if (!res.ok) {
    let err: ApiError = { code: "HTTP_" + res.status, message: translate("common.genericError") };
    try {
      err = await res.json();
    } catch {
      /* non-JSON error body */
    }
    throw new RequestError(res.status, err);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body?: unknown, headers?: Record<string, string>) => request<T>("POST", path, body, headers),
};

// ---- shapes used by the UI ----

export interface Customer {
  cif: string;
  full_name: string;
  email: string;
  phone: string;
  segment: string;
  address: string;
}

export interface Account {
  account_number: string;
  product_type: string;
  product_name: string;
  currency: Money["currency"];
  balance: Money;
  available_balance: Money;
  status: string;
  credit_limit?: Money;
  maturity_date?: string;
  interest_rate?: string;
}

export interface Transaction {
  id: string;
  posted_at: string;
  type: "CREDIT" | "DEBIT";
  amount: Money;
  description: string;
  channel: string;
  balance_after: Money;
}

export interface Bank {
  code: string;
  name: string;
  rails: string[];
}

export interface Inquiry {
  inquiry_id: string;
  rail: string;
  destination_bank_name: string;
  destination_account_number: string;
  destination_account_name: string;
  amount: Money;
  fee: Money;
  expected_settlement_at?: string;
  expires_at: string;
}

export interface Transfer {
  id: string;
  rail: string;
  status: "PROCESSING" | "SUCCESS" | "FAILED";
  source_account_number: string;
  destination_bank_name: string;
  destination_account_number: string;
  destination_account_name: string;
  amount: Money;
  fee: Money;
  note?: string;
  rail_reference?: string;
  skn_window_id?: string;
  failure_reason?: string;
  created_at: string;
  settled_at?: string;
}

// ---- formatting ----

const fmt: Record<string, Intl.NumberFormat> = {
  IDR: new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }),
  USD: new Intl.NumberFormat("id-ID", { style: "currency", currency: "USD", minimumFractionDigits: 2 }),
  JPY: new Intl.NumberFormat("id-ID", { style: "currency", currency: "JPY", maximumFractionDigits: 0 }),
};

export const formatMoney = (m: Money) => fmt[m.currency].format(Number(m.amount));

export const formatDateTime = (iso: string) =>
  new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Jakarta" }).format(new Date(iso));

export const maskAccount = (n: string) => n.replace(/(\d{4})(?=\d)/g, "$1 ");

// ---- biller-service ----

export type BillerCategoryCode = "EWALLET" | "PULSA" | "PAKET_DATA" | "INTERNET_TV" | "PLN_PREPAID" | "PLN_POSTPAID" | "PDAM" | "BPJS";

export interface Biller {
  code: string;
  name: string;
  customer_number_label: string;
  open_amount: boolean;
}

export interface BillerCategory {
  code: BillerCategoryCode;
  name: string;
  billers: Biller[];
}

export interface BillerProduct {
  code: string;
  name: string;
  category: BillerCategoryCode;
  description?: string;
  price: Money;
}

export interface BillInquiry {
  inquiry_id: string;
  biller_code: string;
  biller_name: string;
  customer_number: string;
  customer_name: string;
  product_name?: string;
  period?: string;
  amount: Money;
  fee: Money;
  expires_at: string;
}

export interface BillPayment {
  id: string;
  biller_code: string;
  biller_name: string;
  category: BillerCategoryCode;
  customer_number: string;
  customer_name?: string;
  product_name?: string;
  period?: string;
  amount: Money;
  fee: Money;
  status: "SUCCESS" | "FAILED" | "PENDING";
  biller_reference?: string;
  token?: string;
  failure_reason?: string;
  created_at: string;
}

// ---- rewards-service ----

export interface RewardsBalance {
  points: number;
  tier: "SILVER" | "GOLD" | "PLATINUM";
  tier_points_90d?: number;
  next_tier?: "GOLD" | "PLATINUM";
  points_to_next_tier?: number;
}

export interface RewardsEntry {
  id: string;
  type: "EARN" | "REDEEM" | "EXPIRE";
  points: number;
  description: string;
  reference?: string;
  voucher_code?: string;
  created_at: string;
}

export interface RewardItem {
  code: string;
  name: string;
  description?: string;
  points_cost: number;
}

// ---- chat-service ----

export interface ChatMessage {
  id: string;
  role: "customer" | "assistant" | "agent_handoff";
  content: string;
  created_at: string;
}

export interface ChatSession {
  id: string;
  status: "OPEN" | "HANDED_OFF" | "CLOSED";
  messages?: ChatMessage[];
  created_at: string;
}
