import { useEffect, useState } from "react";
import { api, formatDateTime, formatMoney, type Transfer } from "../api";

const STATUS: Record<Transfer["status"], string> = { SUCCESS: "Berhasil", PROCESSING: "Diproses", FAILED: "Gagal" };
const RAIL: Record<string, string> = { INTRABANK: "Sesama Nusa Bank", BIFAST: "BI FAST", SKN: "SKN" };

export function TransferHistoryPage() {
  const [items, setItems] = useState<Transfer[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    api.get<{ items: Transfer[] }>("/api/transfers?page_size=50").then((r) => setItems(r.items)).finally(() => setLoaded(true));
  }, []);

  return (
    <div className="stack">
      <h1>Riwayat Transfer</h1>
      <section className="card">
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Waktu</th><th>Penerima</th><th>Layanan</th><th className="right">Nominal</th><th>Status</th></tr></thead>
            <tbody>
              {items.map((t) => (
                <tr key={t.id}>
                  <td className="nowrap">{formatDateTime(t.created_at)}</td>
                  <td>{t.destination_account_name}<div className="muted small">{t.destination_bank_name} · {t.destination_account_number}</div></td>
                  <td>{RAIL[t.rail] ?? t.rail}</td>
                  <td className="right nowrap">{formatMoney(t.amount)}</td>
                  <td><span className={`pill ${t.status.toLowerCase()}`}>{STATUS[t.status]}</span></td>
                </tr>
              ))}
              {loaded && !items.length && <tr><td colSpan={5} className="muted">Belum ada transfer</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
