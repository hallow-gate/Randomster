import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase, apiBaseUrl } from "../lib/supabase";
import { useAuthContext } from "../hooks/AuthProvider";

interface FeedSession {
  id: string;
  broadcasterId: string;
  broadcasterUsername: string;
  partnerId: string | null;
  partnerUsername: string | null;
  viewerCount: number;
  startedAt: string;
}

async function authedFetch(path: string) {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  const res = await fetch(`${apiBaseUrl}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`request_failed:${res.status}`);
  return res.json();
}

export default function LiveFeed() {
  const { profile } = useAuthContext();
  const navigate = useNavigate();
  const [sessions, setSessions] = useState<FeedSession[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const data = await authedFetch("/api/live/feed");
        if (!cancelled) setSessions(data.sessions);
      } catch {
        // transient network hiccup — the poll below will retry
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    const interval = setInterval(load, 5000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  return (
    <div className="min-h-dvh flex flex-col bg-charcoal text-white">
      <header className="shrink-0 flex items-center justify-between px-4 py-3 border-b-2 border-black bg-black/40">
        <div className="flex items-center gap-3">
          <Link to="/" className="font-mono text-[11px] text-cyan border border-cyan/40 px-2 py-1 hover:bg-cyan/10">
            ← back
          </Link>
          <h1 className="font-display font-bold text-lime tracking-wide">LIVE</h1>
        </div>
        {profile && (
          <Link to={`/profile/${profile.username}`} className="text-xs text-cyan underline">
            @{profile.username}
          </Link>
        )}
      </header>

      <main className="flex-1 overflow-y-auto p-4 sm:p-6">
        {loading && (
          <p className="text-gray-500 text-sm font-mono">loading live streams...</p>
        )}

        {!loading && sessions.length === 0 && (
          <div className="flex flex-col items-center justify-center gap-3 py-20 text-center">
            <p className="text-4xl">📡</p>
            <p className="text-gray-400 text-sm font-mono">Nobody's live right now — be the first.</p>
            <button
              onClick={() => navigate("/live/go")}
              className="font-display font-bold uppercase text-xs px-4 py-2 bg-lime text-black border-2 border-black shadow-brutal-sm hover:-translate-y-0.5 transition-transform"
            >
              Go Live
            </button>
          </div>
        )}

        {!loading && sessions.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 sm:gap-4">
            {sessions.map((s) => (
              <button
                key={s.id}
                onClick={() => navigate(`/live/${s.id}`)}
                className="group relative aspect-[3/4] bg-black border-2 border-black shadow-brutal-sm overflow-hidden
                  flex flex-col justify-end p-2.5 text-left hover:-translate-y-0.5 hover:border-magenta transition-all"
              >
                <div
                  className="absolute top-2 left-2 flex items-center gap-1 bg-magenta text-black text-[10px]
                  font-display font-bold uppercase px-1.5 py-0.5 border border-black"
                >
                  <span className="relative flex h-1.5 w-1.5">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-black opacity-75" />
                    <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-black" />
                  </span>
                  Live
                </div>
                <div className="absolute top-2 right-2 bg-black/70 text-cyan text-[10px] font-mono px-1.5 py-0.5">
                  👁 {s.viewerCount}
                </div>
                <div className="absolute inset-0 flex items-center justify-center text-4xl opacity-15 select-none group-hover:opacity-25 transition-opacity">
                  🎥
                </div>
                <div className="relative bg-black/60 backdrop-blur-[1px] px-1.5 py-1 -mx-1">
                  <p className="font-mono text-xs text-lime truncate">@{s.broadcasterUsername}</p>
                  {s.partnerUsername && (
                    <p className="font-mono text-[10px] text-gray-400 truncate">with @{s.partnerUsername}</p>
                  )}
                </div>
              </button>
            ))}
          </div>
        )}
      </main>

      <button
        onClick={() => navigate("/live/go")}
        aria-label="Go live"
        className="fixed bottom-6 right-6 w-14 h-14 rounded-full bg-lime text-black text-3xl font-bold
          border-2 border-black shadow-brutal flex items-center justify-center
          active:translate-x-[3px] active:translate-y-[3px] active:shadow-brutal-sm hover:-translate-y-0.5 transition-transform"
      >
        +
      </button>
    </div>
  );
}
