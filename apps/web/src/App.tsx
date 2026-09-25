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
  const { session, profile, loading, profileLoading } = useAuthContext();

  // Wait for the profile fetch to finish too, not just the session check.
  // `profile` starts out `null` on every fresh load while it's being
  // fetched, which is indistinguishable from "no profile yet" -- without
  // this, every guard below would briefly evaluate against a profile that
  // just hasn't arrived, causing a flash to the wrong page (e.g. bouncing
  // an already-onboarded user to /username for a frame before correcting).
  if (loading || (session && profileLoading)) {
    return <div className="min-h-screen flex items-center justify-center text-lime font-mono">loading...</div>;
  }

  const needsUsername = session && !profile?.username;

  return (
    <Routes>
      <Route path="/login" element={session ? <Navigate to="/" /> : <Login />} />
      <Route
        path="/username"
        element={!session ? <Navigate to="/login" /> : profile?.username ? <Navigate to="/" /> : <UsernameSetup />}
      />
      <Route
        path="/settings"
        element={!session ? <Navigate to="/login" /> : needsUsername ? <Navigate to="/username" /> : <Settings />}
      />
      <Route
        path="/verify-age"
        element={
          !session ? <Navigate to="/login" /> : needsUsername ? <Navigate to="/username" /> : <AgeVerification />
        }
      />
      <Route path="/privacy" element={<PrivacyPolicy />} />
      <Route
        path="/"
        element={!session ? <Navigate to="/login" /> : needsUsername ? <Navigate to="/username" /> : <MatchScreen />}
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
