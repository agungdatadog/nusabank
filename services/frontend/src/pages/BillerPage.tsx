import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  api, formatDateTime, formatMoney, maskAccount, RequestError,
  type Account, type BillerCategory, type BillerCategoryCode, type BillerProduct, type BillInquiry, type BillPayment,
} from "../api";
import { useAuth } from "../auth";
import { rumAction } from "../rum";

type Step = "form" | "confirm" | "result";

const PHONE_CATEGORIES: BillerCategoryCode[] = ["EWALLET", "PULSA", "PAKET_DATA"];
const PRODUCT_CATEGORIES: BillerCategoryCode[] = ["PULSA", "PAKET_DATA", "PLN_PREPAID"];
const EWALLET_PRESETS = [50_000, 100_000, 200_000, 500_000];

// Mirrors biller-service's prefix table, so picking a number selects its operator.
const OPERATOR_PREFIXES: Record<string, string[]> = {
  telkomsel: ["0811", "0812", "0813", "0821", "0822", "0823", "0851", "0852", "0853"],
  indosat: ["0814", "0815", "0816", "0855", "0856", "0857", "0858"],
  xl: ["0817", "0818", "0819", "0859", "0877", "0878"],
  tri: ["0895", "0896", "0897", "0898", "0899"],
  smartfren: ["0881", "0882", "0883", "0884", "0885", "0886", "0887", "0888", "0889"],
};
const operatorOf = (phone: string) => Object.keys(OPERATOR_PREFIXES).find((op) => OPERATOR_PREFIXES[op].includes(phone.slice(0, 4)));
const localPhone = (p?: string) => (p ?? "").replace(/^\+62/, "0").replace(/\D/g, "");
const total = (a: { amount: { amount: string }; fee: { amount: string } }) =>
  formatMoney({ amount: String(Number(a.amount.amount) + Number(a.fee.amount)), currency: "IDR" });

const STATUS_LABEL: Record<BillPayment["status"], string> = { SUCCESS: "Berhasil", PENDING: "Diproses", FAILED: "Gagal" };

