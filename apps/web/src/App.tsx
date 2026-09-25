import { Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider, useAuthContext } from "./hooks/AuthProvider";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { CustomCursor } from "./components/CustomCursor";
import Login from "./pages/Login";
import UsernameSetup from "./pages/UsernameSetup";
import MatchScreen from "./pages/MatchScreen";
import Settings from "./pages/Settings";
import AgeVerification from "./pages/AgeVerification";
import PrivacyPolicy from "./pages/PrivacyPolicy";

function Router() {
  const { session, profile, loading } = useAuthContext();

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center text-lime font-mono">loading...</div>;
  }

  return (
    <Routes>
      <Route path="/login" element={session ? <Navigate to="/" /> : <Login />} />
      <Route path="/username" element={session ? <UsernameSetup /> : <Navigate to="/login" />} />
      <Route path="/settings" element={session ? <Settings /> : <Navigate to="/login" />} />
      <Route path="/verify-age" element={session ? <AgeVerification /> : <Navigate to="/login" />} />
      <Route path="/privacy" element={<PrivacyPolicy />} />
      <Route
        path="/"
        element={
          !session ? (
            <Navigate to="/login" />
          ) : !profile?.username ? (
            <Navigate to="/username" />
          ) : (
            <MatchScreen />
          )
        }
      />
    </Routes>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <div className="grain-overlay" aria-hidden />
        <CustomCursor />
        <Router />
      </AuthProvider>
    </ErrorBoundary>
  );
}
