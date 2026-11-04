import { useCallback, useEffect, useState, type FormEvent } from "react";
import { formatDateTime, formatMoney, maskAccount, type Customer, type Transfer } from "../api";
import { Logo } from "../components/Layout";
import { LangSwitcher } from "../components/LangSwitcher";
import { actionName, translate, useT } from "../i18n";
import { rumAction } from "../rum";

// Back-office console for operators (admin-service). Its own token, separate from the
// customer session, so an operator and a customer can be signed in side by side.
const OPS_TOKEN = "nusabank.ops.token";
const OPS_NAME = "nusabank.ops.name";

interface AuditEntry {
  id: string;
  operator: string;
  action: string;
  target: string;
  created_at: string;
}

type Tab = "transfers" | "customers" | "audit";

async function ops<T>(method: string, path: string, body?: unknown): Promise<T> {
  const token = sessionStorage.getItem(OPS_TOKEN);
  const res = await fetch(path, {
    method,
    headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) sessionStorage.removeItem(OPS_TOKEN);
  if (!res.ok) throw Object.assign(new Error(data.message ?? translate("ops.requestFailed")), { status: res.status, body: data });
  return data as T;
}

export function OpsPage() {
  const [name, setName] = useState(sessionStorage.getItem(OPS_NAME));
  const [signedIn, setSignedIn] = useState(!!sessionStorage.getItem(OPS_TOKEN));
  const [tab, setTab] = useState<Tab>("transfers");
  const { t } = useT();

  const logout = () => {
    sessionStorage.removeItem(OPS_TOKEN);
    sessionStorage.removeItem(OPS_NAME);
    setSignedIn(false);
  };

  return (
    <div className="app">
      <header className="topbar">
        <Logo />
        <nav>
          {signedIn && (
            <>
              <button className={`link ops-tab ${tab === "transfers" ? "active" : ""}`} onClick={() => setTab("transfers")} {...actionName("ops.tabTransfers")}>{t("ops.tabTransfers")}</button>
              <button className={`link ops-tab ${tab === "customers" ? "active" : ""}`} onClick={() => setTab("customers")} {...actionName("ops.tabCustomers")}>{t("ops.tabCustomers")}</button>
              <button className={`link ops-tab ${tab === "audit" ? "active" : ""}`} onClick={() => setTab("audit")} {...actionName("ops.tabAudit")}>{t("ops.tabAudit")}</button>
            </>
          )}
        </nav>
        <div className="user">
          <span className="badge">Back Office</span>
          <LangSwitcher />
          {signedIn && <><span>{name}</span><button className="link" onClick={logout} {...actionName("common.signOut")}>{t("common.signOut")}</button></>}
        </div>
      </header>
      <main className="content">
        {!signedIn ? (
          <OpsLogin onDone={(n) => { setName(n); setSignedIn(true); }} />
        ) : tab === "transfers" ? <Transfers onUnauthorized={logout} /> : tab === "customers" ? <Customers /> : <Audit />}
      </main>
      <footer className="footer">{t("ops.footer")}</footer>
    </div>
  );
}

function OpsLogin({ onDone }: { onDone: (name: string) => void }) {
  const { t } = useT();
  const [username, setUsername] = useState("ops.rina");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const r = await ops<{ access_token: string; operator: { full_name: string } }>("POST", "/api/admin/login", { username, password });
      sessionStorage.setItem(OPS_TOKEN, r.access_token);
      sessionStorage.setItem(OPS_NAME, r.operator.full_name);
      onDone(r.operator.full_name);
    } catch {
      setError(t("ops.loginError"));
    }
  };
  return (
    <form className="card stack narrow" onSubmit={submit}>
      <h1>{t("ops.loginTitle")}</h1>
      <label>{t("common.username")}<input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" required /></label>
      <label>{t("common.password")}<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required /></label>
      {error && <div className="alert">{error}</div>}
      <button className="primary" {...actionName("login.submit")}>{t("login.submit")}</button>
    </form>
  );
}

