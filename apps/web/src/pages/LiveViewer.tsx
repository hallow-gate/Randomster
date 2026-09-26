import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useAuthContext } from "../hooks/AuthProvider";
import { useLiveViewerCalls } from "../hooks/useLiveViewerCalls";
import { CommentsOverlay, type LiveComment } from "../components/CommentsOverlay";
import { HeartReaction } from "../components/HeartReaction";
import { BrutalButton } from "../components/BrutalButton";
import { supabase, apiBaseUrl } from "../lib/supabase";

const REPORT_REASONS = [
  { value: "nudity_sexual_content", label: "Nudity / sexual content" },
  { value: "minor_suspected", label: "I think this is a minor" },
  { value: "harassment", label: "Harassment" },
  { value: "violence_threats", label: "Violence / threats" },
  { value: "spam", label: "Spam" },
  { value: "csam_suspected", label: "Child exploitation" },
  { value: "other", label: "Other" },
] as const;

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

export default function LiveViewer() {
  const { id } = useParams<{ id: string }>();
  const { session } = useAuthContext();
  const navigate = useNavigate();

  const [matchId, setMatchId] = useState<string | null>(null);
  const [broadcasterUsername, setBroadcasterUsername] = useState<string | null>(null);
  const [partnerUsername, setPartnerUsername] = useState<string | null>(null);
  const [viewerCount, setViewerCount] = useState(0);
  const [reactionCount, setReactionCount] = useState(0);
  const [comments, setComments] = useState<LiveComment[]>([]);
  const [commentsEnabled, setCommentsEnabled] = useState(true);
  const [ended, setEnded] = useState(false);
  const [joinFailed, setJoinFailed] = useState(false);
  const [viewersOpen, setViewersOpen] = useState(false);
  const [viewers, setViewers] = useState<{ user_id: string; username: string }[]>([]);
  const [reportOpen, setReportOpen] = useState(false);
  const [reported, setReported] = useState(false);
  const lastCommentAtRef = useRef<string | null>(null);

  const { callState, remoteStreams } = useLiveViewerCalls(id ?? null, matchId, !!matchId && !ended);
  const primaryRef = useRef<HTMLVideoElement>(null);
  const secondaryRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (primaryRef.current) primaryRef.current.srcObject = remoteStreams[0] ?? null;
  }, [remoteStreams]);
  useEffect(() => {
    if (secondaryRef.current) secondaryRef.current.srcObject = remoteStreams[1] ?? null;
  }, [remoteStreams]);

  // Join on mount, leave on unmount.
  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    authedFetch(`/api/live/${id}/join`)
      .then((data) => {
        if (cancelled) return;
        setMatchId(data.matchId);
        setBroadcasterUsername(data.broadcasterUsername);
        setPartnerUsername(data.partnerUsername);
        setViewerCount(data.viewerCount);
        setReactionCount(data.reactionCount);
        setComments(data.comments ?? []);
        setCommentsEnabled(data.commentsEnabled ?? true);
        if (data.comments?.length) lastCommentAtRef.current = data.comments[data.comments.length - 1].created_at;
      })
      .catch(() => !cancelled && setJoinFailed(true));

    return () => {
      cancelled = true;
      if (id) authedFetch(`/api/live/${id}/leave`).catch(() => {});
    };
  }, [id]);

  // Poll for state.
  useEffect(() => {
    if (!id || ended || joinFailed) return;
    let cancelled = false;
    async function poll() {
      try {
        const q = lastCommentAtRef.current ? `?after=${encodeURIComponent(lastCommentAtRef.current)}` : "";
        const data = await authedFetch(`/api/live/${id}/state${q}`, undefined, "GET");
        if (cancelled) return;
        if (data.ended) {
          setEnded(true);
          return;
        }
        setViewerCount(data.viewerCount);
        setReactionCount(data.reactionCount);
        setCommentsEnabled(data.commentsEnabled ?? true);
        setMatchId(data.matchId ?? null);
        setPartnerUsername(data.partnerUsername ?? null);
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
  }, [id, ended, joinFailed]);

  const refreshViewers = async () => {
    if (!id) return;
    const data = await authedFetch(`/api/live/${id}/viewers`, undefined, "GET");
    setViewers(data.viewers);
  };

  const sendComment = (text: string) => {
    if (!id) return;
    authedFetch(`/api/live/${id}/comment`, { text }).catch(() => {});
    // Optimistic echo — the poll will dedupe naturally since it only fetches "after" the last seen timestamp.
    setComments((prev) => [
      ...prev,
      { id: crypto.randomUUID(), user_id: session!.user.id, username: "you", text, created_at: new Date().toISOString() },
    ]);
  };

  const react = () => {
    if (!id) return;
    authedFetch(`/api/live/${id}/react`)
      .then((data) => setReactionCount(data.reactionCount))
      .catch(() => {});
  };

  const submitReport = async (reason: string) => {
    if (!id) return;
    await authedFetch(`/api/live/${id}/report`, { reason }).catch(() => {});
    setReported(true);
    setReportOpen(false);
  };

  if (joinFailed || ended) {
    return (
      <div className="h-dvh flex flex-col items-center justify-center gap-4 bg-charcoal">
        <p className="text-gray-400 font-mono text-sm">
          {ended ? "This stream just ended." : "This stream isn't live anymore."}
        </p>
        <BrutalButton onClick={() => navigate("/live")}>Back to Live</BrutalButton>
      </div>
    );
  }

  return (
    <div className="h-dvh flex flex-col overflow-hidden bg-charcoal text-white">
      <header className="shrink-0 flex items-center justify-between gap-2 px-3 sm:px-4 py-3 border-b-2 border-black bg-black/40">
        <button
          onClick={() => navigate("/live")}
          className="font-mono text-[11px] text-cyan border border-cyan/40 px-2 py-1 hover:bg-cyan/10 shrink-0"
        >
          ← back
        </button>

        <div className="flex items-center gap-2 font-mono text-xs text-gray-300 min-w-0 justify-center flex-1">
          <span className="text-lime truncate">@{broadcasterUsername}</span>
          {partnerUsername && <span className="text-gray-500 truncate">+ @{partnerUsername}</span>}
        </div>

        <button
          onClick={() => {
            setViewersOpen((v) => !v);
            if (!viewersOpen) refreshViewers();
          }}
          className={`font-mono text-[11px] px-2 py-1 border shrink-0 ${
            viewersOpen ? "text-black bg-cyan border-black" : "text-cyan border-cyan/40 hover:bg-cyan/10"
          }`}
        >
          👁 {viewerCount}
        </button>
      </header>

      <main className="flex-1 flex items-center justify-center p-3 sm:p-4 overflow-hidden">
        <div className="relative w-full max-w-md aspect-video bg-black border-2 border-magenta shadow-brutal overflow-hidden">
          <video ref={primaryRef} autoPlay playsInline className="w-full h-full object-cover -scale-x-100" />
          {!matchId && (
            <div className="absolute inset-0 flex items-center justify-center text-cyan text-sm font-mono bg-black/60 text-center px-4">
              @{broadcasterUsername} is looking for the next stranger...
            </div>
          )}
          {matchId && callState !== "connected" && (
            <div className="absolute inset-0 flex items-center justify-center text-cyan text-sm font-mono bg-black/60">
              connecting to stream...
            </div>
          )}
          <video
            ref={secondaryRef}
            autoPlay
            playsInline
            className="absolute bottom-2 right-2 w-20 h-16 sm:w-28 sm:h-20 object-cover border-2 border-lime shadow-brutal-sm -scale-x-100"
          />

          <div className="absolute top-2 left-2 flex items-center gap-1 bg-magenta text-black text-[10px] font-display font-bold uppercase px-1.5 py-0.5 border border-black">
            ● Live
          </div>

          {commentsEnabled ? (
            <CommentsOverlay comments={comments} onSend={sendComment} />
          ) : (
            <div className="absolute left-2 bottom-16 text-[10px] font-mono text-gray-400 bg-black/60 px-2 py-1">
              comments are off
            </div>
          )}

          <div className="absolute right-2 bottom-16 flex flex-col items-center gap-2">
            <HeartReaction count={reactionCount} onReact={react} />
            <button
              onClick={() => setReportOpen(true)}
              className="text-[10px] font-mono text-gray-300 bg-black/60 px-2 py-1 underline"
            >
              report
            </button>
          </div>

          {viewersOpen && (
            <div className="absolute top-2 right-2 w-40 max-h-48 overflow-y-auto bg-black/85 border-2 border-cyan p-2 text-[11px] font-mono text-white">
              {viewers.length === 0 && <p className="text-gray-500">no other viewers yet</p>}
              {viewers.map((v) => (
                <p key={v.user_id} className="truncate">
                  @{v.username}
                </p>
              ))}
            </div>
          )}

          {reportOpen && (
            <div className="absolute inset-0 bg-black/85 flex flex-col items-center justify-center gap-2 p-4 text-center">
              <p className="text-white text-xs font-mono mb-1">Report this live stream</p>
              {REPORT_REASONS.map((r) => (
                <button
                  key={r.value}
                  onClick={() => submitReport(r.value)}
                  className="w-full max-w-xs bg-charcoal border-2 border-magenta text-white text-xs font-mono py-1.5"
                >
                  {r.label}
                </button>
              ))}
              <button onClick={() => setReportOpen(false)} className="text-xs text-gray-400 underline mt-1">
                cancel
              </button>
            </div>
          )}

          {reported && (
            <div className="absolute inset-x-0 bottom-0 bg-magenta text-black text-xs font-mono text-center py-1">
              Reported. Thanks for flagging this.
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
