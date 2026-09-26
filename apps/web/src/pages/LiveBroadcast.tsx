import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuthContext } from "../hooks/AuthProvider";
import { useMatchmaking } from "../hooks/useMatchmaking";
import { useLocalMedia } from "../hooks/useLocalMedia";
import { useCloudflareCalls } from "../hooks/useCloudflareCalls";
import { BrutalButton } from "../components/BrutalButton";
import { TerminalLoader } from "../components/TerminalLoader";
import { CommentsOverlay, type LiveComment } from "../components/CommentsOverlay";
import { HeartReaction } from "../components/HeartReaction";
import { supabase, apiBaseUrl } from "../lib/supabase";

async function authedFetch(path: string, body?: unknown, method = "POST") {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  const res = await fetch(`${apiBaseUrl}${path}`, {
    method,
    headers: { ...(body !== undefined ? { "Content-Type": "application/json" } : {}), Authorization: `Bearer ${token}` },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) throw new Error(`request_failed:${res.status}`);
  return res.json();
}

/**
 * Goes live: this is the exact same random-matchmaking + 1:1 Cloudflare
 * Calls flow as MatchScreen (see hooks/useMatchmaking, useCloudflareCalls) —
 * the "random friends" part of the app is unchanged. The only addition is
 * that once matched, the call is wrapped in a live_sessions row (Neon) so
 * an audience can watch, comment, and react, via routes/live.ts.
 */
export default function LiveBroadcast() {
  const { session, profile } = useAuthContext();
  const selfId = session?.user.id;
  const navigate = useNavigate();
  const { state, matchId, join, skip } = useMatchmaking(selfId);

  const mediaActive = state === "matched";
  const { stream: localStream, error: mediaError } = useLocalMedia(mediaActive);
  const { callState, remoteStream } = useCloudflareCalls(matchId, localStream);

  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const [liveId, setLiveId] = useState<string | null>(null);
  const [viewerCount, setViewerCount] = useState(0);
  const [reactionCount, setReactionCount] = useState(0);
  const [comments, setComments] = useState<LiveComment[]>([]);
  const lastCommentAtRef = useRef<string | null>(null);
  const endingRef = useRef(false);

  useEffect(() => {
    if (localVideoRef.current) localVideoRef.current.srcObject = localStream;
  }, [localStream]);
  useEffect(() => {
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = remoteStream;
  }, [remoteStream]);

  const endLive = useCallback(async () => {
    if (endingRef.current || !liveId) return;
    endingRef.current = true;
    try {
      await authedFetch(`/api/live/${liveId}/end`);
    } catch {
      // best-effort — the server also self-heals abandoned sessions
    }
    setLiveId(null);
  }, [liveId]);

  // Start the live session the moment we're matched.
  useEffect(() => {
    if (state === "matched" && matchId && !liveId) {
      authedFetch("/api/live/start", { matchId })
        .then((data) => setLiveId(data.id))
        .catch(() => {
          /* the poll-based /state below will just show 0 viewers if this failed */
        });
    }
    // The underlying match ended (partner skipped/blocked/reported) — close
    // out the live session too rather than leaving it orphaned.
    if (state !== "matched" && liveId) {
      endLive();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, matchId, liveId]);

  // Poll for viewer count / reaction total / new comments while live.
  useEffect(() => {
    if (!liveId) return;
    let cancelled = false;
    async function poll() {
      try {
        const q = lastCommentAtRef.current ? `?after=${encodeURIComponent(lastCommentAtRef.current)}` : "";
        const data = await authedFetch(`/api/live/${liveId}/state${q}`, undefined, "GET");
        if (cancelled || data.ended) return;
        setViewerCount(data.viewerCount);
        setReactionCount(data.reactionCount);
        if (data.comments?.length) {
          setComments((prev) => [...prev, ...data.comments].slice(-100));
          lastCommentAtRef.current = data.comments[data.comments.length - 1].created_at;
        }
      } catch {
        // transient — next poll retries
      }
    }
    poll();
    const interval = setInterval(poll, 3000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [liveId]);

  useEffect(() => {
    return () => {
      if (liveId) authedFetch(`/api/live/${liveId}/end`).catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!session || !profile) return null;

  const handleEndAndLeave = async () => {
    await endLive();
    if (matchId) await skip();
    navigate("/live");
  };

  return (
    <div className="h-dvh flex flex-col overflow-hidden bg-black">
      <header className="shrink-0 flex items-center justify-between px-4 py-3 border-b-2 border-black">
        <h1 className="font-display font-bold text-lime">GO LIVE</h1>
        {liveId && (
          <span className="font-mono text-xs text-cyan">{viewerCount} watching</span>
        )}
      </header>

      <main className="flex-1 flex flex-col items-center justify-center p-4 gap-4 overflow-hidden">
        {state === "idle" && (
          <div className="flex flex-col items-center gap-3">
            <p className="text-xs text-gray-400 font-mono max-w-xs text-center">
              You'll be paired with a random stranger, and your call goes on the live feed for others to watch.
            </p>
            <BrutalButton onClick={() => join(profile.match_scope)}>Start Live</BrutalButton>
          </div>
        )}

        {state === "queued" && <TerminalLoader countryCode={profile.country_code} />}

        {state === "matched" && matchId && (
          <div className="relative w-full max-w-md aspect-video bg-black border-2 border-magenta shadow-brutal overflow-hidden">
            <video ref={remoteVideoRef} autoPlay playsInline className="w-full h-full object-cover -scale-x-100" />
            {callState === "connecting" && (
              <div className="absolute inset-0 flex items-center justify-center text-cyan text-sm font-mono bg-black/60">
                connecting stranger...
              </div>
            )}
            {localStream && (
              <video
                ref={localVideoRef}
                autoPlay
                playsInline
                muted
                className="absolute bottom-2 right-2 w-20 h-16 sm:w-28 sm:h-20 object-cover border-2 border-lime shadow-brutal-sm -scale-x-100"
              />
            )}

            <div className="absolute top-2 left-2 flex items-center gap-1 bg-magenta text-black text-[10px] font-display font-bold uppercase px-1.5 py-0.5 border border-black">
              ● Live
            </div>

            {liveId && <CommentsOverlay comments={comments} onSend={() => {}} disabled />}

            {liveId && (
              <div className="absolute right-2 bottom-16">
                <HeartReaction count={reactionCount} onReact={() => {}} />
              </div>
            )}
          </div>
        )}

        {mediaError && <p className="text-magenta text-xs">Camera/mic error: {mediaError}</p>}

        {state === "matched" && (
          <BrutalButton variant="magenta" onClick={handleEndAndLeave}>
            End Live
          </BrutalButton>
        )}
      </main>
    </div>
  );
}
