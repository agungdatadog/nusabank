import { useEffect, useMemo, useState, type FormEvent } from "react";
import { api, formatDateTime, formatMoney, maskAccount, RequestError, session, type Account, type Money } from "../api";
import { actionName, useT, type MessageKey } from "../i18n";
import { rumAction } from "../rum";

interface Product {
  code: "KPR" | "KKB" | "KTA";
  name: string;
  interest_method: string;
  fixed_rate: string;
  fixed_period_months?: number;
  floating_rate?: string;
  min_principal: Money;
  max_principal: Money;
  min_tenor_months: number;
  max_tenor_months: number;
  min_down_payment_percent?: number;
  required_documents: string[];
}

interface Simulation {
  principal: Money;
  tenor_months: number;
  first_installment: Money;
  floating_installment?: Money;
  total_interest: Money;
  total_payment: Money;
  schedule: { month: number; installment: string; principal: string; interest: string; remaining: string }[];
}

interface Application {
  id: string;
  product_code: string;
  status: string;
  principal: Money;
  tenor_months: number;
  monthly_installment: Money;
  documents: { document_type: string }[];
  decision_reason?: string;
  created_at: string;
}

const DOCS = ["KTP", "NPWP", "SLIP_GAJI", "SERTIFIKAT", "SPK_DEALER", "REKENING_KORAN"];
const STATUSES = ["DRAFT", "SUBMITTED", "UNDER_REVIEW", "APPROVED", "REJECTED", "DISBURSED"];
const EMPLOYMENT = ["KARYAWAN", "WIRASWASTA", "PROFESIONAL"] as const;
const DEFAULTS: Record<string, { price: string; dp: string; tenor: string }> = {
  KPR: { price: "750000000", dp: "75000000", tenor: "180" },
  KKB: { price: "320000000", dp: "64000000", tenor: "48" },
  KTA: { price: "50000000", dp: "0", tenor: "24" },
};
const idr = (v: string): Money => ({ amount: v.replace(/\D/g, "") || "0", currency: "IDR" });

