import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuthContext } from "../hooks/AuthProvider";
import { useMatchmaking } from "../hooks/useMatchmaking";
import { useLocalMedia } from "../hooks/useLocalMedia";
import { useCloudflareCalls } from "../hooks/useCloudflareCalls";
import { useSoloLiveBroadcast } from "../hooks/useSoloLiveBroadcast";
import { useSoundEffects } from "../hooks/useSoundEffects";
import { BrutalButton } from "../components/BrutalButton";
import { TerminalLoader } from "../components/TerminalLoader";
import { ControlDock } from "../components/ControlDock";
import { CommentsOverlay, type LiveComment } from "../components/CommentsOverlay";
import { HeartReaction } from "../components/HeartReaction";
import { ChatPanel } from "../components/ChatPanel";
import { GoLiveSetup } from "../components/GoLiveSetup";
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
 * Goes live one of two ways, chosen up front in <GoLiveSetup>:
 *   - "random": the exact same random-matchmaking + 1:1 Cloudflare Calls
 *     flow as MatchScreen (see hooks/useMatchmaking, useCloudflareCalls),
 *     wrapped in a live_sessions row (Neon) so an audience can watch.
 *   - "solo": just the host's own camera, published via
 *     hooks/useSoloLiveBroadcast — no matchmaking, no partner, no
 *     skip/next/report/block, and no private stranger-chat panel.
 *
 * For "random", the live stream and the current match are two different
 * lifetimes: hitting Next, or the stranger skipping/blocking/reporting the
 * host, ends the match but never the stream — the host's own camera stays
 * up and the same live_session (comments, reactions, viewer count) just
 * gets re-partnered once a new match is found. Only "End Live" ends the
 * stream itself, in either mode.
 */
