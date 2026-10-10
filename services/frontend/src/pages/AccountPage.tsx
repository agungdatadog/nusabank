import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, formatDateTime, formatMoney, maskAccount, RequestError, session, type Account, type Money, type Transaction } from "../api";
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
  const [account, setAccount] = useState<Account | null>(null);
  const [txns, setTxns] = useState<{ items: Transaction[]; total: number }>({ items: [], total: 0 });
  const [page, setPage] = useState(1);
  const [statements, setStatements] = useState<Statement[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.get<Account>(`/api/accounts/${accountNumber}`).then(setAccount).catch((e) => setError(e instanceof RequestError ? e.body.message : "Gagal memuat rekening"));
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
      setError("e-Statement belum dapat diunduh, silakan coba lagi");
    }
  };

  if (error && !account) return <div className="alert">{error}</div>;
  const pages = Math.max(1, Math.ceil(txns.total / PAGE_SIZE));

  return (
    <div className="stack">
      <Link to="/" className="muted small">← Kembali ke beranda</Link>
      {account && (
        <section className="card hero">
          <div>
            <p className="muted">{account.product_name} · {account.currency}</p>
            <h1 className="mono">{maskAccount(account.account_number)}</h1>
          </div>
          <div className="total">
            <p className="muted">Saldo tersedia</p>
            <strong>{formatMoney(account.available_balance)}</strong>
            <p className="muted small">Saldo buku {formatMoney(account.balance)}</p>
          </div>
        </section>
      )}
      {error && <div className="alert">{error}</div>}

      <section className="card">
        <h2 className="section-title">Mutasi Rekening</h2>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Tanggal</th><th>Keterangan</th><th className="right">Jumlah</th><th className="right">Saldo</th></tr></thead>
            <tbody>
              {txns.items.map((t) => (
                <tr key={t.id}>
                  <td className="nowrap">{formatDateTime(t.posted_at)}</td>
                  <td>{t.description}</td>
                  <td className={`right nowrap ${t.type === "CREDIT" ? "credit" : "debit"}`}>{t.type === "CREDIT" ? "+" : "−"}{formatMoney(t.amount)}</td>
                  <td className="right nowrap">{formatMoney(t.balance_after)}</td>
                </tr>
              ))}
              {!txns.items.length && <tr><td colSpan={4} className="muted">Belum ada transaksi pada periode ini</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="pager">
          <button className="ghost" disabled={page <= 1} onClick={() => setPage(page - 1)}>Sebelumnya</button>
          <span className="muted small">Halaman {page} dari {pages}</span>
          <button className="ghost" disabled={page >= pages} onClick={() => setPage(page + 1)}>Berikutnya</button>
        </div>
      </section>

      <section className="card">
        <h2 className="section-title">e-Statement</h2>
        <table className="table">
          <thead><tr><th>Periode</th><th className="right">Saldo awal</th><th className="right">Saldo akhir</th><th>Transaksi</th><th /></tr></thead>
          <tbody>
            {statements.map((s) => (
              <tr key={s.period}>
                <td>{s.period}</td>
                <td className="right">{formatMoney(s.opening_balance)}</td>
                <td className="right">{formatMoney(s.closing_balance)}</td>
                <td>{s.transaction_count}</td>
                <td className="right"><button className="link" onClick={() => download(s.period)}>Unduh PDF</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
