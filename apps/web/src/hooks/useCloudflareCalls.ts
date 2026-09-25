import { useCallback, useEffect, useRef, useState } from "react";
import { supabase, apiBaseUrl } from "../lib/supabase";

type CallState = "idle" | "connecting" | "connected" | "failed" | "ended";

interface SignalPayload {
  sessionId: string;
  trackName: string;
}

/**
 * Establishes a video/audio call over Cloudflare Calls (a WebRTC SFU) between
 * two matched users. Cloudflare's App Secret never reaches the browser — all
 * session/track API calls go through the backend proxy in
 * apps/api/src/routes/calls.ts, authenticated with the caller's own JWT and
 * checked against active match participancy on every call.
 *
 * Signaling (exchanging each side's Cloudflare sessionId + trackName so the
 * other side knows what to *pull*) happens over a Supabase Realtime
 * Broadcast channel scoped to `match:{matchId}`, which only the two match
 * participants ever join.
 */
export function useCloudflareCalls(matchId: string | null, localStream: MediaStream | null) {
  const [callState, setCallState] = useState<CallState>("idle");
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localSessionIdRef = useRef<string | null>(null);
  const localTrackNameRef = useRef<string | null>(null);

  const authedFetch = useCallback(async (path: string, body: unknown, method = "POST") => {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    const res = await fetch(`${apiBaseUrl}${path}`, {
      method,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`calls_request_failed:${res.status}`);
    return res.json();
  }, []);

  useEffect(() => {
    if (!matchId || !localStream) return;
    let cancelled = false;
    const signalChannel = supabase.channel(`match:${matchId}`, { config: { broadcast: { self: false } } });

    async function connect() {
      setCallState("connecting");
      try {
        const pc = new RTCPeerConnection();
        pcRef.current = pc;

        pc.ontrack = (event) => {
          setRemoteStream(event.streams[0] ?? null);
        };
        pc.onconnectionstatechange = () => {
          if (pc.connectionState === "connected") setCallState("connected");
          if (pc.connectionState === "failed") setCallState("failed");
        };

        localStream!.getTracks().forEach((track) => pc.addTransceiver(track, { direction: "sendonly" }));

        const { sessionId } = await authedFetch("/api/calls/session/new", { matchId });
        localSessionIdRef.current = sessionId;

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);

        const trackName = `track-${crypto.randomUUID()}`;
        localTrackNameRef.current = trackName;

        const pushResult = await authedFetch("/api/calls/tracks/push", {
          matchId,
          sessionId,
          tracks: [{ location: "local", trackName, mid: pc.getTransceivers()[0]?.mid ?? "0" }],
          sessionDescription: { type: "offer", sdp: offer.sdp },
        });

        await pc.setRemoteDescription(new RTCSessionDescription(pushResult.sessionDescription));

        if (cancelled) return;

        // Tell the other participant how to find our published track.
        await signalChannel.send({
          type: "broadcast",
          event: "session-info",
          payload: { sessionId, trackName } satisfies SignalPayload,
        });
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error("cloudflare_calls_connect_failed", err);
        setCallState("failed");
      }
    }

    async function pullPartnerTrack(partner: SignalPayload) {
      const pc = pcRef.current;
      const sessionId = localSessionIdRef.current;
      if (!pc || !sessionId) return;
      try {
        const pullResult = await authedFetch("/api/calls/tracks/pull", {
          matchId,
          sessionId,
          tracks: [{ location: "remote", sessionId: partner.sessionId, trackName: partner.trackName }],
        });

        if (pullResult.requiresImmediateRenegotiation) {
          await pc.setRemoteDescription(new RTCSessionDescription(pullResult.sessionDescription));
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          await authedFetch(
            "/api/calls/renegotiate",
            { matchId, sessionId, sessionDescription: { type: "answer", sdp: answer.sdp } },
            "PUT"
          );
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error("cloudflare_calls_pull_failed", err);
      }
    }

    signalChannel
      .on("broadcast", { event: "session-info" }, ({ payload }) => pullPartnerTrack(payload as SignalPayload))
      .subscribe((status) => {
        if (status === "SUBSCRIBED") connect();
      });

    return () => {
      cancelled = true;
      signalChannel.unsubscribe();
      pcRef.current?.close();
      pcRef.current = null;
      setRemoteStream(null);
      setCallState("ended");
    };
  }, [matchId, localStream, authedFetch]);

  return { callState, remoteStream };
}
