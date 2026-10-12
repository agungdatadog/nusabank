import { useCallback, useEffect, useState, type FormEvent } from "react";
import { formatDateTime, formatMoney, maskAccount, type Customer, type Transfer } from "../api";
import { Logo } from "../components/Layout";
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
  if (!res.ok) throw Object.assign(new Error(data.message ?? "Permintaan gagal"), { status: res.status, body: data });
  return data as T;
}

export function OpsPage() {
  const [name, setName] = useState(sessionStorage.getItem(OPS_NAME));
  const [signedIn, setSignedIn] = useState(!!sessionStorage.getItem(OPS_TOKEN));
  const [tab, setTab] = useState<Tab>("transfers");

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
              <button className={`link ops-tab ${tab === "transfers" ? "active" : ""}`} onClick={() => setTab("transfers")}>Transfer</button>
              <button className={`link ops-tab ${tab === "customers" ? "active" : ""}`} onClick={() => setTab("customers")}>Nasabah</button>
              <button className={`link ops-tab ${tab === "audit" ? "active" : ""}`} onClick={() => setTab("audit")}>Audit Log</button>
            </>
          )}
        </nav>
        <div className="user">
          <span className="badge">Back Office</span>
          {signedIn && <><span>{name}</span><button className="link" onClick={logout}>Keluar</button></>}
        </div>
      </header>
      <main className="content">
        {!signedIn ? (
          <OpsLogin onDone={(n) => { setName(n); setSignedIn(true); }} />
        ) : tab === "transfers" ? <Transfers onUnauthorized={logout} /> : tab === "customers" ? <Customers /> : <Audit />}
      </main>
      <footer className="footer">Konsol internal Nusa Bank (fiktif). Setiap tindakan operator tercatat di audit log.</footer>
    </div>
  );
}

function OpsLogin({ onDone }: { onDone: (name: string) => void }) {
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
      setError("Username atau kata sandi salah");
    }
  };
  return (
    <form className="card stack narrow" onSubmit={submit}>
      <h1>Masuk Back Office</h1>
      <label>Username<input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" required /></label>
      <label>Kata sandi<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required /></label>
      {error && <div className="alert">{error}</div>}
      <button className="primary">Masuk</button>
    </form>
  );
}

function Transfers({ onUnauthorized }: { onUnauthorized: () => void }) {
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

  const retry = async (t: Transfer) => {
    setBusy(t.id);
    setNotice(null);
    try {
      const r = await ops<Transfer>("POST", `/api/admin/transfers/${t.id}/retry`);
      setNotice(`Transfer ${t.id.slice(0, 8)} diulang: ${r.status}${r.failure_reason ? ` (${r.failure_reason})` : ""}`);
      rumAction("ops_transfer_retry", { rail: t.rail, outcome: r.status });
    } catch (e) {
      setNotice(`Gagal mengulang ${t.id.slice(0, 8)}: ${(e as Error).message}`);
      rumAction("ops_transfer_retry", { rail: t.rail, outcome: "error" });
    } finally {
      setBusy(null);
      load();
    }
  };

  return (
    <div className="stack">
      <div className="row" style={{ justifyContent: "flex-start", alignItems: "end" }}>
        <h1 style={{ marginRight: "auto" }}>Transfer 24 Jam Terakhir</h1>
        <label>Status<select value={status} onChange={(e) => setStatus(e.target.value)}><option value="">Semua</option><option>FAILED</option><option>PROCESSING</option><option>SUCCESS</option></select></label>
        <label>Rail<select value={rail} onChange={(e) => setRail(e.target.value)}><option value="">Semua</option><option>BIFAST</option><option>SKN</option><option>INTRABANK</option></select></label>
        <button className="ghost" onClick={load}>Muat ulang</button>
      </div>
      {notice && <div className="card small">{notice}</div>}
      <div className="card table-wrap">
        <table className="table">
          <thead><tr><th>Waktu</th><th>Rail</th><th>Dari</th><th>Tujuan</th><th className="right">Nominal</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {items.map((t) => (
              <tr key={t.id}>
                <td className="nowrap small">{formatDateTime(t.created_at)}</td>
                <td>{t.rail}</td>
                <td className="mono small">{maskAccount(t.source_account_number)}</td>
                <td className="small">{t.destination_bank_name}<div className="muted">{t.destination_account_name}</div></td>
                <td className="right nowrap">{formatMoney(t.amount)}</td>
                <td><span className={`pill ${t.status.toLowerCase()}`}>{t.status}</span>{t.failure_reason && <div className="small muted">{t.failure_reason}</div>}</td>
                <td>{t.status === "FAILED" && t.failure_reason === "RAIL_UNAVAILABLE" && (
                  <button className="ghost" disabled={busy === t.id} onClick={() => retry(t)}>{busy === t.id ? "Mengulang…" : "Ulangi"}</button>
                )}</td>
              </tr>
            ))}
            {items.length === 0 && <tr><td colSpan={7} className="muted">Tidak ada transfer untuk filter ini.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Customers() {
  const [q, setQ] = useState("");
  const [items, setItems] = useState<Customer[] | null>(null);
  const search = async (e: FormEvent) => {
    e.preventDefault();
    setItems(await ops<Customer[]>("GET", `/api/admin/customers?q=${encodeURIComponent(q)}`).catch(() => []));
  };
  return (
    <div className="stack">
      <h1>Cari Nasabah</h1>
      <form className="row" style={{ justifyContent: "flex-start" }} onSubmit={search}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nama, email, CIF, atau nomor rekening" minLength={3} style={{ flex: 1 }} required />
        <button className="primary">Cari</button>
      </form>
      {items && (
        <div className="card table-wrap">
          <table className="table">
            <thead><tr><th>CIF</th><th>Nama</th><th>Segmen</th><th>Email</th><th>Telepon</th></tr></thead>
            <tbody>
              {items.map((c) => <tr key={c.cif}><td className="mono">{c.cif}</td><td>{c.full_name}</td><td>{c.segment}</td><td className="small">{c.email}</td><td className="small">{c.phone}</td></tr>)}
              {items.length === 0 && <tr><td colSpan={5} className="muted">Tidak ditemukan.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Audit() {
  const [items, setItems] = useState<AuditEntry[]>([]);
  useEffect(() => {
    ops<AuditEntry[]>("GET", "/api/admin/audit-log?page_size=50").then(setItems).catch(() => setItems([]));
  }, []);
  return (
    <div className="stack">
      <h1>Audit Log</h1>
      <div className="card table-wrap">
        <table className="table">
          <thead><tr><th>Waktu</th><th>Operator</th><th>Tindakan</th><th>Target</th></tr></thead>
          <tbody>
            {items.map((a) => <tr key={a.id}><td className="nowrap small">{formatDateTime(a.created_at)}</td><td>{a.operator}</td><td>{a.action}</td><td className="small mono">{a.target}</td></tr>)}
          </tbody>
        </table>
      </div>
    </div>
  );
}
