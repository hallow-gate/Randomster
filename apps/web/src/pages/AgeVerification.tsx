import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase, apiBaseUrl } from "../lib/supabase";
import { BrutalButton } from "../components/BrutalButton";
import { useAuthContext } from "../hooks/AuthProvider";

export default function AgeVerification() {
  const { profile, refreshProfile } = useAuthContext();
  const [status, setStatus] = useState<"idle" | "starting" | "pending" | "error">("idle");
  const navigate = useNavigate();

  const start = async () => {
    setStatus("starting");
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    const res = await fetch(`${apiBaseUrl}/api/age-verification/start`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      setStatus("error");
      return;
    }
    const body = await res.json();
    setStatus("pending");
    await refreshProfile();
    // In production: redirect to body.verificationUrl (the vendor's hosted
    // flow) or open their SDK. This stub just reports the pending state.
    console.info("verification session started:", body.verificationUrl);
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-sm bg-black border-2 border-cyan shadow-brutal p-6 text-center">
        <h1 className="font-display text-2xl font-bold text-cyan mb-2">VERIFY YOUR AGE</h1>
        <p className="text-xs text-gray-400 mb-6">
          Randomster requires identity verification to confirm you're 18 or older before matching you with
          strangers on video.
        </p>

        {profile?.age_verification_status === "verified" ? (
          <p className="text-lime text-sm mb-4">✓ You're verified.</p>
        ) : status === "pending" ? (
          <p className="text-yellow-400 text-sm mb-4">
            Verification in progress. This can take a few minutes — check back shortly.
          </p>
        ) : (
          <BrutalButton onClick={start} disabled={status === "starting"} className="w-full mb-4">
            {status === "starting" ? "Starting..." : "Start verification"}
          </BrutalButton>
        )}

        {status === "error" && <p className="text-magenta text-xs mb-4">Something went wrong. Try again.</p>}

        <button onClick={() => navigate("/settings")} className="text-xs text-gray-500 underline">
          Back to settings
        </button>
      </div>
      <Link to="/privacy" className="sr-only">
        Privacy Policy
      </Link>
    </div>
  );
}
