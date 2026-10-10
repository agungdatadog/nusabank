import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { api, formatDateTime, formatMoney, maskAccount, RequestError, type Account, type Bank, type Inquiry, type Transfer } from "../api";
import { rumAction } from "../rum";

const RAILS = [
  { code: "INTRABANK", label: "Sesama Nusa Bank", hint: "Real-time, gratis" },
  { code: "BIFAST", label: "BI FAST", hint: "Real-time ke bank lain, maks. Rp250 juta" },
  { code: "SKN", label: "SKN", hint: "Kliring terjadwal, maks. Rp1 miliar" },
] as const;

type Step = "form" | "confirm" | "result";

export function TransferPage() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [banks, setBanks] = useState<Bank[]>([]);
  const [rail, setRail] = useState<(typeof RAILS)[number]["code"]>("BIFAST");
  const [source, setSource] = useState("");
  const [bankCode, setBankCode] = useState("014");
  const [destination, setDestination] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [step, setStep] = useState<Step>("form");
  const [inquiry, setInquiry] = useState<Inquiry | null>(null);
  const [result, setResult] = useState<Transfer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get<{ accounts: Account[] }>("/api/accounts").then((r) => {
      const eligible = r.accounts.filter((a) => (a.product_type === "SAVINGS" || a.product_type === "CURRENT") && a.currency === "IDR");
      setAccounts(eligible);
      if (eligible[0]) setSource(eligible[0].account_number);
    });
    api.get<Bank[]>("/api/transfers/banks").then(setBanks);
  }, []);

  const railBanks = useMemo(() => banks.filter((b) => b.rails.includes(rail)), [banks, rail]);
  useEffect(() => {
    if (railBanks.length && !railBanks.some((b) => b.code === bankCode)) setBankCode(railBanks[0].code);
  }, [railBanks, bankCode]);

  const fail = (e: unknown) => {
    if (e instanceof RequestError) {
      setError(e.body.partner ? `${e.body.message} (kode: ${e.body.code})` : e.body.message);
    } else {
      setError("Tidak dapat terhubung, silakan coba lagi");
    }
  };

  const doInquiry = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const inq = await api.post<Inquiry>("/api/transfers/inquiry", {
        rail,
        source_account_number: source,
        destination_bank_code: rail === "INTRABANK" ? "899" : bankCode,
        destination_account_number: destination.replace(/\s/g, ""),
        amount: { amount: amount.replace(/\D/g, ""), currency: "IDR" },
      });
      setInquiry(inq);
      setStep("confirm");
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    if (!inquiry) return;
    setBusy(true);
    setError(null);
    try {
      const t = await api.post<Transfer>("/api/transfers", { inquiry_id: inquiry.inquiry_id, ...(note ? { note } : {}) }, { "Idempotency-Key": crypto.randomUUID() });
      setResult(t);
      setStep("result");
      rumAction("transfer_submitted", { rail: t.rail, status: t.status, amount: Number(t.amount.amount), destination_bank: t.destination_bank_name });
    } catch (err) {
      fail(err);
      rumAction("transfer_failed", { rail, code: err instanceof RequestError ? err.body.code : "NETWORK", partner: err instanceof RequestError ? err.body.partner : undefined });
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    setStep("form");
    setInquiry(null);
    setResult(null);
    setDestination("");
    setAmount("");
    setNote("");
  };

  return (
    <div className="stack narrow">
      <h1>Transfer</h1>
      {step === "form" && (
        <form className="card stack" onSubmit={doInquiry}>
          <div className="segmented">
            {RAILS.map((r) => (
              <button type="button" key={r.code} className={rail === r.code ? "active" : ""} onClick={() => setRail(r.code)}>
                <strong>{r.label}</strong>
                <span className="small muted">{r.hint}</span>
              </button>
            ))}
          </div>
          <label>
            Dari rekening
            <select value={source} onChange={(e) => setSource(e.target.value)} required>
              {accounts.map((a) => (
                <option key={a.account_number} value={a.account_number}>
                  {a.product_name} · {maskAccount(a.account_number)} · {formatMoney(a.available_balance)}
                </option>
              ))}
            </select>
          </label>
          {rail !== "INTRABANK" && (
            <label>
              Bank tujuan
              <select value={bankCode} onChange={(e) => setBankCode(e.target.value)}>
                {railBanks.map((b) => <option key={b.code} value={b.code}>{b.name}</option>)}
              </select>
            </label>
          )}
          <label>
            Nomor rekening tujuan
            <input value={destination} onChange={(e) => setDestination(e.target.value)} inputMode="numeric" required />
          </label>
          <label>
            Nominal (Rp)
            <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="numeric" placeholder="1.500.000" required />
          </label>
          <label>
            Berita (opsional)
            <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={50} />
          </label>
          {error && <div className="alert">{error}</div>}
          <button className="primary" disabled={busy || !source}>{busy ? "Memeriksa rekening tujuan…" : "Lanjutkan"}</button>
        </form>
      )}

      {step === "confirm" && inquiry && (
        <div className="card stack">
          <h2 className="section-title">Konfirmasi Transfer</h2>
          <dl className="summary">
            <dt>Penerima</dt><dd><strong>{inquiry.destination_account_name}</strong></dd>
            <dt>Bank</dt><dd>{inquiry.destination_bank_name}</dd>
            <dt>Rekening</dt><dd className="mono">{inquiry.destination_account_number}</dd>
            <dt>Layanan</dt><dd>{RAILS.find((r) => r.code === inquiry.rail)?.label}</dd>
            <dt>Nominal</dt><dd>{formatMoney(inquiry.amount)}</dd>
            <dt>Biaya</dt><dd>{formatMoney(inquiry.fee)}</dd>
            <dt>Total</dt><dd><strong>{formatMoney({ amount: String(Number(inquiry.amount.amount) + Number(inquiry.fee.amount)), currency: "IDR" })}</strong></dd>
            {inquiry.expected_settlement_at && <><dt>Estimasi diterima</dt><dd>{formatDateTime(inquiry.expected_settlement_at)} WIB</dd></>}
          </dl>
          {error && <div className="alert">{error}</div>}
          <div className="row">
            <button className="ghost" onClick={() => setStep("form")} disabled={busy}>Ubah</button>
            <button className="primary" onClick={confirm} disabled={busy}>{busy ? "Mengirim…" : "Kirim Sekarang"}</button>
          </div>
        </div>
      )}

      {step === "result" && result && (
        <div className="card stack center-text">
          <div className={`status ${result.status.toLowerCase()}`}>
            {result.status === "SUCCESS" ? "Transfer Berhasil" : result.status === "PROCESSING" ? "Transfer Sedang Diproses" : "Transfer Gagal"}
          </div>
          <p>{formatMoney(result.amount)} ke <strong>{result.destination_account_name}</strong> · {result.destination_bank_name}</p>
          {result.status === "PROCESSING" && <p className="muted">Dana akan diterima pada jendela kliring SKN berikutnya ({result.skn_window_id}).</p>}
          {result.failure_reason && <p className="muted">Alasan: {result.failure_reason}</p>}
          {result.rail_reference && <p className="muted small mono">Ref: {result.rail_reference}</p>}
          <div className="row center">
            <button className="ghost" onClick={reset}>Transfer lagi</button>
            <Link className="primary button" to="/transfer/riwayat">Lihat riwayat</Link>
          </div>
        </div>
      )}
    </div>
  );
}