export default function LiveBroadcast() {
  const { session, profile } = useAuthContext();
  const selfId = session?.user.id;
  const navigate = useNavigate();
  const sound = useSoundEffects();

  const [mode, setMode] = useState<"random" | "solo" | null>(null);
  const { state: matchState, matchId, join, skip, next, report, block, resetAfterEnd } = useMatchmaking(selfId);

  // The host's own camera has nothing to do with which mode was chosen, or
  // whether a stranger is currently connected — it's on for the whole time
  // they're on this page, exactly like a real live host sees themselves
  // before anyone joins.
  const { stream: localStream, micMuted, camOff, toggleMic, toggleCam, error: mediaError } = useLocalMedia(true);

  const [liveId, setLiveId] = useState<string | null>(null);

  // Both call hooks are always instantiated (hooks can't be conditional),
  // but only the one matching the chosen mode ever receives real
  // arguments — the other is fed `null` and stays a no-op.
  const { callState: randomCallState, remoteStream } = useCloudflareCalls(
    mode === "random" ? matchId : null,
    localStream
  );
  const { callState: soloCallState } = useSoloLiveBroadcast(mode === "solo" ? liveId : null, localStream);
  const callState = mode === "solo" ? soloCallState : randomCallState;

  // Both video elements stay mounted for the whole lifetime of the page —
  // never conditionally added/removed from the tree. Only *which stream*
  // they show, and whether the PIP is visible, changes. A `<video>` that
  // gets unmounted and a fresh one mounted in its place (e.g. by swapping
  // between "big local view" and "small local PIP" in a ternary) never
  // gets `srcObject` re-applied unless the *stream itself* changes — and
  // the host's own camera stream doesn't change on Next/matched/unmatched,
  // only which box it should appear in does. Keeping one stable element
  // per role and re-pointing its `srcObject` whenever either stream
  // changes sidesteps that entirely.
  const mainVideoRef = useRef<HTMLVideoElement>(null);
  const pipVideoRef = useRef<HTMLVideoElement>(null);

  // Supabase reuses the same underlying channel object for two calls to
  // `supabase.channel(sameTopic)` -- so if a desktop chat panel and a
  // mobile chat drawer both rendered a <ChatPanel> for the same match at
  // once (one merely hidden with CSS, but still mounted), the second one's
  // `.subscribe()` call throws and crashes the page. Tracking the viewport
  // in JS instead of hiding-with-CSS means exactly one <ChatPanel> is ever
  // mounted at a time -- as the sidebar on desktop, or in the drawer on
  // mobile, never both.
  const [isDesktop, setIsDesktop] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(min-width: 768px)").matches
  );
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 768px)");
    const onChange = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const [viewerCount, setViewerCount] = useState(0);
  const [reactionCount, setReactionCount] = useState(0);
  const [comments, setComments] = useState<LiveComment[]>([]);

  // Two SEPARATE toggles, both host-controlled but doing very different
  // things (this used to be a single flag, which is why "hide/show
  // comments" felt broken — toggling it changed both things you'd want
  // independently):
  //   - hostCommentsVisible: purely local, personal, never touches the
  //     server. Just collapses the overlay on the HOST's own screen so it
  //     doesn't clutter their view. Instant, never reverts, doesn't affect
  //     viewers at all.
  //   - commentsEnabled: the server-side, shared setting. Off means
  //     viewers literally cannot submit a new comment (enforced in
  //     routes/live.ts). The host can still see whatever comments already
  //     came in (if hostCommentsVisible is on) even while this is off.
  const [hostCommentsVisible, setHostCommentsVisible] = useState(true);
  const [commentsEnabled, setCommentsEnabled] = useState(true);
  const [commentsBusy, setCommentsBusy] = useState(false);
  const lastCommentsToggleAtRef = useRef<number>(0);

  const [caption, setCaption] = useState("");
  const [captionDraft, setCaptionDraft] = useState("");
  const [editingCaption, setEditingCaption] = useState(false);
  const [captionSaving, setCaptionSaving] = useState(false);

  const [chatOpen, setChatOpen] = useState(false);
  const lastCommentAtRef = useRef<string | null>(null);
  const liveIdRef = useRef<string | null>(null);
  const startedMatchIdRef = useRef<string | null>(null);
  const endingRef = useRef(false);

  useEffect(() => {
    liveIdRef.current = liveId;
  }, [liveId]);

  // Main box: show the stranger once connected (random mode only),
  // otherwise fall back to the host's own camera so the box is never empty
  // while waiting/searching, or for the whole duration of a solo stream.
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
    if (mode === "random" && matchState === "matched") sound.play("connect");
    if (mode === "random" && matchState === "ended") sound.play("disconnect");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, matchState]);

  const clearPartner = useCallback(async () => {
    if (!liveIdRef.current) return;
    await authedFetch(`/api/live/${liveIdRef.current}/clear-partner`).catch(() => {});
    startedMatchIdRef.current = null;
  }, []);

  // Random mode: start (or re-partner) the live session whenever we land
  // on a fresh match.
  useEffect(() => {
    if (mode === "random" && matchState === "matched" && matchId && startedMatchIdRef.current !== matchId) {
      startedMatchIdRef.current = matchId;
      authedFetch("/api/live/start", { matchId, mode: "random", caption })
        .then((data) => setLiveId(data.id))
        .catch(() => {
          startedMatchIdRef.current = null;
        });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, matchState, matchId]);

  // Random mode: the stranger left (skip/block/report/moderation) — clear
  // the stale partner so viewers see "waiting for next stranger" instead
  // of a frozen video, then automatically go straight back into the queue.
  // The stream itself is untouched.
  useEffect(() => {
    if (mode !== "random" || matchState !== "ended" || endingRef.current || !profile) return;
    setChatOpen(false);
    (async () => {
      await clearPartner();
      resetAfterEnd();
      join(profile.match_scope);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, matchState]);

  // Poll for viewer count / reaction total / new comments / re-partner
  // info while live, independent of mode or whether a stranger is
  // currently connected.
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
        // See toggleComments() below -- don't let a poll that raced a
        // fresh local toggle stomp it with a stale server value.
        if (Date.now() - lastCommentsToggleAtRef.current > 4000) {
          setCommentsEnabled(data.commentsEnabled);
        }
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

  // Leave the live session if the host just closes the tab / navigates
  // away without pressing "End Live".
  useEffect(() => {
    return () => {
      if (liveIdRef.current) authedFetch(`/api/live/${liveIdRef.current}/end`).catch(() => {});
    };
  }, []);

  if (!session || !profile) return null;

  const handleSetupConfirm = async (chosenMode: "random" | "solo", chosenCaption: string) => {
    sound.play("click");
    setMode(chosenMode);
    setCaption(chosenCaption);
    setCaptionDraft(chosenCaption);
    if (chosenMode === "random") {
      join(profile.match_scope);
    } else {
      try {
        const data = await authedFetch("/api/live/start", { mode: "solo", caption: chosenCaption });
        setLiveId(data.id);
      } catch {
        setMode(null); // let them retry the setup screen
      }
    }
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
    lastCommentsToggleAtRef.current = Date.now();
    try {
      const result = await authedFetch(`/api/live/${liveId}/comments-enabled`, { enabled }, "PATCH");
      setCommentsEnabled(result.commentsEnabled);
    } catch {
      setCommentsEnabled(!enabled); // revert on failure
    } finally {
      setCommentsBusy(false);
    }
  };

  const saveCaption = async () => {
    if (!liveId) return;
    const trimmed = captionDraft.trim();
    setCaptionSaving(true);
    try {
      const result = await authedFetch(`/api/live/${liveId}/caption`, { caption: trimmed || null }, "PATCH");
      setCaption(result.caption ?? "");
      setEditingCaption(false);
    } catch {
      // leave the editor open so they can retry
    } finally {
      setCaptionSaving(false);
    }
  };

  const handleEndLive = async () => {
    endingRef.current = true;
    if (liveId) await authedFetch(`/api/live/${liveId}/end`).catch(() => {});
    if (mode === "random" && matchId) await skip().catch(() => {});
    navigate("/live");
  };

  const searching = mode === "random" && matchState === "queued";
  const showingStranger = mode === "random" && !!remoteStream;
  const chatAvailable = mode === "random" && matchState === "matched" && !!matchId && !!selfId;

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
          {mode && (
            <span className="font-mono text-[10px] text-gray-400 border border-gray-600 px-1.5 py-1 hidden sm:inline">
              {mode === "solo" ? "🎥 solo" : "🎲 random"}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {liveId && (
            <span className="font-mono text-[11px] text-cyan bg-black/50 px-2 py-1 border border-cyan/40">
              👁 {viewerCount}
            </span>
          )}
          {liveId && (
            <button
              onClick={() => setHostCommentsVisible((v) => !v)}
              title={hostCommentsVisible ? "Hide comments from your own view" : "Show comments on your own view"}
              aria-label={hostCommentsVisible ? "Hide comments from your own view" : "Show comments on your own view"}
              className={`font-mono text-[11px] px-2 py-1 border transition-colors flex items-center gap-1 ${
                hostCommentsVisible
                  ? "text-lime border-lime/40 hover:bg-lime/10"
                  : "text-gray-400 border-gray-600 hover:bg-white/5"
              }`}
            >
              <span>👁</span>
              <span className="hidden sm:inline">{hostCommentsVisible ? "Shown" : "Hidden"}</span>
            </button>
          )}
          {liveId && (
            <button
              onClick={toggleComments}
              disabled={commentsBusy}
              title={commentsEnabled ? "Viewers can comment — tap to turn off" : "Viewers can't comment — tap to turn on"}
              aria-label={commentsEnabled ? "Turn off viewer comments" : "Turn on viewer comments"}
              className={`font-mono text-[11px] px-2 py-1 border transition-colors disabled:opacity-50 flex items-center gap-1 ${
                commentsEnabled
                  ? "text-cyan border-cyan/40 hover:bg-cyan/10"
                  : "text-gray-400 border-gray-600 hover:bg-white/5"
              }`}
            >
              <span>{commentsEnabled ? "💬" : "🚫"}</span>
              <span className="hidden sm:inline">{commentsEnabled ? "On" : "Off"}</span>
            </button>
          )}
          {chatAvailable && !isDesktop && (
            <button
              onClick={() => setChatOpen((v) => !v)}
              title="Chat with the stranger"
              aria-label="Chat with the stranger"
              className={`font-mono text-[11px] px-2 py-1 border transition-colors flex items-center gap-1 ${
                chatOpen ? "text-black bg-lime border-black" : "text-lime border-lime/40 hover:bg-lime/10"
              }`}
            >
              <span>💬</span>
              <span className="hidden sm:inline">Chat</span>
            </button>
          )}
          {liveId && (
            <button
              onClick={handleEndLive}
              className="font-mono text-[11px] text-black bg-red-400 hover:bg-red-300 active:translate-y-px px-2.5 py-1 border border-black uppercase font-bold transition-colors"
            >
              End
            </button>
          )}
        </div>
      </header>

      {/* ---------------------------------------------------------------- */}
      {/* Body: video + controls in the main column; on md+ screens random */}
      {/* mode's private stranger-chat gets its own permanent side panel    */}
      {/* (same idea as MatchScreen) instead of competing for space over   */}
      {/* the video with the public viewer comments.                      */}
      {/* ---------------------------------------------------------------- */}
      <main className="flex-1 flex flex-col md:flex-row gap-4 p-3 sm:p-4 overflow-hidden min-h-0">
        <div className="flex flex-col items-center gap-3 min-h-0 flex-1 overflow-y-auto md:overflow-hidden">
          <div className="relative w-full max-w-md flex-1 min-h-0 bg-black border-2 border-magenta shadow-brutal overflow-hidden">
            {!mode && <GoLiveSetup onConfirm={handleSetupConfirm} />}

            {/* Main box: stranger when connected (random mode), otherwise
                the host's own camera — a single element whose srcObject is
                re-pointed, never swapped for a different DOM node. Always
                mirrored (-scale-x-100), same convention as MatchScreen: the
                host's own camera is mirrored for a natural self-view, and
                the stranger's video is mirrored too so the host sees
                *exactly* what their viewers see (see LiveViewer below) —
                not a flipped version of it. */}
            <video
              ref={mainVideoRef}
              autoPlay
              playsInline
              muted={!showingStranger}
              className="w-full h-full object-cover -scale-x-100"
            />

            {/* Self PIP: always mounted, shown only once a stranger takes
                over the main box (random mode only — solo has no PIP,
                since the main box is already the host). */}
            <video
              ref={pipVideoRef}
              autoPlay
              playsInline
              muted
              className={`absolute bottom-2 right-2 w-20 h-16 sm:w-28 sm:h-20 object-cover border-2 border-lime shadow-brutal-sm -scale-x-100 ${
                showingStranger ? "block" : "hidden"
              }`}
            />

            {mode && !localStream && !remoteStream && (
              <div className="absolute inset-0 flex items-center justify-center text-gray-500 text-sm font-mono">
                starting camera...
              </div>
            )}
            {mode === "solo" && liveId && callState === "connecting" && (
              <div className="absolute inset-x-0 bottom-0 bg-black/70 text-cyan text-xs font-mono text-center py-1">
                going live...
              </div>
            )}
            {mode === "random" && matchState === "matched" && !remoteStream && callState === "connecting" && (
              <div className="absolute inset-0 flex items-center justify-center text-cyan text-sm font-mono bg-black/60">
                connecting stranger...
              </div>
            )}
            {searching && liveId && (
              <div className="absolute inset-x-0 bottom-0 bg-black/70 text-cyan text-xs font-mono text-center py-1">
                looking for the next stranger...
              </div>
            )}

            {mode && (
              <div className="absolute top-2 left-2 flex items-center gap-1 bg-magenta text-black text-[10px] font-display font-bold uppercase px-1.5 py-0.5 border border-black">
                ● Live
              </div>
            )}

            {/* Caption, host-editable in place. */}
            {liveId && !editingCaption && (
              <button
                onClick={() => {
                  setCaptionDraft(caption);
                  setEditingCaption(true);
                }}
                className="absolute top-2 right-2 max-w-[55%] text-[10px] font-mono text-white bg-black/60 px-2 py-1 text-right truncate hover:bg-black/80"
                title="Edit caption"
              >
                {caption ? caption : "+ add caption"}
              </button>
            )}
            {liveId && editingCaption && (
              <div className="absolute top-2 right-2 left-2 flex gap-1 bg-black/85 p-1.5 border border-cyan">
                <input
                  autoFocus
                  value={captionDraft}
                  onChange={(e) => setCaptionDraft(e.target.value.slice(0, 200))}
                  onKeyDown={(e) => e.key === "Enter" && saveCaption()}
                  placeholder="Add a caption..."
                  className="flex-1 bg-transparent text-white text-[11px] font-mono outline-none placeholder:text-gray-500"
                />
                <button
                  onClick={saveCaption}
                  disabled={captionSaving}
                  className="text-[10px] font-mono text-black bg-lime px-2 disabled:opacity-50"
                >
                  save
                </button>
                <button
                  onClick={() => setEditingCaption(false)}
                  className="text-[10px] font-mono text-gray-300 px-1"
                >
                  ✕
                </button>
              </div>
            )}

            {liveId &&
              (hostCommentsVisible ? (
                <CommentsOverlay comments={comments} onSend={() => {}} disabled placeholder="view only" />
              ) : (
                <div className="absolute left-2 bottom-3 text-[10px] font-mono text-gray-400 bg-black/60 px-2 py-1">
                  comments hidden from your view
                </div>
              ))}

            {liveId && (
              <div className="absolute right-2 bottom-16">
                <HeartReaction count={reactionCount} onReact={() => {}} />
              </div>
            )}
          </div>

          {mediaError && <p className="text-magenta text-xs shrink-0">Camera/mic error: {mediaError}</p>}

          {mode === "random" && matchState === "queued" && (
            <div className="shrink-0">
              <TerminalLoader countryCode={profile.country_code} />
            </div>
          )}

          {mode === "random" && matchState === "matched" && matchId && (
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

          {mode === "solo" && liveId && (
            <div className="flex items-center gap-3 shrink-0">
              <button
                onClick={toggleMic}
                className={`w-11 h-11 flex items-center justify-center border-2 border-black shadow-brutal-sm text-lg ${
                  micMuted ? "bg-red-400" : "bg-cyan"
                }`}
              >
                {micMuted ? "🔇" : "🎙"}
              </button>
              <button
                onClick={toggleCam}
                className={`w-11 h-11 flex items-center justify-center border-2 border-black shadow-brutal-sm text-lg ${
                  camOff ? "bg-red-400" : "bg-cyan"
                }`}
              >
                {camOff ? "📷" : "📹"}
              </button>
              <button
                onClick={sound.toggleMuted}
                className={`w-11 h-11 flex items-center justify-center border-2 border-black shadow-brutal-sm text-lg ${
                  sound.muted ? "bg-red-400" : "bg-cyan"
                }`}
              >
                {sound.muted ? "🔈" : "🔊"}
              </button>
            </div>
          )}
        </div>

        {/* Desktop chat side panel (random mode only) — permanently
            visible once matched, mirroring MatchScreen's layout. Only
            rendered on desktop (see isDesktop above) so it's never mounted
            alongside the mobile drawer's own <ChatPanel> for the same
            match. */}
        {chatAvailable && isDesktop && (
          <div className="flex flex-col md:w-80 md:h-full min-h-0 gap-2">
            <p className="text-[11px] font-mono text-lime uppercase shrink-0">chat with stranger</p>
            <div className="flex-1 min-h-0">
              <ChatPanel key={matchId} matchId={matchId!} selfId={selfId!} />
            </div>
          </div>
        )}
      </main>

      {/* Mobile chat drawer (random mode only) — same ChatPanel, slid up
          from the bottom. Only rendered when NOT on desktop, for the same
          reason as above. */}
      {chatAvailable && !isDesktop && chatOpen && (
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
