import { useState } from "react";
import { Link } from "react-router-dom";
import { useAuthContext } from "../hooks/AuthProvider";
import { supabase, apiBaseUrl } from "../lib/supabase";
import { BrutalButton } from "../components/BrutalButton";
import { FlagBadge } from "../components/FlagBadge";

// A reasonably short ISO-3166 sample; extend with the full list in production.
const COUNTRIES = ["US", "GB", "DE", "FR", "PH", "JP", "BR", "IN", "AU", "CA", "MX", "ZA"];

export default function Settings() {
  const { profile, refreshProfile, signOut } = useAuthContext();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!profile) return null;

  const authedPost = async (path: string, body: unknown) => {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    const res = await fetch(`${apiBaseUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error((await res.json()).error ?? "request_failed");
  };

  const updateCountry = async (countryCode: string) => {
    setSaving(true);
    setError(null);
    try {
      await authedPost("/api/profile/country", { countryCode });
      await refreshProfile();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const updateScope = async (scope: string) => {
    setSaving(true);
    setError(null);
    try {
      await authedPost("/api/profile/scope", { scope });
      await refreshProfile();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const exportData = async () => {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    const res = await fetch(`${apiBaseUrl}/api/account/export`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const json = await res.json();
    const blob = new Blob([JSON.stringify(json, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "randomster-data-export.json";
    a.click();
    URL.revokeObjectURL(url);
  };

  const deleteAccount = async () => {
    if (!window.confirm("Permanently delete your Randomster account? This cannot be undone.")) return;
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    await fetch(`${apiBaseUrl}/api/account`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    await signOut();
  };

  return (
    <div className="min-h-screen px-4 py-8 flex flex-col items-center">
      <div className="w-full max-w-md bg-black border-2 border-lime shadow-brutal p-6 space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="font-display text-2xl font-bold text-lime">SETTINGS</h1>
          <Link to="/" className="text-xs text-cyan underline">
            back
          </Link>
        </div>

        <section>
          <p className="text-xs uppercase text-gray-400 mb-2">Country</p>
          <div className="flex items-center gap-2 flex-wrap">
            {COUNTRIES.map((c) => (
              <button key={c} onClick={() => updateCountry(c)} disabled={saving}>
                <FlagBadge countryCode={c} />
              </button>
            ))}
          </div>
          <p className="text-[10px] text-gray-600 mt-1">Current: {profile.country_code}</p>
        </section>

        <section>
          <p className="text-xs uppercase text-gray-400 mb-2">Match scope</p>
          <div className="flex gap-2">
            {(["SAME_COUNTRY", "ALL_COUNTRIES"] as const).map((scope) => (
              <BrutalButton
                key={scope}
                variant={profile.match_scope === scope ? "lime" : "ghost"}
                onClick={() => updateScope(scope)}
                className="text-xs px-3 py-2"
                disabled={saving}
              >
                {scope === "SAME_COUNTRY" ? "Same country" : "All countries"}
              </BrutalButton>
            ))}
          </div>
        </section>

        <section>
          <p className="text-xs uppercase text-gray-400 mb-2">Identity verification</p>
          <p className="text-xs text-gray-500">
            Status: <span className="text-cyan">{profile.age_verification_status}</span>
          </p>
          {profile.age_verification_status !== "verified" && (
            <Link to="/verify-age" className="text-xs text-magenta underline">
              Verify now →
            </Link>
          )}
        </section>

        {error && <p className="text-magenta text-xs">{error}</p>}

        <section className="flex flex-col gap-2 pt-4 border-t border-gray-800">
          <BrutalButton variant="cyan" onClick={exportData} className="text-xs py-2">
            Export my data (GDPR)
          </BrutalButton>
          <BrutalButton variant="ghost" onClick={() => signOut()} className="text-xs py-2">
            Sign out
          </BrutalButton>
          <button onClick={deleteAccount} className="text-xs text-red-400 underline mt-2">
            Delete my account permanently
          </button>
        </section>

        <Link to="/privacy" className="block text-center text-[10px] text-gray-600 underline">
          Privacy Policy
        </Link>
      </div>
    </div>
  );
}
