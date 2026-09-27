import { useCallback, useEffect, useRef, useState } from "react";
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
 * Solo live: the host publishes their own camera straight into a
 * live-session-scoped Cloudflare Calls session — there's no match and no
 * partner, so this doesn't go through useCloudflareCalls/routes/calls.ts at
 * all. Instead it pushes through routes/live.ts's broadcaster-scoped
 * `/:id/calls/tracks/push`, and announces its Cloudflare sessionId/track
 * names on a `live:{liveId}` Supabase Broadcast channel — the solo-mode
 * counterpart to the matched flow's `match:{matchId}` channel. Viewers pick
 * this same channel up in useLiveViewerCalls when a stream's mode is
 * "solo".
 *
 * There's no pulling here at all (the host has no remote peer to pull) —
 * this hook only ever publishes.
 */
export function useSoloLiveBroadcast(liveId: string | null, localStream: MediaStream | null) {
  const [callState, setCallState] = useState<CallState>("idle");
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localSessionIdRef = useRef<string | null>(null);
  const localTracksRef = useRef<TrackInfo[]>([]);
  const connectStartedRef = useRef(false);

  const authedFetch = useCallback(async (path: string, body?: unknown, method = "POST") => {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    const res = await fetch(`${apiBaseUrl}${path}`, {
      method,
      headers: {
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        Authorization: `Bearer ${token}`,
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    if (!res.ok) throw new Error(`solo_live_request_failed:${res.status}`);
    return res.json();
  }, []);

  useEffect(() => {
    if (!liveId || !localStream) return;
    let cancelled = false;
    connectStartedRef.current = false;

    const signalChannel = supabase.channel(`live:${liveId}`, {
      config: { broadcast: { self: false, ack: true } },
    });

    // Same "announce, and re-announce on request" pattern as
    // useCloudflareCalls -- a viewer that subscribes after we've already
    // announced would otherwise never learn how to pull us.
    async function announceSessionInfo() {
      const sessionId = localSessionIdRef.current;
      const tracks = localTracksRef.current;
      if (!sessionId || tracks.length === 0) return;
      await signalChannel.send({
        type: "broadcast",
        event: "session-info",
        payload: { sessionId, tracks } satisfies SignalPayload,
      });
    }

    async function connect() {
      if (connectStartedRef.current) return;
      connectStartedRef.current = true;

      setCallState("connecting");
      try {
        const { iceServers } = await authedFetch("/api/turn-credentials", undefined, "GET");
        const pc = new RTCPeerConnection({ iceServers });
        pcRef.current = pc;

        pc.onconnectionstatechange = () => {
          if (pc.connectionState === "connected") setCallState("connected");
          if (pc.connectionState === "failed") setCallState("failed");
        };

        localStream!.getTracks().forEach((track) => {
          if (track.kind === "video") track.contentHint = "motion";
          const transceiver = pc.addTransceiver(track, { direction: "sendonly" });
          if (track.kind === "video") {
            const params = transceiver.sender.getParameters();
            params.encodings = [{ maxBitrate: 1_500_000, priority: "high" }];
            transceiver.sender.setParameters(params).catch(() => {});
          }
        });

        const { sessionId } = await authedFetch(`/api/live/${liveId}/calls/session/new`);
        localSessionIdRef.current = sessionId;

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);

        const pushTracks: (TrackInfo & { mid?: string })[] = pc.getTransceivers().map((t) => ({
          trackName: `track-${t.sender.track?.kind ?? "unknown"}-${crypto.randomUUID()}`,
          kind: (t.sender.track?.kind ?? "audio") as "audio" | "video",
          mid: t.mid ?? undefined,
        }));
        localTracksRef.current = pushTracks.map(({ trackName, kind }) => ({ trackName, kind }));

        const pushResult = await authedFetch(`/api/live/${liveId}/calls/tracks/push`, {
          sessionId,
          tracks: pushTracks.map(({ trackName, mid }) => ({ location: "local" as const, trackName, mid })),
          sessionDescription: { type: "offer", sdp: offer.sdp },
        });
        await pc.setRemoteDescription(new RTCSessionDescription(pushResult.sessionDescription));

        if (cancelled) return;
        await announceSessionInfo();
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error("solo_live_connect_failed", err);
        setCallState("failed");
      }
    }

    signalChannel
      .on("broadcast", { event: "request-session-info" }, () => announceSessionInfo())
      .subscribe((status) => {
        if (status === "SUBSCRIBED") connect();
      });

    return () => {
      cancelled = true;
      signalChannel.unsubscribe();
      pcRef.current?.close();
      pcRef.current = null;
      setCallState("ended");
    };
  }, [liveId, localStream, authedFetch]);

  return { callState };
}
