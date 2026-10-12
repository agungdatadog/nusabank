import { useEffect, useState } from "react";
import { api, formatDateTime, RequestError, type RewardItem, type RewardsBalance, type RewardsEntry } from "../api";
import { rumAction } from "../rum";

const TIER_LABEL = { SILVER: "Silver", GOLD: "Gold", PLATINUM: "Platinum" } as const;
const points = (n: number) => n.toLocaleString("id-ID");

export function RewardsPage() {
  const [balance, setBalance] = useState<RewardsBalance | null>(null);
  const [catalog, setCatalog] = useState<RewardItem[]>([]);
  const [history, setHistory] = useState<RewardsEntry[]>([]);
  const [confirming, setConfirming] = useState<RewardItem | null>(null);
  const [redeemed, setRedeemed] = useState<RewardsEntry | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () => {
    api.get<RewardsBalance>("/api/rewards").then(setBalance).catch(() => setError("Poin belum dapat dimuat"));
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
      setError(err instanceof RequestError ? err.body.message : "Tidak dapat terhubung, silakan coba lagi");
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
          <div className="total"><strong>{balance ? points(balance.points) : "…"}</strong> <span className="muted">poin</span></div>
          {balance && (
            <>
              <div><span className={`tier ${balance.tier.toLowerCase()}`}>{TIER_LABEL[balance.tier].toUpperCase()}</span></div>
              <div className="progress"><div style={{ width: `${progress}%` }} /></div>
              <p className="muted small">
                {balance.next_tier
                  ? `${points(balance.points_to_next_tier ?? 0)} poin lagi dalam 90 hari untuk naik ke ${TIER_LABEL[balance.next_tier]}`
                  : "Tingkat tertinggi — terima kasih telah menjadi nasabah setia"}
              </p>
            </>
          )}
        </div>
        <p className="muted small" style={{ maxWidth: "36ch" }}>
          Dapatkan poin dari transfer antarbank, top up e-wallet, pulsa dan pembayaran tagihan. Nasabah Prioritas mendapat 1,5× poin, Private 2×.
        </p>
      </section>

      {error && <div className="alert">{error}</div>}
      {redeemed && (
        <div className="card stack center-text">
          <div className="status success">Penukaran Berhasil</div>
          <p>{redeemed.description}</p>
          {redeemed.voucher_code && <div className="token mono">{redeemed.voucher_code}</div>}
          <div className="row center"><button className="ghost" onClick={() => setRedeemed(null)}>Tutup</button></div>
        </div>
      )}

      <div className="card">
        <h2 className="section-title">Tukar Poin</h2>
        <div className="grid">
          {catalog.map((item) => {
            const affordable = (balance?.points ?? 0) >= item.points_cost;
            return (
              <div key={item.code} className="card stack" style={{ gap: "0.5rem" }}>
                <strong>{item.name}</strong>
                {item.description && <span className="small muted">{item.description}</span>}
                <span>{points(item.points_cost)} poin</span>
                {confirming?.code === item.code ? (
                  <div className="row">
                    <button className="ghost" onClick={() => setConfirming(null)} disabled={busy}>Batal</button>
                    <button className="primary" onClick={() => redeem(item)} disabled={busy}>{busy ? "Memproses…" : "Konfirmasi"}</button>
                  </div>
                ) : (
                  <button className="ghost" onClick={() => setConfirming(item)} disabled={!affordable}>{affordable ? "Tukar" : "Poin belum cukup"}</button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="card">
        <h2 className="section-title">Riwayat Poin</h2>
        {history.length === 0 ? (
          <p className="muted">Belum ada riwayat poin.</p>
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
