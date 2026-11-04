import { useEffect, useState } from "react";
import { api, formatDateTime, formatMoney, type Transfer } from "../api";
import { useT, type MessageKey } from "../i18n";
import { railLabel } from "./TransferPage";

const STATUS: Record<Transfer["status"], MessageKey> = { SUCCESS: "status.success", PROCESSING: "status.processing", FAILED: "status.failed" };

export function TransferHistoryPage() {
  const { t } = useT();
  const [items, setItems] = useState<Transfer[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    api.get<{ items: Transfer[] }>("/api/transfers?page_size=50").then((r) => setItems(r.items)).finally(() => setLoaded(true));
  }, []);

  return (
    <div className="stack">
      <h1>{t("nav.transferHistory")}</h1>
      <section className="card">
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>{t("common.time")}</th><th>{t("common.recipient")}</th><th>{t("common.service")}</th><th className="right">{t("common.amount")}</th><th>{t("common.status")}</th></tr></thead>
            <tbody>
              {items.map((tr) => (
                <tr key={tr.id}>
                  <td className="nowrap">{formatDateTime(tr.created_at)}</td>
                  <td>{tr.destination_account_name}<div className="muted small">{tr.destination_bank_name} · {tr.destination_account_number}</div></td>
                  <td>{railLabel(t, tr.rail)}</td>
                  <td className="right nowrap">{formatMoney(tr.amount)}</td>
                  <td><span className={`pill ${tr.status.toLowerCase()}`}>{t(STATUS[tr.status])}</span></td>
                </tr>
              ))}
              {loaded && !items.length && <tr><td colSpan={5} className="muted">{t("tf.noTransfers")}</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
