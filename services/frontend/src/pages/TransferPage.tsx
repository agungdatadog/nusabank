import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { api, formatDateTime, formatMoney, maskAccount, RequestError, type Account, type Bank, type Inquiry, type Transfer } from "../api";
import { actionName, useT, type MessageKey } from "../i18n";
import { rumAction } from "../rum";

const RAILS = ["INTRABANK", "BIFAST", "SKN"] as const;

// BI FAST and SKN are scheme names and read the same in both languages.
export const railLabel = (t: (k: MessageKey) => string, rail: string) => (rail === "INTRABANK" ? t("tf.rail.INTRABANK") : rail === "BIFAST" ? "BI FAST" : rail);

type Step = "form" | "confirm" | "result";

export function TransferPage() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [banks, setBanks] = useState<Bank[]>([]);
  const { t } = useT();
  const [rail, setRail] = useState<(typeof RAILS)[number]>("BIFAST");
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
      setError(e.body.partner ? `${e.body.message} ${t("common.partnerCode", { code: e.body.code })}` : e.body.message);
    } else {
      setError(t("common.networkError"));
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
      const tr = await api.post<Transfer>("/api/transfers", { inquiry_id: inquiry.inquiry_id, ...(note ? { note } : {}) }, { "Idempotency-Key": crypto.randomUUID() });
      setResult(tr);
      setStep("result");
      rumAction("transfer_submitted", { rail: tr.rail, status: tr.status, amount: Number(tr.amount.amount), destination_bank: tr.destination_bank_name });
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
              <button type="button" key={r} className={rail === r ? "active" : ""} onClick={() => setRail(r)} data-dd-action-name={r === "INTRABANK" ? "Sesama Nusa Bank" : railLabel(t, r)}>
                <strong>{railLabel(t, r)}</strong>
                <span className="small muted">{t(`tf.hint.${r}`)}</span>
              </button>
            ))}
          </div>
          <label>
            {t("common.fromAccount")}
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
              {t("tf.destBank")}
              <select value={bankCode} onChange={(e) => setBankCode(e.target.value)}>
                {railBanks.map((b) => <option key={b.code} value={b.code}>{b.name}</option>)}
              </select>
            </label>
          )}
          <label>
            {t("tf.destAccount")}
            <input value={destination} onChange={(e) => setDestination(e.target.value)} inputMode="numeric" required />
          </label>
          <label>
            {t("tf.amountRp")}
            <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="numeric" placeholder="1.500.000" required />
          </label>
          <label>
            {t("tf.note")}
            <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={50} />
          </label>
          {error && <div className="alert">{error}</div>}
          <button className="primary" disabled={busy || !source} {...actionName("common.continue")}>{busy ? t("tf.checking") : t("common.continue")}</button>
        </form>
      )}

      {step === "confirm" && inquiry && (
        <div className="card stack">
          <h2 className="section-title">{t("tf.confirmTitle")}</h2>
          <dl className="summary">
            <dt>{t("common.recipient")}</dt><dd><strong>{inquiry.destination_account_name}</strong></dd>
            <dt>{t("tf.bank")}</dt><dd>{inquiry.destination_bank_name}</dd>
            <dt>{t("tf.account")}</dt><dd className="mono">{inquiry.destination_account_number}</dd>
            <dt>{t("common.service")}</dt><dd>{railLabel(t, inquiry.rail)}</dd>
            <dt>{t("common.amount")}</dt><dd>{formatMoney(inquiry.amount)}</dd>
            <dt>{t("tf.fee")}</dt><dd>{formatMoney(inquiry.fee)}</dd>
            <dt>{t("common.total")}</dt><dd><strong>{formatMoney({ amount: String(Number(inquiry.amount.amount) + Number(inquiry.fee.amount)), currency: "IDR" })}</strong></dd>
            {inquiry.expected_settlement_at && <><dt>{t("tf.eta")}</dt><dd>{formatDateTime(inquiry.expected_settlement_at)} WIB</dd></>}
          </dl>
          {error && <div className="alert">{error}</div>}
          <div className="row">
            <button className="ghost" onClick={() => setStep("form")} disabled={busy} {...actionName("common.edit")}>{t("common.edit")}</button>
            <button className="primary" onClick={confirm} disabled={busy} {...actionName("tf.sendNow")}>{busy ? t("tf.sending") : t("tf.sendNow")}</button>
          </div>
        </div>
      )}

      {step === "result" && result && (
        <div className="card stack center-text">
          <div className={`status ${result.status.toLowerCase()}`}>
            {t(`tf.${result.status}`)}
          </div>
          <p>{formatMoney(result.amount)} {t("tf.to")} <strong>{result.destination_account_name}</strong> · {result.destination_bank_name}</p>
          {result.status === "PROCESSING" && <p className="muted">{t("tf.sknPending", { window: result.skn_window_id ?? "" })}</p>}
          {result.failure_reason && <p className="muted">{t("common.reason", { reason: result.failure_reason })}</p>}
          {result.rail_reference && <p className="muted small mono">Ref: {result.rail_reference}</p>}
          <div className="row center">
            <button className="ghost" onClick={reset} {...actionName("tf.again")}>{t("tf.again")}</button>
            <Link className="primary button" to="/transfer/riwayat" {...actionName("tf.viewHistory")}>{t("tf.viewHistory")}</Link>
          </div>
        </div>
      )}
    </div>
  );
}
