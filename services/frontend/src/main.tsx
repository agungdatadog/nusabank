import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider, useAuth } from "./auth";
import { Layout } from "./components/Layout";
import { AccountPage } from "./pages/AccountPage";
import { BillerPage } from "./pages/BillerPage";
import { ApplyPage } from "./pages/ApplyPage";
import { DashboardPage } from "./pages/DashboardPage";
import { LoanPage } from "./pages/LoanPage";
import { LoginPage } from "./pages/LoginPage";
import { OpsPage } from "./pages/OpsPage";
import { RewardsPage } from "./pages/RewardsPage";
import { TransferHistoryPage } from "./pages/TransferHistoryPage";
import { TransferPage } from "./pages/TransferPage";
import { initRum } from "./rum";
import "./styles.css";

initRum();

function Protected({ children }: { children: React.ReactNode }) {
  const { customer, loading } = useAuth();
  if (loading) return <div className="center muted">Memuat…</div>;
  return customer ? <>{children}</> : <Navigate to="/login" replace />;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/buka-rekening" element={<ApplyPage />} />
          <Route path="/ops" element={<OpsPage />} />
          <Route element={<Protected><Layout /></Protected>}>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/rekening/:accountNumber" element={<AccountPage />} />
            <Route path="/transfer" element={<TransferPage />} />
            <Route path="/transfer/riwayat" element={<TransferHistoryPage />} />
            <Route path="/bayar" element={<BillerPage />} />
            <Route path="/pinjaman" element={<LoanPage />} />
            <Route path="/poin" element={<RewardsPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
