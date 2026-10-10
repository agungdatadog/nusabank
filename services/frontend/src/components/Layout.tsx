import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "../auth";

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
  return (
    <div className="app">
      <header className="topbar">
        <Logo />
        <nav>
          <NavLink to="/" end>Beranda</NavLink>
          <NavLink to="/transfer" end>Transfer</NavLink>
          <NavLink to="/transfer/riwayat">Riwayat Transfer</NavLink>
        </nav>
        <div className="user">
          <span>{customer?.full_name}</span>
          {customer && customer.segment !== "REGULAR" && <span className="badge">{customer.segment === "PRIVATE" ? "Private" : "Prioritas"}</span>}
          <button className="link" onClick={async () => { await logout(); navigate("/login"); }}>Keluar</button>
        </div>
      </header>
      <main className="content">
        <Outlet />
      </main>
      <footer className="footer">Nusa Bank adalah bank fiktif untuk demonstrasi. Data nasabah bersifat sintetis.</footer>
    </div>
  );
}
