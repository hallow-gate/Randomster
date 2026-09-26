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
import { ChatPanel } from "../components/ChatPanel";
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

  // Both video elements stay mounted for the whole lifetime of the page —
  // they're never conditionally added/removed from the tree. Only *which
  // stream* they show, and whether the PIP is visible, changes. This is
  // what fixes the self-preview going blank: a `<video>` that gets
  // unmounted and a fresh one mounted in its place (e.g. by swapping
  // between "big local view" and "small local PIP" in a ternary) never
  // gets `srcObject` re-applied unless the *stream itself* changes — and
  // the host's own camera stream doesn't change on Next/matched/unmatched,
  // only which box it should appear in does. Keeping one stable element
  // per role and re-pointing its `srcObject` whenever either stream
  // changes sidesteps that entirely.
  const mainVideoRef = useRef<HTMLVideoElement>(null);
  const pipVideoRef = useRef<HTMLVideoElement>(null);

  const [liveId, setLiveId] = useState<string | null>(null);
  const [viewerCount, setViewerCount] = useState(0);
  const [reactionCount, setReactionCount] = useState(0);
  const [comments, setComments] = useState<LiveComment[]>([]);
  const [commentsEnabled, setCommentsEnabled] = useState(true);
  const [commentsBusy, setCommentsBusy] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const lastCommentAtRef = useRef<string | null>(null);
  const liveIdRef = useRef<string | null>(null);
  const startedMatchIdRef = useRef<string | null>(null);
  const endingRef = useRef(false);

  useEffect(() => {
    liveIdRef.current = liveId;
  }, [liveId]);

  // Main box: show the stranger once connected, otherwise fall back to the
  // host's own camera so the box is never empty while waiting/searching.
  useEffect(() => {
    if (mainVideoRef.current) mainVideoRef.current.srcObject = remoteStream ?? localStream ?? null;
  }, [remoteStream, localStream]);

  // PIP: always the host's own camera. Visibility (not mount state) is
  // toggled by CSS depending on whether the main box is currently showing
  // the stranger.
  useEffect(() => {
    if (pipVideoRef.current) pipVideoRef.current.srcObject = localStream ?? null;
  }, [localStream]);

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
    setChatOpen(false);
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
    setChatOpen(false);
    await clearPartner();
    skip();
  };

  const handleNext = async () => {
    sound.play("click");
    setChatOpen(false);
    await clearPartner();
    next(profile.match_scope);
  };

  const handleBlock = async () => {
    setChatOpen(false);
    await clearPartner();
    block();
  };

  const toggleComments = async () => {
    if (!liveId || commentsBusy) return;
    const enabled = !commentsEnabled;
    setCommentsBusy(true);
    setCommentsEnabled(enabled);
    try {
      await authedFetch(`/api/live/${liveId}/comments-enabled`, { enabled }, "PATCH");
    } catch {
      setCommentsEnabled(!enabled); // revert on failure
    } finally {
      setCommentsBusy(false);
    }
  };

  const handleEndLive = async () => {
    endingRef.current = true;
    if (liveId) await authedFetch(`/api/live/${liveId}/end`).catch(() => {});
    if (matchId) await skip().catch(() => {});
    navigate("/live");
  };

  const searching = state === "queued";
  const showingStranger = !!remoteStream;
  const chatAvailable = state === "matched" && !!matchId && !!selfId;

  return (
    <div className="h-dvh flex flex-col overflow-hidden bg-charcoal text-white">
      {/* ---------------------------------------------------------------- */}
      {/* Header: identity/status on the left, all host controls grouped  */}
      {/* on the right as compact icon-pills instead of scattered text     */}
      {/* links, so nothing gets missed or mistaken for decoration.        */}
      {/* ---------------------------------------------------------------- */}
      <header className="shrink-0 flex items-center justify-between gap-2 px-3 sm:px-4 py-3 border-b-2 border-black bg-black/40">
        <div className="flex items-center gap-2 min-w-0">
          <span className="flex items-center gap-1 bg-magenta text-black text-[10px] font-display font-bold uppercase px-2 py-1 border border-black shrink-0">
            <span className="relative flex h-1.5 w-1.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-black opacity-75" />
              <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-black" />
            </span>
            Live
          </span>
          <h1 className="font-display font-bold text-lime text-sm truncate hidden sm:block">GO LIVE</h1>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {liveId && (
            <span className="font-mono text-[11px] text-cyan bg-black/50 px-2 py-1 border border-cyan/40">
              👁 {viewerCount}
            </span>
          )}
          {liveId && (
            <button
              onClick={toggleComments}
              disabled={commentsBusy}
              title={commentsEnabled ? "Hide comments from viewers" : "Show comments to viewers"}
              className={`font-mono text-[11px] px-2 py-1 border transition-colors disabled:opacity-50 ${
                commentsEnabled
                  ? "text-cyan border-cyan/40 hover:bg-cyan/10"
                  : "text-gray-400 border-gray-600 hover:bg-white/5"
              }`}
            >
              {commentsEnabled ? "💬 On" : "🚫 Off"}
            </button>
          )}
          {chatAvailable && (
            <button
              onClick={() => setChatOpen((v) => !v)}
              title="Chat with the stranger"
              className={`md:hidden font-mono text-[11px] px-2 py-1 border transition-colors ${
                chatOpen ? "text-black bg-lime border-black" : "text-lime border-lime/40 hover:bg-lime/10"
              }`}
            >
              💬 Chat
            </button>
          )}
          {liveId && (
            <button
              onClick={handleEndLive}
              className="font-mono text-[11px] text-black bg-red-400 hover:bg-red-300 px-2 py-1 border border-black uppercase font-bold"
            >
              End
            </button>
          )}
        </div>
      </header>

      {/* ---------------------------------------------------------------- */}
      {/* Body: video + controls in the main column; on md+ screens the    */}
      {/* private stranger-chat gets its own permanent side panel (same     */}
      {/* idea as MatchScreen) instead of competing for space over the     */}
      {/* video with the public viewer comments.                           */}
      {/* ---------------------------------------------------------------- */}
      <main className="flex-1 flex flex-col md:flex-row gap-4 p-3 sm:p-4 overflow-hidden min-h-0">
        <div className="flex flex-col items-center gap-3 min-h-0 flex-1 overflow-y-auto md:overflow-hidden">
          <div className="relative w-full max-w-md aspect-video bg-black border-2 border-magenta shadow-brutal overflow-hidden shrink-0">
            {/* Main box: stranger when connected, otherwise the host's own
                camera — a single element whose srcObject is re-pointed,
                never swapped for a different DOM node. */}
            <video
              ref={mainVideoRef}
              autoPlay
              playsInline
              muted={!showingStranger}
              className={`w-full h-full object-cover ${showingStranger ? "" : "-scale-x-100"}`}
            />

            {/* Self PIP: always mounted, shown only once a stranger takes
                over the main box. */}
            <video
              ref={pipVideoRef}
              autoPlay
              playsInline
              muted
              className={`absolute bottom-2 right-2 w-20 h-16 sm:w-28 sm:h-20 object-cover border-2 border-lime shadow-brutal-sm -scale-x-100 ${
                showingStranger ? "block" : "hidden"
              }`}
            />

            {!localStream && !remoteStream && (
              <div className="absolute inset-0 flex items-center justify-center text-gray-500 text-sm font-mono">
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

            {liveId &&
              (commentsEnabled ? (
                <CommentsOverlay comments={comments} onSend={() => {}} disabled />
              ) : (
                <div className="absolute left-2 bottom-3 text-[10px] font-mono text-gray-400 bg-black/60 px-2 py-1">
                  comments hidden from viewers
                </div>
              ))}

            {liveId && (
              <div className="absolute right-2 bottom-16">
                <HeartReaction count={reactionCount} onReact={() => {}} />
              </div>
            )}
          </div>

          {mediaError && <p className="text-magenta text-xs shrink-0">Camera/mic error: {mediaError}</p>}

          {state === "idle" && (
            <div className="flex flex-col items-center gap-3 shrink-0">
              <p className="text-xs text-gray-400 font-mono max-w-xs text-center">
                You'll be paired with a random stranger, and your call goes on the live feed for others to watch.
              </p>
              <BrutalButton onClick={handleStart}>Start Live</BrutalButton>
            </div>
          )}

          {state === "queued" && (
            <div className="shrink-0">
              <TerminalLoader countryCode={profile.country_code} />
            </div>
          )}

          {state === "matched" && matchId && (
            <div className="w-full max-w-md shrink-0">
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
            </div>
          )}
        </div>

        {/* Desktop chat side panel — permanently visible once matched,
            exactly mirroring MatchScreen's layout so the host can talk to
            the stranger while the stream keeps running. */}
        {chatAvailable && (
          <div className="hidden md:flex md:flex-col md:w-80 md:h-full min-h-0 gap-2">
            <p className="text-[11px] font-mono text-lime uppercase shrink-0">chat with stranger</p>
            <div className="flex-1 min-h-0">
              <ChatPanel key={matchId} matchId={matchId!} selfId={selfId!} />
            </div>
          </div>
        )}
      </main>

      {/* Mobile chat drawer — same ChatPanel, slid up from the bottom so it
          never has to share screen space with the video while closed. */}
      {chatAvailable && chatOpen && (
        <div
          className="md:hidden fixed inset-0 z-50 bg-black/70 flex flex-col justify-end"
          onClick={() => setChatOpen(false)}
        >
          <div
            className="h-[70dvh] bg-charcoal border-t-2 border-lime flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-3 py-2 border-b-2 border-lime shrink-0">
              <span className="text-xs font-mono text-lime uppercase">chat with stranger</span>
              <button onClick={() => setChatOpen(false)} className="text-xs text-gray-400 font-mono underline">
                close
              </button>
            </div>
            <div className="flex-1 min-h-0">
              <ChatPanel key={matchId} matchId={matchId!} selfId={selfId!} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
