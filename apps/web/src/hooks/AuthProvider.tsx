import { createContext, useContext, type ReactNode } from "react";
import { useAuth as useAuthInternal } from "./useAuth";

type AuthContextValue = ReturnType<typeof useAuthInternal>;

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const value = useAuthInternal();
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuthContext(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuthContext must be used within AuthProvider");
  return ctx;
}
