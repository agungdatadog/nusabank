import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, formatMoney, maskAccount, type Account, type Money } from "../api";
import { useAuth } from "../auth";
import { actionName, useT } from "../i18n";

const GROUPS = ["SAVINGS", "CURRENT", "TIME_DEPOSIT", "CREDIT_CARD"] as const;

interface Promotion {
  code: string;
  title: string;
}

export function DashboardPage() {
  const { customer } = useAuth();
  const { t } = useT();
  const [data, setData] = useState<{ accounts: Account[]; total_balance_idr: Money } | null>(null);
  const [rates, setRates] = useState<{ currency: string; buy: string; sell: string }[]>([]);
  const [promos, setPromos] = useState<Promotion[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.get<{ accounts: Account[]; total_balance_idr: Money }>("/api/accounts").then(setData).catch(() => setError("dash.loadError"));
    api.get<{ rates: { currency: string; buy: string; sell: string }[] }>("/api/fx/rates").then((r) => setRates(r.rates)).catch(() => setRates([]));
    api.get<Promotion[]>("/api/promotions").then(setPromos).catch(() => setPromos([]));
  }, []);

  const hour = Number(new Intl.DateTimeFormat("id-ID", { hour: "numeric", hourCycle: "h23", timeZone: "Asia/Jakarta" }).format(new Date()));
  const greeting = t(hour < 11 ? "dash.greetMorning" : hour < 15 ? "dash.greetNoon" : hour < 18 ? "dash.greetAfternoon" : "dash.greetEvening");

  return (
    <div className="stack">
      <section className="hero card">
        <div>
          <p className="muted">{greeting},</p>
          <h1>{customer?.full_name}</h1>
        </div>
        <div className="total">
          <p className="muted">{t("dash.totalBalance")}</p>
          <strong>{data ? formatMoney(data.total_balance_idr) : "—"}</strong>
        </div>
        <div className="quick">
          <Link className="primary button" to="/transfer" {...actionName("nav.transfer")}>{t("nav.transfer")}</Link>
          <Link className="ghost button" to="/bayar" {...actionName("nav.bills")}>{t("nav.bills")}</Link>
          <Link className="ghost button" to="/transfer/riwayat" {...actionName("dash.history")}>{t("dash.history")}</Link>
        </div>
      </section>

      {error && <div className="alert">{t("dash.loadError")}</div>}

      {GROUPS.map((type) => {
        const items = data?.accounts.filter((a) => a.product_type === type) ?? [];
        if (!items.length) return null;
        return (
          <section key={type}>
            <h2 className="section-title">{t(`dash.${type}`)}</h2>
            <div className="grid">
              {items.map((a) => (
                <Link key={a.account_number} to={`/rekening/${a.account_number}`} className="card product">
                  <span className="muted small">{a.product_name}</span>
                  <span className="mono">{maskAccount(a.account_number)}</span>
                  <strong>{formatMoney(a.product_type === "CREDIT_CARD" ? a.balance : a.available_balance)}</strong>
                  <span className="muted small">
                    {a.product_type === "CREDIT_CARD"
                      ? t("dash.cardBill", { limit: a.credit_limit ? formatMoney(a.credit_limit) : "-" })
                      : a.product_type === "TIME_DEPOSIT"
                        ? t("dash.maturity", { date: a.maturity_date ?? "", rate: a.interest_rate ?? "" })
                        : t("dash.available")}
                  </span>
                </Link>
              ))}
            </div>
          </section>
        );
      })}

      <div className="grid two">
        <section className="card">
          <h2 className="section-title">{t("dash.fxTitle")}</h2>
          <table className="table">
            <thead><tr><th>{t("dash.currency")}</th><th>{t("dash.buy")}</th><th>{t("dash.sell")}</th></tr></thead>
            <tbody>
              {rates.map((r) => (
                <tr key={r.currency}><td>{r.currency}</td><td>{Number(r.buy).toLocaleString("id-ID")}</td><td>{Number(r.sell).toLocaleString("id-ID")}</td></tr>
              ))}
              {!rates.length && <tr><td colSpan={3} className="muted">{t("dash.fxUnavailable")}</td></tr>}
            </tbody>
          </table>
        </section>
        <section className="card">
          <h2 className="section-title">{t("dash.promos")}</h2>
          <ul className="promos">
            {promos.map((p) => <li key={p.code}>{p.title}</li>)}
          </ul>
        </section>
      </div>
    </div>
  );
}
