import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuthContext } from "../hooks/AuthProvider";
import { useMatchmaking } from "../hooks/useMatchmaking";
import { useLocalMedia } from "../hooks/useLocalMedia";
import { useCloudflareCalls } from "../hooks/useCloudflareCalls";
import { useSoundEffects } from "../hooks/useSoundEffects";
import { BrutalButton } from "../components/BrutalButton";
import { TerminalLoader } from "../components/TerminalLoader";
import { ControlDock } from "../components/ControlDock";
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
 * Calls flow as MatchScreen (see hooks/useMatchmaking, useCloudflareCalls),
 * including Skip/Next/Report/Block and mic/cam controls — the "random
 * friends" part of the app is unchanged. The only addition is that once
 * matched, the call is wrapped in a live_sessions row (Neon) so an
 * audience can watch, comment, and react, via routes/live.ts.
 *
 * Crucially, the LIVE STREAM and the CURRENT MATCH are two different
 * lifetimes: hitting Next, or the stranger skipping/blocking/reporting the
 * host, ends the match but never the stream — the host's own camera stays
 * up (it never depended on having a remote peer) and the same live_session
 * (same comments, reactions, viewer count) just gets re-partnered once a
 * new match is found. Only the host's explicit "End Live" ends the stream.
 */
export default function LiveBroadcast() {
  const { session, profile } = useAuthContext();
  const selfId = session?.user.id;
  const navigate = useNavigate();
  const { state, matchId, join, skip, next, report, block, resetAfterEnd } = useMatchmaking(selfId);
  const sound = useSoundEffects();

  // The host's own camera has nothing to do with whether a stranger is
  // currently connected — it's on for the whole time they're on this page,
  // exactly like a real live host sees themselves before anyone joins.
  const { stream: localStream, micMuted, camOff, toggleMic, toggleCam, error: mediaError } = useLocalMedia(true);
  const { callState, remoteStream } = useCloudflareCalls(matchId, localStream);

  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const [liveId, setLiveId] = useState<string | null>(null);
  const [viewerCount, setViewerCount] = useState(0);
  const [reactionCount, setReactionCount] = useState(0);
  const [comments, setComments] = useState<LiveComment[]>([]);
  const [commentsEnabled, setCommentsEnabled] = useState(true);
  const lastCommentAtRef = useRef<string | null>(null);
  const liveIdRef = useRef<string | null>(null);
  const startedMatchIdRef = useRef<string | null>(null);
  const endingRef = useRef(false);

  useEffect(() => {
    liveIdRef.current = liveId;
  }, [liveId]);

  useEffect(() => {
    if (localVideoRef.current) localVideoRef.current.srcObject = localStream;
  }, [localStream]);
  useEffect(() => {
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = remoteStream;
  }, [remoteStream]);

  useEffect(() => {
    if (state === "matched") sound.play("connect");
    if (state === "ended") sound.play("disconnect");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  const clearPartner = useCallback(async () => {
    if (!liveIdRef.current) return;
    await authedFetch(`/api/live/${liveIdRef.current}/clear-partner`).catch(() => {});
    startedMatchIdRef.current = null;
  }, []);

  // Start (or re-partner) the live session whenever we land on a fresh match.
  useEffect(() => {
    if (state === "matched" && matchId && startedMatchIdRef.current !== matchId) {
      startedMatchIdRef.current = matchId;
      authedFetch("/api/live/start", { matchId })
        .then((data) => setLiveId(data.id))
        .catch(() => {
          startedMatchIdRef.current = null;
        });
    }
  }, [state, matchId]);

  // The stranger left (skip/block/report/moderation) — clear the stale
  // partner so viewers see "waiting for next stranger" instead of a frozen
  // video, then automatically go straight back into the queue. The stream
  // itself is untouched.
  useEffect(() => {
    if (state !== "ended" || endingRef.current || !profile) return;
    (async () => {
      await clearPartner();
      resetAfterEnd();
      join(profile.match_scope);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  // Poll for viewer count / reaction total / new comments / re-partner info
  // while live, independent of whether a stranger is currently connected.
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
        setCommentsEnabled(data.commentsEnabled);
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

  // Leave the live session if the host just closes the tab / navigates away
  // without pressing "End Live".
  useEffect(() => {
    return () => {
      if (liveIdRef.current) authedFetch(`/api/live/${liveIdRef.current}/end`).catch(() => {});
    };
  }, []);

  if (!session || !profile) return null;

  const handleStart = () => {
    sound.play("click");
    join(profile.match_scope);
  };

  const handleSkip = async () => {
    sound.play("click");
    await clearPartner();
    skip();
  };

  const handleNext = async () => {
    sound.play("click");
    await clearPartner();
    next(profile.match_scope);
  };

  const handleBlock = async () => {
    await clearPartner();
    block();
  };

  const toggleComments = async () => {
    if (!liveId) return;
    const enabled = !commentsEnabled;
    setCommentsEnabled(enabled);
    authedFetch(`/api/live/${liveId}/comments-enabled`, { enabled }, "PATCH").catch(() => {
      setCommentsEnabled(!enabled); // revert on failure
    });
  };

  const handleEndLive = async () => {
    endingRef.current = true;
    if (liveId) await authedFetch(`/api/live/${liveId}/end`).catch(() => {});
    if (matchId) await skip().catch(() => {});
    navigate("/live");
  };

  const searching = state === "queued";

  return (
    <div className="h-dvh flex flex-col overflow-hidden bg-black">
      <header className="shrink-0 flex items-center justify-between px-4 py-3 border-b-2 border-black">
        <h1 className="font-display font-bold text-lime">GO LIVE</h1>
        <div className="flex items-center gap-3">
          {liveId && (
            <button onClick={toggleComments} className="text-[10px] font-mono text-cyan underline">
              {commentsEnabled ? "hide comments" : "show comments"}
            </button>
          )}
          {liveId && <span className="font-mono text-xs text-cyan">{viewerCount} watching</span>}
        </div>
      </header>

      <main className="flex-1 flex flex-col items-center justify-center p-4 gap-4 overflow-hidden">
        {/* Video container: the host's own camera is always live the
            moment this page mounts (see useLocalMedia(true) above), well
            before — and well after — any stranger is connected. */}
        <div className="relative w-full max-w-md aspect-video bg-black border-2 border-magenta shadow-brutal overflow-hidden">
          {remoteStream ? (
            <video ref={remoteVideoRef} autoPlay playsInline className="w-full h-full object-cover -scale-x-100" />
          ) : (
            localStream && (
              <video
                ref={localVideoRef}
                autoPlay
                playsInline
                muted
                className="w-full h-full object-cover -scale-x-100"
              />
            )
          )}

          {remoteStream && localStream && (
            <video
              ref={localVideoRef}
              autoPlay
              playsInline
              muted
              className="absolute bottom-2 right-2 w-20 h-16 sm:w-28 sm:h-20 object-cover border-2 border-lime shadow-brutal-sm -scale-x-100"
            />
          )}

          {!localStream && !remoteStream && (
            <div className="absolute inset-0 flex items-center justify-center text-gray-600 text-sm">
              starting camera...
            </div>
          )}
          {state === "matched" && !remoteStream && callState === "connecting" && (
            <div className="absolute inset-0 flex items-center justify-center text-cyan text-sm font-mono bg-black/60">
              connecting stranger...
            </div>
          )}
          {searching && liveId && (
            <div className="absolute inset-x-0 bottom-0 bg-black/70 text-cyan text-xs font-mono text-center py-1">
              looking for the next stranger...
            </div>
          )}

          <div className="absolute top-2 left-2 flex items-center gap-1 bg-magenta text-black text-[10px] font-display font-bold uppercase px-1.5 py-0.5 border border-black">
            ● Live
          </div>

          {liveId && commentsEnabled && <CommentsOverlay comments={comments} onSend={() => {}} disabled />}

          {liveId && (
            <div className="absolute right-2 bottom-16">
              <HeartReaction count={reactionCount} onReact={() => {}} />
            </div>
          )}
        </div>

        {mediaError && <p className="text-magenta text-xs">Camera/mic error: {mediaError}</p>}

        {state === "idle" && (
          <div className="flex flex-col items-center gap-3">
            <p className="text-xs text-gray-400 font-mono max-w-xs text-center">
              You'll be paired with a random stranger, and your call goes on the live feed for others to watch.
            </p>
            <BrutalButton onClick={handleStart}>Start Live</BrutalButton>
          </div>
        )}

        {state === "queued" && <TerminalLoader countryCode={profile.country_code} />}

        {state === "matched" && matchId && (
          <ControlDock
            onSkip={handleSkip}
            onNext={handleNext}
            onReport={(reason, details) => report(reason, details)}
            onBlock={handleBlock}
            micMuted={micMuted}
            camOff={camOff}
            onToggleMic={toggleMic}
            onToggleCam={toggleCam}
            soundMuted={sound.muted}
            onToggleSound={sound.toggleMuted}
          />
        )}

        {liveId && (
          <button onClick={handleEndLive} className="text-xs text-red-400 underline font-mono">
            End Live
          </button>
        )}
      </main>
    </div>
  );
}
