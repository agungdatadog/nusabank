import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, formatMoney, maskAccount, type Account, type Money } from "../api";
import { useAuth } from "../auth";

const GROUPS: [string, string][] = [
  ["SAVINGS", "Tabungan"],
  ["CURRENT", "Giro"],
  ["TIME_DEPOSIT", "Deposito"],
  ["CREDIT_CARD", "Kartu Kredit"],
];

interface Promotion {
  code: string;
  title: string;
}

export function DashboardPage() {
  const { customer } = useAuth();
  const [data, setData] = useState<{ accounts: Account[]; total_balance_idr: Money } | null>(null);
  const [rates, setRates] = useState<{ currency: string; buy: string; sell: string }[]>([]);
  const [promos, setPromos] = useState<Promotion[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.get<{ accounts: Account[]; total_balance_idr: Money }>("/api/accounts").then(setData).catch(() => setError("Data rekening belum dapat dimuat"));
    api.get<{ rates: { currency: string; buy: string; sell: string }[] }>("/api/fx/rates").then((r) => setRates(r.rates)).catch(() => setRates([]));
    api.get<Promotion[]>("/api/promotions").then(setPromos).catch(() => setPromos([]));
  }, []);

  const hour = Number(new Intl.DateTimeFormat("id-ID", { hour: "numeric", hourCycle: "h23", timeZone: "Asia/Jakarta" }).format(new Date()));
  const greeting = hour < 11 ? "Selamat pagi" : hour < 15 ? "Selamat siang" : hour < 18 ? "Selamat sore" : "Selamat malam";

  return (
    <div className="stack">
      <section className="hero card">
        <div>
          <p className="muted">{greeting},</p>
          <h1>{customer?.full_name}</h1>
        </div>
        <div className="total">
          <p className="muted">Total saldo (dalam IDR)</p>
          <strong>{data ? formatMoney(data.total_balance_idr) : "—"}</strong>
        </div>
        <div className="quick">
          <Link className="primary button" to="/transfer">Transfer</Link>
          <Link className="ghost button" to="/bayar">Top Up &amp; Tagihan</Link>
          <Link className="ghost button" to="/transfer/riwayat">Riwayat</Link>
        </div>
      </section>

      {error && <div className="alert">{error}</div>}

      {GROUPS.map(([type, label]) => {
        const items = data?.accounts.filter((a) => a.product_type === type) ?? [];
        if (!items.length) return null;
        return (
          <section key={type}>
            <h2 className="section-title">{label}</h2>
            <div className="grid">
              {items.map((a) => (
                <Link key={a.account_number} to={`/rekening/${a.account_number}`} className="card product">
                  <span className="muted small">{a.product_name}</span>
                  <span className="mono">{maskAccount(a.account_number)}</span>
                  <strong>{formatMoney(a.product_type === "CREDIT_CARD" ? a.balance : a.available_balance)}</strong>
                  <span className="muted small">
                    {a.product_type === "CREDIT_CARD"
                      ? `Tagihan berjalan · limit ${a.credit_limit ? formatMoney(a.credit_limit) : "-"}`
                      : a.product_type === "TIME_DEPOSIT"
                        ? `Jatuh tempo ${a.maturity_date} · ${a.interest_rate}% p.a.`
                        : "Saldo tersedia"}
                  </span>
                </Link>
              ))}
            </div>
          </section>
        );
      })}

      <div className="grid two">
        <section className="card">
          <h2 className="section-title">Kurs Valas (IDR)</h2>
          <table className="table">
            <thead><tr><th>Mata uang</th><th>Beli</th><th>Jual</th></tr></thead>
            <tbody>
              {rates.map((r) => (
                <tr key={r.currency}><td>{r.currency}</td><td>{Number(r.buy).toLocaleString("id-ID")}</td><td>{Number(r.sell).toLocaleString("id-ID")}</td></tr>
              ))}
              {!rates.length && <tr><td colSpan={3} className="muted">Kurs sedang tidak tersedia</td></tr>}
            </tbody>
          </table>
        </section>
        <section className="card">
          <h2 className="section-title">Promo untuk Anda</h2>
          <ul className="promos">
            {promos.map((p) => <li key={p.code}>{p.title}</li>)}
          </ul>
        </section>
      </div>
    </div>
  );
}
