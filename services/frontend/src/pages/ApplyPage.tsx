import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { api, RequestError } from "../api";
import { Logo } from "../components/Layout";
import { LangSwitcher } from "../components/LangSwitcher";
import { actionName, useT } from "../i18n";
import { rumAction } from "../rum";

const PRODUCTS = [
  { code: "SAVINGS", label: "Tabungan Nusa Harian" },
  { code: "CREDIT_CARD", label: "Kartu Kredit Nusa Platinum" },
  { code: "TIME_DEPOSIT", label: "Deposito Nusa Berjangka" },
  { code: "CURRENT", label: "Giro Nusa Bisnis" },
];

interface Application {
  id: string;
  step: string;
}

/** Onboarding funnel (started -> ekyc_submitted -> submitted -> approved/rejected): the EP1 conversion metric. */
export function ApplyPage() {
  const { t } = useT();
  const [app, setApp] = useState<Application | null>(null);
  const [form, setForm] = useState({ product_type: "SAVINGS", full_name: "", email: "", phone: "", nik: "", birth_date: "", mother_maiden_name: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });

  const run = async (fn: () => Promise<Application>) => {
    setBusy(true);
    setError(null);
    try {
      const next = await fn();
      setApp(next);
      rumAction("onboarding_step", { step: next.step, product: form.product_type });
    } catch (err) {
      setError(err instanceof RequestError ? err.body.message : t("common.networkError"));
    } finally {
      setBusy(false);
    }
  };

  const start = (e: FormEvent) => {
    e.preventDefault();
    run(() => api.post<Application>("/api/onboarding/applications", { product_type: form.product_type, full_name: form.full_name, email: form.email, phone: form.phone }));
  };
  const ekyc = (e: FormEvent) => {
    e.preventDefault();
    run(() => api.post<Application>(`/api/onboarding/applications/${app!.id}/ekyc`, { nik: form.nik, birth_date: form.birth_date, mother_maiden_name: form.mother_maiden_name }));
  };
  const submit = () => run(() => api.post<Application>(`/api/onboarding/applications/${app!.id}/submit`));

  return (
    <div className="login">
      <div className="lang-float"><LangSwitcher /></div>
      <div className="login-hero">
        <Logo />
        <h1>{t("apply.heroTitle")}</h1>
        <p>{t("apply.heroText")}</p>
      </div>
      <div className="card login-card stack">
        {!app && (
          <form className="stack" onSubmit={start}>
            <h2>{t("apply.step1")}</h2>
            <label>{t("apply.product")}<select value={form.product_type} onChange={set("product_type")}>{PRODUCTS.map((p) => <option key={p.code} value={p.code}>{p.label}</option>)}</select></label>
            <label>{t("apply.fullName")}<input value={form.full_name} onChange={set("full_name")} required /></label>
            <label>{t("apply.email")}<input type="email" value={form.email} onChange={set("email")} required /></label>
            <label>{t("apply.phone")}<input value={form.phone} onChange={set("phone")} placeholder="+6281234567890" required /></label>
            {error && <div className="alert">{error}</div>}
            <button className="primary" disabled={busy} {...actionName("common.continue")}>{t("common.continue")}</button>
          </form>
        )}
        {app?.step === "started" && (
          <form className="stack" onSubmit={ekyc}>
            <h2>{t("apply.step2")}</h2>
            <label>{t("apply.nik")}<input value={form.nik} onChange={set("nik")} inputMode="numeric" maxLength={16} pattern="\d{16}" required /></label>
            <label>{t("apply.birthDate")}<input type="date" value={form.birth_date} onChange={set("birth_date")} required /></label>
            <label>{t("apply.mother")}<input value={form.mother_maiden_name} onChange={set("mother_maiden_name")} required /></label>
            {error && <div className="alert">{error}</div>}
            <button className="primary" disabled={busy} {...actionName("login.verify")}>{t("login.verify")}</button>
          </form>
        )}
        {app?.step === "ekyc_submitted" && (
          <div className="stack">
            <h2>{t("apply.step3")}</h2>
            <p className="muted">{t("apply.terms")}</p>
            {error && <div className="alert">{error}</div>}
            <button className="primary" onClick={submit} disabled={busy} {...actionName("loan.submit")}>{t("loan.submit")}</button>
          </div>
        )}
        {(app?.step === "approved" || app?.step === "rejected") && (
          <div className="stack center-text">
            <div className={`status ${app.step === "approved" ? "success" : "failed"}`}>{t(app.step === "approved" ? "apply.approved" : "apply.rejected")}</div>
            <p className="muted">{t(app.step === "approved" ? "apply.approvedNote" : "apply.rejectedNote")}</p>
          </div>
        )}
        <p className="muted small"><Link to="/login" {...actionName("apply.back")}>{t("apply.back")}</Link></p>
      </div>
    </div>
  );
}
