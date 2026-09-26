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
 * Establishes a video/audio call over Cloudflare Calls (a WebRTC SFU) between
 * two matched users. Cloudflare's App Secret never reaches the browser — all
 * session/track API calls go through the backend proxy in
 * apps/api/src/routes/calls.ts, authenticated with the caller's own JWT and
 * checked against active match participancy on every call. The backend also
 * serializes push/pull/renegotiate calls per Cloudflare session, since that
 * session is a strict single-outstanding-negotiation state machine and
 * rejects a second concurrent call with `invalid_session_description`.
 *
 * Signaling (exchanging each side's Cloudflare sessionId + trackNames so the
 * other side knows what to *pull*) happens over a Supabase Realtime
 * Broadcast channel scoped to `match:{matchId}`, which only the two match
 * participants ever join.
 */
export function useCloudflareCalls(matchId: string | null, localStream: MediaStream | null) {
  const [callState, setCallState] = useState<CallState>("idle");
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localSessionIdRef = useRef<string | null>(null);
  const localTracksRef = useRef<TrackInfo[]>([]);
  const remoteMediaStreamRef = useRef<MediaStream | null>(null);
  const pulledPartnerKeyRef = useRef<string | null>(null);
  const pullInFlightRef = useRef<Promise<void> | null>(null);
  const connectStartedRef = useRef(false);
  const videoSenderRef = useRef<RTCRtpSender | null>(null);

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
    if (!res.ok) throw new Error(`calls_request_failed:${res.status}`);
    return res.json();
  }, []);

  useEffect(() => {
    if (!matchId || !localStream) return;
    let cancelled = false;
    let announced = false;
    pulledPartnerKeyRef.current = null;
    pullInFlightRef.current = null;
    connectStartedRef.current = false;
    remoteMediaStreamRef.current = null;

    const MIN_VIDEO_BITRATE = 500_000;
    const START_VIDEO_BITRATE = 1_500_000;
    const MAX_VIDEO_BITRATE = 3_500_000;
    let currentVideoBitrate = START_VIDEO_BITRATE;
    let adaptiveInterval: ReturnType<typeof setInterval> | null = null;

    // Picks a bitrate the connection can actually sustain right now,
    // instead of a single fixed number that's either too conservative on a
    // good connection or still too much on a bad one. Backs off hard and
    // fast on real loss (packet loss under load is usually already visible
    // as blockiness by the time you see it in stats), climbs back up slowly
    // and only when there's healthy bandwidth margin to spare, and stops
    // reacting to loss/RTT numbers from before the last change so it isn't
    // constantly chasing its own tail.
    function startAdaptiveBitrate(pc: RTCPeerConnection) {
      let lastPacketsSent = 0;
      let lastPacketsLost = 0;
      let settleUntil = 0;

      adaptiveInterval = setInterval(async () => {
        const sender = videoSenderRef.current;
        if (!sender || pc.connectionState !== "connected") return;

        const stats = await pc.getStats(sender.track ?? undefined).catch(() => null);
        if (!stats) return;

        let packetsSent = 0;
        let packetsLost = 0;
        let availableOutgoingBitrate: number | undefined;
        stats.forEach((report) => {
          if (report.type === "outbound-rtp" && report.kind === "video") {
            packetsSent = report.packetsSent ?? packetsSent;
          }
          if (report.type === "remote-inbound-rtp" && report.kind === "video") {
            packetsLost = report.packetsLost ?? packetsLost;
          }
          if (report.type === "candidate-pair" && report.state === "succeeded") {
            availableOutgoingBitrate = report.availableOutgoingBitrate ?? availableOutgoingBitrate;
          }
        });

        const sentDelta = packetsSent - lastPacketsSent;
        const lostDelta = packetsLost - lastPacketsLost;
        lastPacketsSent = packetsSent;
        lastPacketsLost = packetsLost;
        const lossRatio = sentDelta > 0 ? Math.max(0, lostDelta) / sentDelta : 0;

        const now = Date.now();
        let nextBitrate = currentVideoBitrate;
        if (lossRatio > 0.03) {
          nextBitrate = Math.max(MIN_VIDEO_BITRATE, Math.round(currentVideoBitrate * 0.7));
          settleUntil = now + 10_000; // give the drop time to actually help before reacting again
        } else if (
          now > settleUntil &&
          availableOutgoingBitrate &&
          availableOutgoingBitrate > currentVideoBitrate * 1.5
        ) {
          nextBitrate = Math.min(MAX_VIDEO_BITRATE, Math.round(currentVideoBitrate * 1.2));
          settleUntil = now + 10_000;
        }

        if (Math.abs(nextBitrate - currentVideoBitrate) < 100_000) return;
        currentVideoBitrate = nextBitrate;
        const params = sender.getParameters();
        params.encodings = [{ ...(params.encodings?.[0] ?? {}), maxBitrate: currentVideoBitrate }];
        sender.setParameters(params).catch(() => {});
      }, 4_000);
    }

    // Ask Supabase to wait for the server to actually acknowledge each
    // broadcast before `send()` resolves, instead of firing-and-forgetting.
    // Without this, `send()` can return before the message is actually on
    // the wire, which previously made it easy for signaling messages
    // (session-info / request-session-info) to be reordered relative to
    // each other -- one contributor to the same partner track effectively
    // getting "announced" and pulled more than once.
    const signalChannel = supabase.channel(`match:${matchId}`, {
      config: { broadcast: { self: false, ack: true } },
    });

    // Supabase broadcast never replays to a client that subscribes after the
    // message was sent. If peer A finishes connecting and announces its
    // session-info before peer B has subscribed, B never learns how to pull
    // A's tracks -- the call looks "connected" (A's own PC is up) but the
    // remote video never arrives. To close that race, whoever announces
    // records that fact, and re-announces on request; whoever subscribes
    // asks for a resend right away in case they were the late joiner.
    //
    // A re-announce for tracks we've *already* pulled is a harmless no-op
    // for the reader (see `pulledPartnerKeyRef` below) -- it's only ever a
    // duplicate delivery of the same session-info, never a reason to pull
    // twice.
    async function announceSessionInfo() {
      const sessionId = localSessionIdRef.current;
      const tracks = localTracksRef.current;
      if (!sessionId || tracks.length === 0) return;
      announced = true;
      await signalChannel.send({
        type: "broadcast",
        event: "session-info",
        payload: { sessionId, tracks } satisfies SignalPayload,
      });
    }

    async function connect() {
      // `.subscribe()`'s status callback can in principle fire "SUBSCRIBED"
      // more than once (e.g. a brief reconnect). Without this guard, a
      // second firing would run this whole flow again: a second
      // RTCPeerConnection, a second Cloudflare session, a second push --
      // all while the first is still live, which is a much bigger source of
      // duplicate/concurrent session traffic than anything on the pull side.
      if (connectStartedRef.current) return;
      connectStartedRef.current = true;

      setCallState("connecting");
      try {
        // Without ICE servers, RTCPeerConnection only gathers host
        // candidates, so this only worked when both peers happened to be
        // reachable directly (e.g. same LAN) -- which for two random
        // strangers on different networks is nearly never. Fetch short-TTL
        // Cloudflare TURN credentials first so real cross-network calls can
        // actually establish.
        const { iceServers } = await authedFetch("/api/turn-credentials", undefined, "GET");

        const pc = new RTCPeerConnection({ iceServers });
        pcRef.current = pc;

        // Cloudflare doesn't always associate pulled tracks with a shared
        // `MediaStream`/msid the way a single local getUserMedia stream
        // does, so `event.streams[0]` isn't reliable once we're pulling
        // more than one remote track (audio + video). Build one durable
        // MediaStream ourselves and feed every incoming track into it --
        // <video srcObject> updates live as tracks are added, no matter
        // how many separate `ontrack` events they arrive in.
        remoteMediaStreamRef.current = new MediaStream();
        pc.ontrack = (event) => {
          const remote = remoteMediaStreamRef.current!;
          if (!remote.getTracks().includes(event.track)) {
            remote.addTrack(event.track);
          }
          event.track.addEventListener("ended", () => remote.removeTrack(event.track));
          setRemoteStream(remote);
        };
        pc.onconnectionstatechange = () => {
          if (pc.connectionState === "connected") {
            setCallState("connected");
            if (!adaptiveInterval) startAdaptiveBitrate(pc);
          }
          if (pc.connectionState === "failed") setCallState("failed");
        };

        let videoTransceiver: RTCRtpTransceiver | null = null;
        for (const track of localStream!.getTracks()) {
          if (track.kind === "video") {
            // Hints the encoder to prioritize smooth motion/framerate over
            // per-frame sharpness -- the right trade-off for a talking-head
            // call (vs. e.g. screen-share, which wants "detail"). Widely
            // supported and doesn't require any SDP/renegotiation dance.
            track.contentHint = "motion";
          }
          const transceiver = pc.addTransceiver(track, { direction: "sendonly" });
          if (track.kind === "video") {
            videoTransceiver = transceiver;
            videoSenderRef.current = transceiver.sender;
            const params = transceiver.sender.getParameters();
            // This is just the *starting* bitrate now, not a fixed cap --
            // `startAdaptiveBitrate` below raises it toward
            // MAX_VIDEO_BITRATE when the connection can sustain more, and
            // cuts it back toward MIN_VIDEO_BITRATE under real congestion,
            // instead of picking one number that's either too conservative
            // on a good connection or still too much on a bad one.
            params.encodings = [{ maxBitrate: START_VIDEO_BITRATE, priority: "high" }];
            transceiver.sender.setParameters(params).catch(() => {
              // Some browsers reject setParameters before the first
              // negotiation completes; not fatal, just keeps the default.
            });
          }
        }

        // VP9 encodes noticeably cleaner than VP8/H.264 at the same
        // bitrate, which is most of what "better video quality" without
        // more bandwidth actually buys you. This only *reorders* our
        // offered codecs by preference -- every codec the browser already
        // supported is still offered, just later in the list -- so if
        // Cloudflare's Calls SFU or the other participant's browser can't
        // do VP9, negotiation just falls back to VP8/H.264 as before rather
        // than breaking.
        if (videoTransceiver && typeof videoTransceiver.setCodecPreferences === "function") {
          const capabilities = RTCRtpSender.getCapabilities?.("video");
          if (capabilities) {
            const rank = (mimeType: string) =>
              ["video/VP9", "video/AV1", "video/H264", "video/VP8"].indexOf(mimeType);
            const ordered = [...capabilities.codecs].sort((a, b) => {
              const ra = rank(a.mimeType);
              const rb = rank(b.mimeType);
              return (ra === -1 ? 99 : ra) - (rb === -1 ? 99 : rb);
            });
            try {
              videoTransceiver.setCodecPreferences(ordered);
            } catch {
              // Unsupported codec list shape in this browser -- keep
              // whatever the browser would have negotiated by default.
            }
          }
        }

        const { sessionId } = await authedFetch("/api/calls/session/new", { matchId });
        localSessionIdRef.current = sessionId;

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);

        // One push entry per transceiver -- previously this only sent
        // `getTransceivers()[0]`, so with both an audio and a video track
        // added above, whichever track ended up at index 0 was the only one
        // ever registered with Cloudflare under a trackName. The other
        // track stayed in the SDP (so it looked "sent") but Cloudflare had
        // no trackName for it, so it could never be pulled by the partner --
        // this is why only audio (or only video) ever arrived on the other
        // end.
        const pushTracks: (TrackInfo & { mid?: string })[] = pc.getTransceivers().map((t) => ({
          trackName: `track-${t.sender.track?.kind ?? "unknown"}-${crypto.randomUUID()}`,
          kind: (t.sender.track?.kind ?? "audio") as "audio" | "video",
          mid: t.mid ?? undefined,
        }));
        localTracksRef.current = pushTracks.map(({ trackName, kind }) => ({ trackName, kind }));

        const pushResult = await authedFetch("/api/calls/tracks/push", {
          matchId,
          sessionId,
          tracks: pushTracks.map(({ trackName, mid }) => ({ location: "local" as const, trackName, mid })),
          sessionDescription: { type: "offer", sdp: offer.sdp },
        });

        await pc.setRemoteDescription(new RTCSessionDescription(pushResult.sessionDescription));

        if (cancelled) return;

        // Tell the other participant how to find our published tracks.
        await announceSessionInfo();
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error("cloudflare_calls_connect_failed", err);
        setCallState("failed");
      }
    }

    async function pullPartnerTrack(partner: SignalPayload) {
      const pc = pcRef.current;
      const sessionId = localSessionIdRef.current;
      if (!pc || !sessionId || partner.tracks.length === 0) return;

      const partnerKey = `${partner.sessionId}:${partner.tracks
        .map((t) => t.trackName)
        .sort()
        .join(",")}`;

      // Once we've *successfully* pulled a given partner track set, further
      // (re-)announcements of that same set are no-ops.
      if (pulledPartnerKeyRef.current === partnerKey) return;

      // A resend can arrive while our first attempt for the very same
      // tracks is still in flight (the resend is triggered by the partner's
      // own `request-session-info`, which races independently of our pull).
      // Awaiting -- rather than re-entering -- the existing attempt is what
      // actually prevents two concurrent `tracks/pull` calls on our own
      // session: the backend's per-session lock keeps them from corrupting
      // each other, but there's no reason to make the redundant call (or
      // pay for it against the rate limit) at all.
      if (pullInFlightRef.current) {
        await pullInFlightRef.current;
        return pullPartnerTrack(partner);
      }

      const attempt = (async () => {
        try {
          // Pull every announced remote track (audio + video) in a single
          // call -- one request per track would mean the second request
          // races the first's renegotiation on the very same session.
          const pullResult = await authedFetch("/api/calls/tracks/pull", {
            matchId,
            sessionId,
            tracks: partner.tracks.map((t) => ({
              location: "remote" as const,
              sessionId: partner.sessionId,
              trackName: t.trackName,
            })),
          });

          if (pullResult.requiresImmediateRenegotiation) {
            // Guard against a stray/duplicate renegotiation: if the peer
            // connection isn't in the state WebRTC requires before
            // `setRemoteDescription` + `createAnswer` (i.e. we're not
            // "stable"), skip -- applying an offer twice, or answering one
            // that's already been superseded, is what produced Cloudflare's
            // "not expecting renegotiation" 406/502 in the logs.
            if (pc.signalingState !== "stable") return;
            await pc.setRemoteDescription(new RTCSessionDescription(pullResult.sessionDescription));
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            await authedFetch(
              "/api/calls/renegotiate",
              { matchId, sessionId, sessionDescription: { type: "answer", sdp: answer.sdp } },
              "PUT"
            );
          }

          // Only mark this partner track set as done once the whole
          // pull-and-renegotiate sequence has actually succeeded.
          pulledPartnerKeyRef.current = partnerKey;
        } catch (err) {
          // eslint-disable-next-line no-console
          console.error("cloudflare_calls_pull_failed", err);
          // Leave pulledPartnerKeyRef unset so a future re-announcement can
          // retry -- but do NOT retry synchronously/immediately, since the
          // failure is often a transient Cloudflare negotiation conflict
          // that needs the in-flight state to fully settle first. The next
          // `session-info` broadcast (the partner's periodic resend) is
          // what triggers the retry.
        }
      })();

      pullInFlightRef.current = attempt;
      try {
        await attempt;
      } finally {
        if (pullInFlightRef.current === attempt) pullInFlightRef.current = null;
      }
    }

    signalChannel
      .on("broadcast", { event: "session-info" }, ({ payload }) => pullPartnerTrack(payload as SignalPayload))
      .on("broadcast", { event: "request-session-info" }, () => {
        if (announced) announceSessionInfo();
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          connect().then(() => {
            if (cancelled) return;
            // In case the peer already announced before we subscribed, ask
            // them to resend so we don't just sit "connected" with no
            // remote track.
            signalChannel.send({ type: "broadcast", event: "request-session-info", payload: {} });
          });
        }
      });

    return () => {
      cancelled = true;
      if (adaptiveInterval) clearInterval(adaptiveInterval);
      signalChannel.unsubscribe();
      pcRef.current?.close();
      pcRef.current = null;
      remoteMediaStreamRef.current = null;
      videoSenderRef.current = null;
      setRemoteStream(null);
      setCallState("ended");
    };
  }, [matchId, localStream, authedFetch]);

  return { callState, remoteStream };
}
