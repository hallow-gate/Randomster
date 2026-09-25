import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase, apiBaseUrl } from "../lib/supabase";
import { BrutalButton } from "../components/BrutalButton";
import { useAuthContext } from "../hooks/AuthProvider";

export default function UsernameSetup() {
  const [username, setUsername] = useState("");
  const [ageConfirmed, setAgeConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const { refreshProfile } = useAuthContext();

  const valid = /^[a-zA-Z0-9_]{3,20}$/.test(username);

  const submit = async () => {
    setError(null);
    if (!ageConfirmed) {
      setError("You must confirm you are 18 or older to use Randomster.");
      return;
    }
    if (!valid) {
      setError("3-20 chars, letters/numbers/underscore only.");
      return;
    }
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    const res = await fetch(`${apiBaseUrl}/api/profile/username`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ username }),
    });
    if (!res.ok) {
      const body = await res.json();
      setError(body.error ?? "Something went wrong.");
      return;
    }
    await refreshProfile();
    navigate("/");
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-sm bg-black border-2 border-lime shadow-brutal p-6">
        <h1 className="font-display text-2xl font-bold text-lime mb-1">CHOOSE A HANDLE</h1>
        <p className="text-xs text-gray-400 mb-4">This is what strangers will see. Can't change it for 30 days.</p>
        <input
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="e.g. neon_wanderer_42"
          className="w-full bg-charcoal border-2 border-white px-3 py-2 mb-3 text-white outline-none focus:border-lime"
        />
        <label className="flex items-start gap-2 text-xs text-gray-300 mb-4">
          <input
            type="checkbox"
            checked={ageConfirmed}
            onChange={(e) => setAgeConfirmed(e.target.checked)}
            className="mt-0.5"
          />
          <span>
            I confirm I am 18 years of age or older. Randomster performs additional identity verification and
            will restrict accounts that fail it.
          </span>
        </label>
        {error && <p className="text-magenta text-xs mb-3">{error}</p>}
        <BrutalButton onClick={submit} className="w-full">
          Continue
        </BrutalButton>
      </div>
    </div>
  );
}
