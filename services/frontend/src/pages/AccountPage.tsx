import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, formatDateTime, formatMoney, maskAccount, RequestError, session, type Account, type Money, type Transaction } from "../api";
import { actionName, useT, type MessageKey } from "../i18n";
import { rumAction, rumError } from "../rum";

interface Statement {
  period: string;
  opening_balance: Money;
  closing_balance: Money;
  transaction_count: number;
}

const PAGE_SIZE = 15;

export function AccountPage() {
  const { accountNumber = "" } = useParams();
  const { t } = useT();
  const [account, setAccount] = useState<Account | null>(null);
  const [txns, setTxns] = useState<{ items: Transaction[]; total: number }>({ items: [], total: 0 });
  const [page, setPage] = useState(1);
  const [statements, setStatements] = useState<Statement[]>([]);
  // Either a message key (shown translated) or the API's own message.
  const [error, setError] = useState<{ key?: MessageKey; text?: string } | null>(null);

  useEffect(() => {
    api.get<Account>(`/api/accounts/${accountNumber}`).then(setAccount).catch((e) => setError(e instanceof RequestError ? { text: e.body.message } : { key: "acct.loadError" }));
    api.get<Statement[]>(`/api/accounts/${accountNumber}/statements`).then(setStatements).catch(() => setStatements([]));
  }, [accountNumber]);

  useEffect(() => {
    api.get<{ items: Transaction[]; total: number }>(`/api/accounts/${accountNumber}/transactions?page=${page}&page_size=${PAGE_SIZE}`)
      .then(setTxns)
      .catch(() => setTxns({ items: [], total: 0 }));
  }, [accountNumber, page]);

  // PDF needs the bearer token, so it's fetched and handed to the browser as a blob.
  const download = async (period: string) => {
    rumAction("estatement_download", { period, product: account?.product_type });
    try {
      const res = await fetch(`/api/accounts/${accountNumber}/statements/${period}`, { headers: { Authorization: `Bearer ${session.token}` } });
      if (!res.ok) throw new Error(`e-Statement ${period} returned ${res.status}`);
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = `eStatement-${accountNumber}-${period}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      rumError(e, { period });
      setError({ key: "acct.statementError" });
    }
  };

  const errorText = error && (error.key ? t(error.key) : error.text);
  if (error && !account) return <div className="alert">{errorText}</div>;
  const pages = Math.max(1, Math.ceil(txns.total / PAGE_SIZE));

  return (
    <div className="stack">
      <Link to="/" className="muted small" {...actionName("acct.back")}>{t("acct.back")}</Link>
      {account && (
        <section className="card hero">
          <div>
            <p className="muted">{account.product_name} · {account.currency}</p>
            <h1 className="mono">{maskAccount(account.account_number)}</h1>
          </div>
          <div className="total">
            <p className="muted">{t("dash.available")}</p>
            <strong>{formatMoney(account.available_balance)}</strong>
            <p className="muted small">{t("acct.ledger", { amount: formatMoney(account.balance) })}</p>
          </div>
        </section>
      )}
      {error && <div className="alert">{errorText}</div>}

      <section className="card">
        <h2 className="section-title">{t("acct.mutations")}</h2>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>{t("common.date")}</th><th>{t("acct.description")}</th><th className="right">{t("acct.txAmount")}</th><th className="right">{t("acct.balance")}</th></tr></thead>
            <tbody>
              {txns.items.map((tx) => (
                <tr key={tx.id}>
                  <td className="nowrap">{formatDateTime(tx.posted_at)}</td>
                  <td>{tx.description}</td>
                  <td className={`right nowrap ${tx.type === "CREDIT" ? "credit" : "debit"}`}>{tx.type === "CREDIT" ? "+" : "−"}{formatMoney(tx.amount)}</td>
                  <td className="right nowrap">{formatMoney(tx.balance_after)}</td>
                </tr>
              ))}
              {!txns.items.length && <tr><td colSpan={4} className="muted">{t("acct.noTx")}</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="pager">
          <button className="ghost" disabled={page <= 1} onClick={() => setPage(page - 1)} {...actionName("acct.prev")}>{t("acct.prev")}</button>
          <span className="muted small">{t("acct.page", { page, pages })}</span>
          <button className="ghost" disabled={page >= pages} onClick={() => setPage(page + 1)} {...actionName("acct.next")}>{t("acct.next")}</button>
        </div>
      </section>

      <section className="card">
        <h2 className="section-title">e-Statement</h2>
        <table className="table">
          <thead><tr><th>{t("common.period")}</th><th className="right">{t("acct.opening")}</th><th className="right">{t("acct.closing")}</th><th>{t("acct.txCount")}</th><th /></tr></thead>
          <tbody>
            {statements.map((s) => (
              <tr key={s.period}>
                <td>{s.period}</td>
                <td className="right">{formatMoney(s.opening_balance)}</td>
                <td className="right">{formatMoney(s.closing_balance)}</td>
                <td>{s.transaction_count}</td>
                <td className="right"><button className="link" onClick={() => download(s.period)} {...actionName("acct.download")}>{t("acct.download")}</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