function Transfers({ onUnauthorized }: { onUnauthorized: () => void }) {
  const { t } = useT();
  const [status, setStatus] = useState("FAILED");
  const [rail, setRail] = useState("");
  const [items, setItems] = useState<Transfer[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    const q = new URLSearchParams({ ...(status ? { status } : {}), ...(rail ? { rail } : {}) });
    ops<Transfer[]>("GET", `/api/admin/transfers?${q}`).then(setItems).catch((e) => (e.status === 401 ? onUnauthorized() : setNotice(e.message)));
  }, [status, rail, onUnauthorized]);
  useEffect(load, [load]);

  const retry = async (tr: Transfer) => {
    setBusy(tr.id);
    setNotice(null);
    try {
      const r = await ops<Transfer>("POST", `/api/admin/transfers/${tr.id}/retry`);
      setNotice(t("ops.retried", { id: tr.id.slice(0, 8), status: r.status, reason: r.failure_reason ? ` (${r.failure_reason})` : "" }));
      rumAction("ops_transfer_retry", { rail: tr.rail, outcome: r.status });
    } catch (e) {
      setNotice(t("ops.retryFailed", { id: tr.id.slice(0, 8), message: (e as Error).message }));
      rumAction("ops_transfer_retry", { rail: tr.rail, outcome: "error" });
    } finally {
      setBusy(null);
      load();
    }
  };

  return (
    <div className="stack">
      <div className="row" style={{ justifyContent: "flex-start", alignItems: "end" }}>
        <h1 style={{ marginRight: "auto" }}>{t("ops.transfersTitle")}</h1>
        <label>{t("common.status")}<select value={status} onChange={(e) => setStatus(e.target.value)}><option value="">{t("ops.all")}</option><option>FAILED</option><option>PROCESSING</option><option>SUCCESS</option></select></label>
        <label>{t("ops.rail")}<select value={rail} onChange={(e) => setRail(e.target.value)}><option value="">{t("ops.all")}</option><option>BIFAST</option><option>SKN</option><option>INTRABANK</option></select></label>
        <button className="ghost" onClick={load} {...actionName("ops.reload")}>{t("ops.reload")}</button>
      </div>
      {notice && <div className="card small">{notice}</div>}
      <div className="card table-wrap">
        <table className="table">
          <thead><tr><th>{t("common.time")}</th><th>{t("ops.rail")}</th><th>{t("ops.from")}</th><th>{t("ops.to")}</th><th className="right">{t("common.amount")}</th><th>{t("common.status")}</th><th></th></tr></thead>
          <tbody>
            {items.map((tr) => (
              <tr key={tr.id}>
                <td className="nowrap small">{formatDateTime(tr.created_at)}</td>
                <td>{tr.rail}</td>
                <td className="mono small">{maskAccount(tr.source_account_number)}</td>
                <td className="small">{tr.destination_bank_name}<div className="muted">{tr.destination_account_name}</div></td>
                <td className="right nowrap">{formatMoney(tr.amount)}</td>
                <td><span className={`pill ${tr.status.toLowerCase()}`}>{tr.status}</span>{tr.failure_reason && <div className="small muted">{tr.failure_reason}</div>}</td>
                <td>{tr.status === "FAILED" && tr.failure_reason === "RAIL_UNAVAILABLE" && (
                  <button className="ghost" disabled={busy === tr.id} onClick={() => retry(tr)} {...actionName("ops.retry")}>{busy === tr.id ? t("ops.retrying") : t("ops.retry")}</button>
                )}</td>
              </tr>
            ))}
            {items.length === 0 && <tr><td colSpan={7} className="muted">{t("ops.noTransfers")}</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Customers() {
  const { t } = useT();
  const [q, setQ] = useState("");
  const [items, setItems] = useState<Customer[] | null>(null);
  const search = async (e: FormEvent) => {
    e.preventDefault();
    setItems(await ops<Customer[]>("GET", `/api/admin/customers?q=${encodeURIComponent(q)}`).catch(() => []));
  };
  return (
    <div className="stack">
      <h1>{t("ops.customersTitle")}</h1>
      <form className="row" style={{ justifyContent: "flex-start" }} onSubmit={search}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("ops.searchPlaceholder")} minLength={3} style={{ flex: 1 }} required />
        <button className="primary" {...actionName("ops.search")}>{t("ops.search")}</button>
      </form>
      {items && (
        <div className="card table-wrap">
          <table className="table">
            <thead><tr><th>CIF</th><th>{t("common.name")}</th><th>{t("ops.segment")}</th><th>{t("apply.email")}</th><th>{t("ops.phone")}</th></tr></thead>
            <tbody>
              {items.map((c) => <tr key={c.cif}><td className="mono">{c.cif}</td><td>{c.full_name}</td><td>{c.segment}</td><td className="small">{c.email}</td><td className="small">{c.phone}</td></tr>)}
              {items.length === 0 && <tr><td colSpan={5} className="muted">{t("ops.notFound")}</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Audit() {
  const { t } = useT();
  const [items, setItems] = useState<AuditEntry[]>([]);
  useEffect(() => {
    ops<AuditEntry[]>("GET", "/api/admin/audit-log?page_size=50").then(setItems).catch(() => setItems([]));
  }, []);
  return (
    <div className="stack">
      <h1>Audit Log</h1>
      <div className="card table-wrap">
        <table className="table">
          <thead><tr><th>{t("common.time")}</th><th>{t("ops.operator")}</th><th>{t("ops.action")}</th><th>{t("ops.target")}</th></tr></thead>
          <tbody>
            {items.map((a) => <tr key={a.id}><td className="nowrap small">{formatDateTime(a.created_at)}</td><td>{a.operator}</td><td>{a.action}</td><td className="small mono">{a.target}</td></tr>)}
          </tbody>
        </table>
      </div>
    </div>
  );
}