export function LoanPage() {
  const { t } = useT();
  // Codes the UI has no copy for (a new product or status from the API) are shown raw.
  const docLabel = (d: string) => (DOCS.includes(d) ? t(`loan.doc.${d}` as MessageKey) : d);
  const statusLabel = (s: string) => (STATUSES.includes(s) ? t(`loan.status.${s}` as MessageKey) : s);
  const [products, setProducts] = useState<Product[]>([]);
  const [code, setCode] = useState<Product["code"]>("KPR");
  const [price, setPrice] = useState(DEFAULTS.KPR.price);
  const [dp, setDp] = useState(DEFAULTS.KPR.dp);
  const [tenor, setTenor] = useState(DEFAULTS.KPR.tenor);
  const [sim, setSim] = useState<Simulation | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [apps, setApps] = useState<Application[]>([]);
  const [applying, setApplying] = useState(false);
  const [form, setForm] = useState({ nik: "", income: "", account: "", employment: "KARYAWAN" });
  const [files, setFiles] = useState<Record<string, File>>({});
  const [result, setResult] = useState<Application | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const product = useMemo(() => products.find((p) => p.code === code), [products, code]);
  const loadApps = () => api.get<Application[]>("/api/loans/applications").then(setApps).catch(() => setApps([]));

  useEffect(() => {
    api.get<Product[]>("/api/loans/products").then(setProducts);
    api.get<{ accounts: Account[] }>("/api/accounts").then((r) => {
      const eligible = r.accounts.filter((a) => (a.product_type === "SAVINGS" || a.product_type === "CURRENT") && a.currency === "IDR");
      setAccounts(eligible);
      if (eligible[0]) setForm((f) => ({ ...f, account: eligible[0].account_number }));
    });
    loadApps();
  }, []);

  const pick = (c: Product["code"]) => {
    setCode(c);
    setPrice(DEFAULTS[c].price);
    setDp(DEFAULTS[c].dp);
    setTenor(DEFAULTS[c].tenor);
    setSim(null);
    setApplying(false);
    setResult(null);
    setError(null);
  };

  const fail = (e: unknown) => setError(e instanceof RequestError ? e.body.message : t("common.networkError"));

  const simulate = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const s = await api.post<Simulation>("/api/loans/simulations", { product_code: code, asset_price: idr(price), down_payment: idr(dp), tenor_months: Number(tenor) });
      setSim(s);
      rumAction("loan_simulated", { product: code, principal: Number(s.principal.amount), tenor: s.tenor_months });
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  const apply = async (e: FormEvent) => {
    e.preventDefault();
    if (!product) return;
    setBusy(true);
    setError(null);
    try {
      const app = await api.post<Application>("/api/loans/applications", {
        product_code: code, asset_price: idr(price), down_payment: idr(dp), tenor_months: Number(tenor),
        disbursement_account_number: form.account, monthly_income: idr(form.income), employment_type: form.employment, nik: form.nik,
      });
      // Multipart upload needs the bearer token but not a JSON content type, so plain fetch.
      for (const doc of product.required_documents) {
        const body = new FormData();
        body.append("document_type", doc);
        body.append("file", files[doc]);
        const res = await fetch(`/api/loans/applications/${app.id}/documents`, { method: "POST", headers: { Authorization: `Bearer ${session.token}` }, body });
        if (!res.ok) throw new RequestError(res.status, await res.json());
      }
      const decided = await api.post<Application>(`/api/loans/applications/${app.id}/submit`);
      setResult(decided);
      setApplying(false);
      rumAction("loan_submitted", { product: code, status: decided.status, principal: Number(decided.principal.amount) });
      loadApps();
    } catch (err) {
      fail(err);
      loadApps();
    } finally {
      setBusy(false);
    }
  };

  const missingFiles = product?.required_documents.filter((d) => !files[d]) ?? [];

  return (
    <div className="stack">
      <h1>{t("loan.title")}</h1>
      <div className="segmented">
        {products.map((p) => (
          <button type="button" key={p.code} className={code === p.code ? "active" : ""} onClick={() => pick(p.code)} {...actionName(`loan.${p.code}`)}>
            <strong>{t(`loan.${p.code}`)}</strong>
            <span className="small muted">
              {p.interest_method === "ANNUITY"
                ? t("loan.rateAnnuity", { fixed: p.fixed_rate, months: p.fixed_period_months ?? "", floating: p.floating_rate ?? "" })
                : t("loan.rateFlat", { rate: p.fixed_rate })} · {t("loan.tenorRange", { min: p.min_tenor_months, max: p.max_tenor_months })}
            </span>
          </button>
        ))}
      </div>

      <div className="grid two">
        <form className="card stack" onSubmit={simulate}>
          <h2 className="section-title">{t("loan.simulate", { name: product?.name ?? "" })}</h2>
          <label>{t(`loan.asset.${code}`)} (Rp)<input value={price} onChange={(e) => setPrice(e.target.value)} inputMode="numeric" required /></label>
          {code !== "KTA" && (
            <label>{t("loan.downPayment", { pct: product?.min_down_payment_percent ?? "" })}<input value={dp} onChange={(e) => setDp(e.target.value)} inputMode="numeric" required /></label>
          )}
          <label>{t("loan.tenor")}<input value={tenor} onChange={(e) => setTenor(e.target.value)} inputMode="numeric" required /></label>
          {error && !applying && <div className="alert">{error}</div>}
          <button className="primary" disabled={busy} {...actionName("loan.calculate")}>{busy && !applying ? t("loan.calculating") : t("loan.calculate")}</button>
        </form>

        <section className="card stack">
          <h2 className="section-title">{t("loan.result")}</h2>
          {!sim && <p className="muted">{t("loan.resultEmpty")}</p>}
          {sim && (
            <>
              <dl className="summary">
                <dt>{t("loan.principal")}</dt><dd>{formatMoney(sim.principal)}</dd>
                <dt>{t("loan.monthly")}</dt><dd><strong>{formatMoney(sim.first_installment)}</strong>{sim.floating_installment && <span className="muted small"> · {t("loan.firstMonths", { n: product?.fixed_period_months ?? "" })}</span>}</dd>
                {sim.floating_installment && <><dt>{t("loan.afterFloating")}</dt><dd>± {formatMoney(sim.floating_installment)}</dd></>}
                <dt>{t("loan.totalInterest")}</dt><dd>{formatMoney(sim.total_interest)}</dd>
                <dt>{t("loan.totalPayment")}</dt><dd>{formatMoney(sim.total_payment)}</dd>
              </dl>
              <button className="primary" onClick={() => { setApplying(true); setResult(null); setError(null); }} {...actionName("loan.applyNow")}>{t("loan.applyNow")}</button>
            </>
          )}
        </section>
      </div>

      {sim && (
        <section className="card">
          <h2 className="section-title">{t("loan.schedule", { tenor: sim.tenor_months })}</h2>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>{t("loan.month")}</th><th className="right">{t("loan.installment")}</th><th className="right">{t("loan.principalPart")}</th><th className="right">{t("loan.interest")}</th><th className="right">{t("loan.remaining")}</th></tr></thead>
              <tbody>
                {sim.schedule.slice(0, 12).map((r) => (
                  <tr key={r.month}><td>{r.month}</td>{[r.installment, r.principal, r.interest, r.remaining].map((v, i) => <td key={i} className="right">{formatMoney(idr(v))}</td>)}</tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {applying && product && (
        <form className="card stack" onSubmit={apply}>
          <h2 className="section-title">{t("loan.application", { name: product.name })}</h2>
          <div className="grid two">
            <label>{t("loan.nik")}<input value={form.nik} onChange={(e) => setForm({ ...form, nik: e.target.value })} inputMode="numeric" maxLength={16} pattern="\d{16}" required /></label>
            <label>{t("loan.income")}<input value={form.income} onChange={(e) => setForm({ ...form, income: e.target.value })} inputMode="numeric" required /></label>
            <label>{t("loan.employment")}<select value={form.employment} onChange={(e) => setForm({ ...form, employment: e.target.value })}>{EMPLOYMENT.map((v) => <option key={v} value={v}>{t(`loan.emp.${v}`)}</option>)}</select></label>
            <label>{t("loan.disbursement")}<select value={form.account} onChange={(e) => setForm({ ...form, account: e.target.value })}>{accounts.map((a) => <option key={a.account_number} value={a.account_number}>{a.product_name} · {maskAccount(a.account_number)}</option>)}</select></label>
          </div>
          <h3 className="small muted">{t("loan.requiredDocs")}</h3>
          <div className="grid two">
            {product.required_documents.map((d) => (
              <label key={d}>{docLabel(d)}<input type="file" accept=".pdf,.jpg,.jpeg,.png" onChange={(e) => e.target.files?.[0] && setFiles({ ...files, [d]: e.target.files[0] })} required /></label>
            ))}
          </div>
          {error && <div className="alert">{error}</div>}
          <div className="row">
            <button type="button" className="ghost" onClick={() => setApplying(false)} disabled={busy} {...actionName("common.cancel")}>{t("common.cancel")}</button>
            <button className="primary" disabled={busy || missingFiles.length > 0} {...actionName("loan.submit")}>{busy ? t("loan.checkingEligibility") : t("loan.submit")}</button>
          </div>
        </form>
      )}

      {result && (
        <div className="card stack center-text">
          <div className={`status ${result.status === "DISBURSED" ? "success" : result.status === "REJECTED" ? "failed" : "processing"}`}>
            {t(result.status === "DISBURSED" ? "loan.outcome.DISBURSED" : result.status === "REJECTED" ? "loan.outcome.REJECTED" : "loan.outcome.REVIEW")}
          </div>
          <p>{t("loan.resultLine", { principal: formatMoney(result.principal), n: result.tenor_months, installment: formatMoney(result.monthly_installment) })}</p>
          {result.decision_reason && <p className="muted">{result.decision_reason}</p>}
        </div>
      )}

      <section className="card">
        <h2 className="section-title">{t("loan.mine")}</h2>
        <table className="table">
          <thead><tr><th>{t("common.date")}</th><th>{t("loan.product")}</th><th className="right">{t("loan.principal")}</th><th>Tenor</th><th>{t("common.status")}</th></tr></thead>
          <tbody>
            {apps.map((a) => (
              <tr key={a.id}>
                <td className="nowrap">{formatDateTime(a.created_at)}</td>
                <td>{["KPR", "KKB", "KTA"].includes(a.product_code) ? t(`loan.${a.product_code}` as MessageKey) : a.product_code}</td>
                <td className="right">{formatMoney(a.principal)}</td>
                <td>{t("loan.months", { n: a.tenor_months })}</td>
                <td><span className={`pill ${a.status === "DISBURSED" ? "success" : a.status === "REJECTED" ? "failed" : "processing"}`}>{statusLabel(a.status)}</span></td>
              </tr>
            ))}
            {!apps.length && <tr><td colSpan={5} className="muted">{t("loan.none")}</td></tr>}
          </tbody>
        </table>
      </section>
    </div>
  );
}
