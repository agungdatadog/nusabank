import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api, session, setUnauthorizedHandler, type Customer } from "./api";
import { rumClearUser, rumSetUser } from "./rum";

interface AuthState {
  customer: Customer | null;
  loading: boolean;
  completeLogin: (accessToken: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [loading, setLoading] = useState(true);

  const loadMe = useCallback(async () => {
    const me = await api.get<Customer>("/api/auth/me");
    setCustomer(me);
    rumSetUser({ cif: me.cif, name: me.full_name, segment: me.segment });
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      setCustomer(null);
      rumClearUser();
    });
    if (!session.token) {
      setLoading(false);
      return;
    }
    loadMe().catch(() => session.clear()).finally(() => setLoading(false));
  }, [loadMe]);

  const completeLogin = async (accessToken: string) => {
    session.set(accessToken);
    await loadMe();
  };

  const logout = async () => {
    await api.post("/api/auth/logout").catch(() => undefined);
    session.clear();
    setCustomer(null);
    rumClearUser();
  };

  return <AuthContext.Provider value={{ customer, loading, completeLogin, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth outside AuthProvider");
  return ctx;
}
