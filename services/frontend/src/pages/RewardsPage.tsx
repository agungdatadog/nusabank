import { useEffect, useState } from "react";
import { api, formatDateTime, RequestError, type RewardItem, type RewardsBalance, type RewardsEntry } from "../api";
import { actionName, useT } from "../i18n";
import { rumAction } from "../rum";

const TIER_LABEL = { SILVER: "Silver", GOLD: "Gold", PLATINUM: "Platinum" } as const;
const points = (n: number) => n.toLocaleString("id-ID");

export function RewardsPage() {
  const { t } = useT();
  const [balance, setBalance] = useState<RewardsBalance | null>(null);
  const [catalog, setCatalog] = useState<RewardItem[]>([]);
  const [history, setHistory] = useState<RewardsEntry[]>([]);
  const [confirming, setConfirming] = useState<RewardItem | null>(null);
  const [redeemed, setRedeemed] = useState<RewardsEntry | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () => {
    api.get<RewardsBalance>("/api/rewards").then(setBalance).catch(() => setError(t("pts.loadError")));
    api.get<RewardsEntry[]>("/api/rewards/history?page_size=15").then(setHistory).catch(() => setHistory([]));
  };
  useEffect(() => {
    load();
    api.get<RewardItem[]>("/api/rewards/catalog").then(setCatalog);
  }, []);

  const redeem = async (item: RewardItem) => {
    setBusy(true);
    setError(null);
    try {
      const entry = await api.post<RewardsEntry>("/api/rewards/redemptions", { item_code: item.code }, { "Idempotency-Key": crypto.randomUUID() });
      setRedeemed(entry);
      setConfirming(null);
      rumAction("reward_redeemed", { item: item.code, points: item.points_cost });
      load();
    } catch (err) {
      setError(err instanceof RequestError ? err.body.message : t("common.networkError"));
    } finally {
      setBusy(false);
    }
  };

  const progress = balance?.next_tier && balance.points_to_next_tier !== undefined
    ? Math.min(100, Math.round(((balance.tier_points_90d ?? 0) / ((balance.tier_points_90d ?? 0) + balance.points_to_next_tier)) * 100))
    : 100;

  return (
    <div className="stack">
      <section className="hero card">
        <div className="stack" style={{ gap: "0.5rem", minWidth: "260px" }}>
          <p className="muted">Nusa Poin</p>
          <div className="total"><strong>{balance ? points(balance.points) : "…"}</strong> <span className="muted">{t("pts.unit")}</span></div>
          {balance && (
            <>
              <div><span className={`tier ${balance.tier.toLowerCase()}`}>{TIER_LABEL[balance.tier].toUpperCase()}</span></div>
              <div className="progress"><div style={{ width: `${progress}%` }} /></div>
              <p className="muted small">
                {balance.next_tier
                  ? t("pts.toNext", { n: points(balance.points_to_next_tier ?? 0), tier: TIER_LABEL[balance.next_tier] })
                  : t("pts.top")}
              </p>
            </>
          )}
        </div>
        <p className="muted small" style={{ maxWidth: "36ch" }}>
          {t("pts.info")}
        </p>
      </section>

      {error && <div className="alert">{error}</div>}
      {redeemed && (
        <div className="card stack center-text">
          <div className="status success">{t("pts.redeemed")}</div>
          <p>{redeemed.description}</p>
          {redeemed.voucher_code && <div className="token mono">{redeemed.voucher_code}</div>}
          <div className="row center"><button className="ghost" onClick={() => setRedeemed(null)} {...actionName("common.close")}>{t("common.close")}</button></div>
        </div>
      )}

      <div className="card">
        <h2 className="section-title">{t("pts.redeemTitle")}</h2>
        <div className="grid">
          {catalog.map((item) => {
            const affordable = (balance?.points ?? 0) >= item.points_cost;
            return (
              <div key={item.code} className="card stack" style={{ gap: "0.5rem" }}>
                <strong>{item.name}</strong>
                {item.description && <span className="small muted">{item.description}</span>}
                <span>{t("pts.cost", { n: points(item.points_cost) })}</span>
                {confirming?.code === item.code ? (
                  <div className="row">
                    <button className="ghost" onClick={() => setConfirming(null)} disabled={busy} {...actionName("common.cancel")}>{t("common.cancel")}</button>
                    <button className="primary" onClick={() => redeem(item)} disabled={busy} {...actionName("common.confirm")}>{busy ? t("common.processing") : t("common.confirm")}</button>
                  </div>
                ) : (
                  <button className="ghost" onClick={() => setConfirming(item)} disabled={!affordable} {...actionName("pts.redeem")}>{affordable ? t("pts.redeem") : t("pts.notEnough")}</button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="card">
        <h2 className="section-title">{t("pts.history")}</h2>
        {history.length === 0 ? (
          <p className="muted">{t("pts.noHistory")}</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <tbody>
                {history.map((e) => (
                  <tr key={e.id}>
                    <td className="nowrap small muted">{formatDateTime(e.created_at)}</td>
                    <td>{e.description}{e.voucher_code && <div className="small muted mono">{e.voucher_code}</div>}</td>
                    <td className={`right nowrap ${e.points > 0 ? "credit" : "debit"}`}>{e.points > 0 ? "+" : ""}{points(e.points)}</td>
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