export function BillerPage() {
  const { customer } = useAuth();
  const [categories, setCategories] = useState<BillerCategory[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [history, setHistory] = useState<BillPayment[]>([]);
  const [category, setCategory] = useState<BillerCategoryCode>("EWALLET");
  const [billerCode, setBillerCode] = useState("gopay");
  const [customerNumber, setCustomerNumber] = useState("");
  const [products, setProducts] = useState<BillerProduct[]>([]);
  const [productCode, setProductCode] = useState("");
  const [amount, setAmount] = useState("");
  const [source, setSource] = useState("");
  const [step, setStep] = useState<Step>("form");
  const [inquiry, setInquiry] = useState<BillInquiry | null>(null);
  const [result, setResult] = useState<BillPayment | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const loadHistory = () => api.get<BillPayment[]>("/api/billers/payments?page_size=10").then(setHistory).catch(() => setHistory([]));

  useEffect(() => {
    api.get<BillerCategory[]>("/api/billers/categories").then(setCategories);
    api.get<{ accounts: Account[] }>("/api/accounts").then((r) => {
      const eligible = r.accounts.filter((a) => (a.product_type === "SAVINGS" || a.product_type === "CURRENT") && a.currency === "IDR");
      setAccounts(eligible);
      if (eligible[0]) setSource(eligible[0].account_number);
    });
    loadHistory();
  }, []);

  const current = categories.find((c) => c.code === category);
  const biller = current?.billers.find((b) => b.code === billerCode);
  const visibleProducts = useMemo(() => products.filter((p) => p.category === category), [products, category]);

  // Switching category resets the form; phone-based categories start with the customer's own number.
  const chooseCategory = (code: BillerCategoryCode) => {
    const cat = categories.find((c) => c.code === code);
    setCategory(code);
    setProductCode("");
    setAmount("");
    setError(null);
    const own = PHONE_CATEGORIES.includes(code) ? localPhone(customer?.phone) : "";
    setCustomerNumber(own);
    const op = code !== "EWALLET" ? operatorOf(own) : undefined;
    setBillerCode(op && cat?.billers.some((b) => b.code === op) ? op : cat?.billers[0]?.code ?? "");
  };

  useEffect(() => {
    if (categories.length && !customerNumber && PHONE_CATEGORIES.includes(category)) chooseCategory(category);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categories]);

  useEffect(() => {
    setProducts([]);
    if (!billerCode || !PRODUCT_CATEGORIES.includes(category)) return;
    api.get<BillerProduct[]>(`/api/billers/${billerCode}/products`).then(setProducts).catch(() => setProducts([]));
  }, [billerCode, category]);

  const onNumber = (v: string) => {
    const digits = v.replace(/\D/g, "");
    setCustomerNumber(digits);
    if (category === "PULSA" || category === "PAKET_DATA") {
      const op = operatorOf(digits);
      if (op && op !== billerCode) {
        setBillerCode(op);
        setProductCode("");
      }
    }
  };

  const fail = (e: unknown) => {
    if (e instanceof RequestError) {
      setError(e.body.partner ? `${e.body.message} (kode: ${e.body.code})` : e.body.message);
    } else {
      setError("Tidak dapat terhubung, silakan coba lagi");
    }
  };

  const doInquiry = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const inq = await api.post<BillInquiry>("/api/billers/inquiry", {
        biller_code: billerCode,
        customer_number: customerNumber,
        ...(productCode ? { product_code: productCode } : {}),
        ...(category === "EWALLET" ? { amount: { amount: amount.replace(/\D/g, ""), currency: "IDR" } } : {}),
      });
      setInquiry(inq);
      setStep("confirm");
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  const pay = async () => {
    if (!inquiry) return;
    setBusy(true);
    setError(null);
    try {
      const p = await api.post<BillPayment>("/api/billers/payments", { inquiry_id: inquiry.inquiry_id, source_account_number: source },
        { "Idempotency-Key": crypto.randomUUID() });
      setResult(p);
      setStep("result");
      rumAction("bill_payment_submitted", { category: p.category, biller: p.biller_code, status: p.status, amount: Number(p.amount.amount) });
      loadHistory();
    } catch (err) {
      fail(err);
      rumAction("bill_payment_failed", { category, biller: billerCode, code: err instanceof RequestError ? err.body.code : "NETWORK", partner: err instanceof RequestError ? err.body.partner : undefined });
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    setStep("form");
    setInquiry(null);
    setResult(null);
    setError(null);
  };

  const needsProduct = PRODUCT_CATEGORIES.includes(category);
  const canSubmit = !!source && !!billerCode && !!customerNumber && (!needsProduct || !!productCode) && (category !== "EWALLET" || !!amount);

  return (
    <div className="stack narrow">
      <h1>Top Up &amp; Tagihan</h1>

      {step === "form" && (
        <form className="card stack" onSubmit={doInquiry}>
          <div className="tiles">
            {categories.map((c) => (
              <button type="button" key={c.code} className={category === c.code ? "active" : ""} onClick={() => chooseCategory(c.code)}>{c.name}</button>
            ))}
          </div>
          {current && current.billers.length > 1 && (
            <label>
              {category === "EWALLET" ? "E-wallet" : category === "PULSA" || category === "PAKET_DATA" ? "Operator" : "Penyedia"}
              <select value={billerCode} onChange={(e) => { setBillerCode(e.target.value); setProductCode(""); }}>
                {current.billers.map((b) => <option key={b.code} value={b.code}>{b.name}</option>)}
              </select>
            </label>
          )}
          <label>
            {biller?.customer_number_label ?? "Nomor pelanggan"}
            <input value={customerNumber} onChange={(e) => onNumber(e.target.value)} inputMode="numeric" required />
          </label>
          {category === "EWALLET" && (
            <label>
              Nominal top up (Rp)
              <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="numeric" placeholder="100.000" required />
              <div className="chips">
                {EWALLET_PRESETS.map((n) => (
                  <button type="button" key={n} onClick={() => setAmount(String(n))}>{formatMoney({ amount: String(n), currency: "IDR" })}</button>
                ))}
              </div>
            </label>
          )}
          {needsProduct && (
            <div className="products">
              {visibleProducts.map((p) => (
                <button type="button" key={p.code} className={productCode === p.code ? "active" : ""} onClick={() => setProductCode(p.code)}>
                  <strong>{p.name}</strong>
                  {p.description && <span className="small muted">{p.description}</span>}
                  <span className="small">{formatMoney(p.price)}</span>
                </button>
              ))}
            </div>
          )}
          <label>
            Bayar dari rekening
            <select value={source} onChange={(e) => setSource(e.target.value)} required>
              {accounts.map((a) => (
                <option key={a.account_number} value={a.account_number}>
                  {a.product_name} · {maskAccount(a.account_number)} · {formatMoney(a.available_balance)}
                </option>
              ))}
            </select>
          </label>
          {error && <div className="alert">{error}</div>}
          <button className="primary" disabled={busy || !canSubmit}>{busy ? "Memeriksa…" : "Lanjutkan"}</button>
        </form>
      )}

      {step === "confirm" && inquiry && (
        <div className="card stack">
          <h2 className="section-title">Konfirmasi Pembayaran</h2>
          <dl className="summary">
            <dt>Layanan</dt><dd>{inquiry.biller_name}{inquiry.product_name ? ` · ${inquiry.product_name}` : ""}</dd>
            <dt>{biller?.customer_number_label ?? "Nomor"}</dt><dd className="mono">{inquiry.customer_number}</dd>
            <dt>Nama</dt><dd><strong>{inquiry.customer_name}</strong></dd>
            {inquiry.period && <><dt>Periode</dt><dd>{inquiry.period}</dd></>}
            <dt>{inquiry.period ? "Tagihan" : "Nominal"}</dt><dd>{formatMoney(inquiry.amount)}</dd>
            <dt>Biaya admin</dt><dd>{formatMoney(inquiry.fee)}</dd>
            <dt>Total</dt><dd><strong>{total(inquiry)}</strong></dd>
            <dt>Dari rekening</dt><dd className="mono">{maskAccount(source)}</dd>
          </dl>
          {error && <div className="alert">{error}</div>}
          <div className="row">
            <button className="ghost" onClick={() => setStep("form")} disabled={busy}>Ubah</button>
            <button className="primary" onClick={pay} disabled={busy}>{busy ? "Memproses…" : "Bayar Sekarang"}</button>
          </div>
        </div>
      )}

      {step === "result" && result && (
        <div className="card stack center-text">
          <div className={`status ${result.status.toLowerCase()}`}>
            {result.status === "SUCCESS" ? "Pembayaran Berhasil" : result.status === "PENDING" ? "Pembayaran Sedang Diproses" : "Pembayaran Gagal"}
          </div>
          <p>{total(result)} · <strong>{result.biller_name}</strong> {result.customer_number}</p>
          {result.token && <div className="token mono">{result.token}</div>}
          {result.status === "PENDING" && <p className="muted">{result.biller_name} belum memberi konfirmasi. Status akan diperbarui otomatis; dana Anda tetap aman.</p>}
          {result.failure_reason && <p className="muted">Alasan: {result.failure_reason}</p>}
          {result.biller_reference && <p className="muted small mono">Ref: {result.biller_reference}</p>}
          <div className="row center">
            <button className="primary" onClick={reset}>Bayar lagi</button>
          </div>
        </div>
      )}

      <div className="card">
        <h2 className="section-title">Riwayat Pembayaran</h2>
        {history.length === 0 ? (
          <p className="muted">Belum ada pembayaran.</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <tbody>
                {history.map((p) => (
                  <tr key={p.id}>
                    <td className="nowrap small muted">{formatDateTime(p.created_at)}</td>
                    <td>{p.biller_name}{p.product_name ? ` · ${p.product_name}` : ""}<div className="small muted mono">{p.customer_number}</div></td>
                    <td className="right nowrap">{total(p)}</td>
                    <td><span className={`pill ${p.status.toLowerCase()}`}>{STATUS_LABEL[p.status]}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
