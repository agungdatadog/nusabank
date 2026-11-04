import { useState, type FormEvent } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { api, RequestError } from "../api";
import { useAuth } from "../auth";
import { Logo } from "../components/Layout";
import { LangSwitcher } from "../components/LangSwitcher";
import { actionName, useT } from "../i18n";
import { rumAction } from "../rum";

interface LoginResponse {
  mfa_required: boolean;
  mfa_token?: string;
  tokens?: { access_token: string };
}

export function LoginPage() {
  const { customer, completeLogin } = useAuth();
  const navigate = useNavigate();
  const { t } = useT();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [mfaToken, setMfaToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (customer) return <Navigate to="/" replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (!mfaToken) {
        const res = await api.post<LoginResponse>("/api/auth/login", { username, password });
        if (res.mfa_required && res.mfa_token) {
          setMfaToken(res.mfa_token);
          rumAction("login_mfa_challenge", {});
          return;
        }
        await completeLogin(res.tokens!.access_token);
      } else {
        const tokens = await api.post<{ access_token: string }>("/api/auth/mfa/verify", { mfa_token: mfaToken, otp });
        await completeLogin(tokens.access_token);
      }
      rumAction("login_success", { mfa: Boolean(mfaToken) });
      navigate("/");
    } catch (err) {
      setError(err instanceof RequestError ? err.body.message : t("common.networkError"));
      if (err instanceof RequestError && err.body.code === "MFA_EXPIRED") setMfaToken(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login">
      <div className="lang-float"><LangSwitcher /></div>
      <div className="login-hero">
        <Logo />
        <h1>{t("login.heroTitle")}</h1>
        <p>{t("login.heroText")}</p>
      </div>
      <form className="card login-card" onSubmit={submit}>
        <h2>{t(mfaToken ? "login.otpTitle" : "login.title")}</h2>
        {!mfaToken ? (
          <>
            <label>
              {t("login.userId")}
              <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" required />
            </label>
            <label>
              {t("common.password")}
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
            </label>
          </>
        ) : (
          <label>
            {t("login.otpLabel")}
            <input value={otp} onChange={(e) => setOtp(e.target.value)} inputMode="numeric" maxLength={6} pattern="\d{6}" required autoFocus />
          </label>
        )}
        {error && <div className="alert">{error}</div>}
        <button className="primary" disabled={busy} {...actionName(mfaToken ? "login.verify" : "login.submit")}>
          {busy ? t("common.processing") : t(mfaToken ? "login.verify" : "login.submit")}
        </button>
        <p className="muted small">
          {t("login.noAccount")} <Link to="/buka-rekening" {...actionName("login.openAccount")}>{t("login.openAccount")}</Link>
        </p>
      </form>
    </div>
  );
}
