import { useEffect, useRef, useState } from "react";
import { supabase, apiBaseUrl } from "../lib/supabase";

type CallState = "idle" | "connecting" | "connected" | "failed" | "ended";

interface TrackInfo {
  trackName: string;
  kind: "audio" | "video";
}
interface SignalPayload {
  sessionId: string;
  tracks: TrackInfo[];
}

/**
 * Read-only counterpart to useCloudflareCalls/useSoloLiveBroadcast: a live
 * viewer never pushes local tracks, only pulls whatever the broadcaster
 * side announces. Which side that is depends on the stream's mode:
 *   - "random": the same `match:{matchId}` Supabase Broadcast channel the
 *     two real call participants use, so there can be up to two remote
 *     streams (broadcaster + partner).
 *   - "solo": the `live:{liveId}` channel used by useSoloLiveBroadcast,
 *     with exactly one remote stream (just the host).
 * Either way, tracks are pulled through apps/api/src/routes/live.ts's
 * viewer-scoped `/calls/*` proxy.
 *
 * Pulls are done strictly one at a time, in arrival order — after each
 * pull's renegotiation settles, whatever transceivers are new on the
 * PeerConnection belong to that peer, which is how each announcement ends
 * up as its own entry in `remoteStreams` without needing to know which
 * peer is the broadcaster vs. the stranger (the UI doesn't need to know —
 * it just renders "the video container", same as a normal 1:1 call).
 */
export function useLiveViewerCalls(
  liveId: string | null,
  matchId: string | null,
  mode: "random" | "solo",
  active: boolean
) {
  const [callState, setCallState] = useState<CallState>("idle");
  const [remoteStreams, setRemoteStreams] = useState<MediaStream[]>([]);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localSessionIdRef = useRef<string | null>(null);
  const claimedTrackIdsRef = useRef<Set<string>>(new Set());
  const pulledKeysRef = useRef<Set<string>>(new Set());
  const pullChainRef = useRef<Promise<void>>(Promise.resolve());

  const authedFetch = useRef(async (path: string, body?: unknown, method = "POST") => {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    const res = await fetch(`${apiBaseUrl}${path}`, {
      method,
      headers: { ...(body !== undefined ? { "Content-Type": "application/json" } : {}), Authorization: `Bearer ${token}` },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    if (!res.ok) throw new Error(`live_calls_request_failed:${res.status}`);
    return res.json();
  }).current;

  useEffect(() => {
    if (!active || !liveId) return;
    if (mode === "random" && !matchId) return; // random-mode viewers need a match to signal against; solo doesn't
    let cancelled = false;
    claimedTrackIdsRef.current = new Set();
    pulledKeysRef.current = new Set();
    pullChainRef.current = Promise.resolve();

    const channelTopic = mode === "solo" ? `live:${liveId}` : `match:${matchId}`;
    const signalChannel = supabase.channel(channelTopic, {
      config: { broadcast: { self: false, ack: true } },
    });

    function snapshotNewStream() {
      const pc = pcRef.current;
      if (!pc) return;
      const tracks = pc
        .getTransceivers()
        .map((t) => t.receiver.track)
        .filter((track): track is MediaStreamTrack => !!track && !claimedTrackIdsRef.current.has(track.id));
      if (tracks.length === 0) return;
      tracks.forEach((t) => claimedTrackIdsRef.current.add(t.id));
      const stream = new MediaStream(tracks);
      setRemoteStreams((prev) => [...prev, stream]);
    }

    async function pullPeer(peer: SignalPayload) {
      const pc = pcRef.current;
      const sessionId = localSessionIdRef.current;
      if (!pc || !sessionId || peer.tracks.length === 0) return;

      const key = `${peer.sessionId}:${peer.tracks.map((t) => t.trackName).sort().join(",")}`;
      if (pulledKeysRef.current.has(key)) return;

      try {
        const pullResult = await authedFetch(`/api/live/${liveId}/calls/tracks/pull`, {
          sessionId,
          tracks: peer.tracks.map((t) => ({
            location: "remote" as const,
            sessionId: peer.sessionId,
            trackName: t.trackName,
          })),
        });

        if (pullResult.requiresImmediateRenegotiation) {
          if (pc.signalingState !== "stable") return;
          await pc.setRemoteDescription(new RTCSessionDescription(pullResult.sessionDescription));
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          await authedFetch(
            `/api/live/${liveId}/calls/renegotiate`,
            { sessionId, sessionDescription: { type: "answer", sdp: answer.sdp } },
            "PUT"
          );
        }

        pulledKeysRef.current.add(key);
        snapshotNewStream();
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error("live_viewer_pull_failed", err);
      }
    }

    // Serialize pulls across peers (and duplicate announcements of the same
    // peer) so a snapshot never straddles two in-flight negotiations.
    function queuePull(peer: SignalPayload) {
      pullChainRef.current = pullChainRef.current.then(() => pullPeer(peer));
    }

    async function connect() {
      setCallState("connecting");
      try {
        const { iceServers } = await authedFetch("/api/turn-credentials", undefined, "GET");
        const pc = new RTCPeerConnection({ iceServers });
        pcRef.current = pc;

        pc.ontrack = () => {
          // Individual track arrival is handled via snapshotNewStream()
          // right after each pull's renegotiation settles, not here — by
          // the time `ontrack` fires the transceiver list is already what
          // we read there.
        };
        pc.onconnectionstatechange = () => {
          if (pc.connectionState === "connected") setCallState("connected");
          if (pc.connectionState === "failed") setCallState("failed");
        };

        const { sessionId } = await authedFetch(`/api/live/${liveId}/calls/session/new`);
        localSessionIdRef.current = sessionId;

        if (cancelled) return;
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error("live_viewer_connect_failed", err);
        setCallState("failed");
      }
    }

    signalChannel
      .on("broadcast", { event: "session-info" }, ({ payload }) => queuePull(payload as SignalPayload))
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          connect().then(() => {
            if (cancelled) return;
            // We never announce (viewers don't publish), but do ask both
            // real participants to (re-)send their session-info in case
            // they already announced before we subscribed.
            signalChannel.send({ type: "broadcast", event: "request-session-info", payload: {} });
          });
        }
      });

    return () => {
      cancelled = true;
      signalChannel.unsubscribe();
      pcRef.current?.close();
      pcRef.current = null;
      setRemoteStreams([]);
      setCallState("ended");
    };
  }, [active, liveId, matchId, mode, authedFetch]);

  return { callState, remoteStreams };
}
