import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "../auth";
import { actionName, useT } from "../i18n";
import { ChatWidget } from "./ChatWidget";
import { LangSwitcher } from "./LangSwitcher";

export function Logo() {
  return (
    <span className="logo">
      <svg viewBox="0 0 32 32" width="28" height="28" aria-hidden>
        <rect width="32" height="32" rx="8" fill="currentColor" />
        <path d="M6 20c4-6 8-6 10 0s6 6 10 0" stroke="#ff7a6b" strokeWidth="3" fill="none" strokeLinecap="round" />
      </svg>
      <span>Nusa Bank</span>
    </span>
  );
}

export function Layout() {
  const { customer, logout } = useAuth();
  const navigate = useNavigate();
  const { t } = useT();
  return (
    <div className="app">
      <header className="topbar">
        <Logo />
        <nav>
          <NavLink to="/" end {...actionName("nav.home")}>{t("nav.home")}</NavLink>
          <NavLink to="/transfer" end {...actionName("nav.transfer")}>{t("nav.transfer")}</NavLink>
          <NavLink to="/transfer/riwayat" {...actionName("nav.transferHistory")}>{t("nav.transferHistory")}</NavLink>
          <NavLink to="/bayar" {...actionName("nav.bills")}>{t("nav.bills")}</NavLink>
          <NavLink to="/pinjaman" {...actionName("nav.loans")}>{t("nav.loans")}</NavLink>
          <NavLink to="/poin" {...actionName("nav.points")}>{t("nav.points")}</NavLink>
        </nav>
        <div className="user">
          <span>{customer?.full_name}</span>
          {customer && customer.segment !== "REGULAR" && <span className="badge">{t(customer.segment === "PRIVATE" ? "segment.PRIVATE" : "segment.PRIORITY")}</span>}
          <LangSwitcher />
          <button className="link" onClick={async () => { await logout(); navigate("/login"); }} {...actionName("common.signOut")}>{t("common.signOut")}</button>
        </div>
      </header>
      <main className="content">
        <Outlet />
      </main>
      <ChatWidget />
      <footer className="footer">{t("footer.disclaimer")}</footer>
    </div>
  );
}
