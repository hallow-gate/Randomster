import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useAuthContext } from "../hooks/AuthProvider";
import { FlagBadge } from "../components/FlagBadge";
import { BrutalButton } from "../components/BrutalButton";
import { supabase, apiBaseUrl } from "../lib/supabase";

interface PublicProfile {
  id: string;
  username: string;
  country_code: string;
  total_likes: number;
  total_lives: number;
  is_live: boolean;
}

async function authedFetch(path: string) {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  const res = await fetch(`${apiBaseUrl}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  return res;
}

export default function Profile() {
  const { username } = useParams<{ username: string }>();
  const { profile: ownProfile } = useAuthContext();
  const navigate = useNavigate();

  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [liveSessionId, setLiveSessionId] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (!username) return;
    setProfile(null);
    setNotFound(false);
    setLiveSessionId(null);

    authedFetch(`/api/profile/lookup/${encodeURIComponent(username)}`).then(async (res) => {
      if (!res.ok) return setNotFound(true);
      const data = await res.json();
      setProfile(data.profile);
      if (data.profile.is_live) {
        const liveRes = await authedFetch(`/api/live/active-session/${data.profile.id}`);
        if (liveRes.ok) {
          const liveData = await liveRes.json();
          setLiveSessionId(liveData.sessionId);
        }
      }
    });
  }, [username]);

  const isOwnProfile = ownProfile?.username?.toLowerCase() === username?.toLowerCase();

  const goToSearchedProfile = () => {
    const target = search.trim().replace(/^@/, "");
    if (target) navigate(`/profile/${target}`);
    setSearch("");
  };

  return (
    <div className="min-h-dvh flex flex-col">
      <header className="shrink-0 flex items-center justify-between px-4 py-3 border-b-2 border-black">
        <Link to="/" className="text-xs text-cyan underline">
          back
        </Link>
        <h1 className="font-display font-bold text-lime">PROFILE</h1>
        <Link to="/live" className="text-xs text-magenta underline">
          live
        </Link>
      </header>

      <main className="flex-1 flex flex-col items-center gap-6 p-6 overflow-y-auto">
        <div className="w-full max-w-xs flex gap-2">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && goToSearchedProfile()}
            placeholder="find @username..."
            className="flex-1 bg-charcoal border-2 border-black px-3 py-2 text-xs font-mono outline-none placeholder:text-gray-600"
          />
          <button onClick={goToSearchedProfile} className="bg-cyan text-black text-xs font-display font-bold uppercase px-3 border-2 border-black">
            Go
          </button>
        </div>

        {notFound && <p className="text-gray-500 text-sm font-mono">No user @{username} found.</p>}

        {profile && (
          <>
            <button
              disabled={!profile.is_live || !liveSessionId}
              onClick={() => liveSessionId && navigate(`/live/${liveSessionId}`)}
              className="relative"
              aria-label={profile.is_live ? "Go to live stream" : undefined}
            >
              <div
                className={`w-24 h-24 rounded-full flex items-center justify-center font-display font-bold text-3xl bg-charcoal text-lime
                  ${profile.is_live ? "ring-4 ring-red-500 animate-pulse" : "border-2 border-black"}`}
              >
                {profile.username.slice(0, 1).toUpperCase()}
              </div>
              {profile.is_live && (
                <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 bg-red-500 text-white text-[9px] font-bold uppercase px-2 py-0.5 rounded-full">
                  Live
                </span>
              )}
            </button>

            <div className="flex flex-col items-center gap-2">
              <p className="font-mono text-lg text-white">@{profile.username}</p>
              <FlagBadge countryCode={profile.country_code} />
            </div>

            <div className="flex gap-8 font-mono text-center">
              <div>
                <p className="text-2xl text-magenta font-bold">{profile.total_likes}</p>
                <p className="text-[10px] text-gray-400 uppercase">total likes</p>
              </div>
              <div>
                <p className="text-2xl text-cyan font-bold">{profile.total_lives}</p>
                <p className="text-[10px] text-gray-400 uppercase">live streams</p>
              </div>
            </div>

            {isOwnProfile && (
              <div className="flex flex-col items-center gap-2">
                <BrutalButton variant="ghost" className="border-2 border-black" onClick={() => navigate("/live/go")}>
                  Go Live
                </BrutalButton>
                <Link to="/settings" className="text-xs text-cyan underline">
                  settings
                </Link>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
