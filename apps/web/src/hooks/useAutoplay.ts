import { useCallback, useEffect, useState, type RefObject } from "react";

/**
 * Browsers generally exempt getUserMedia/RTCPeerConnection-sourced
 * `MediaStream`s from the "no autoplay with sound" policy that blocks
 * things like ads and video-site previews -- that exemption is what lets a
 * plain `<video autoPlay playsInline>` fed a WebRTC `srcObject` just work
 * almost everywhere, iOS Safari included, with no special handling.
 *
 * But that exemption isn't part of any spec, and it's the kind of thing
 * that can quietly get stricter (iOS Low Power Mode, a future WebKit
 * change) or just not apply the one time a stream's first frame lands a
 * beat later than expected. This hook is the fallback for that: it always
 * follows up `srcObject` with an explicit `.play()`, and if that ever
 * rejects, `blocked` flips true so the caller can render a "tap to start"
 * affordance -- `retry`, called from that tap, runs inside a genuine user
 * gesture, so it always succeeds regardless of any autoplay policy.
 */
export function useAutoplay(ref: RefObject<HTMLVideoElement>, stream: MediaStream | null | undefined) {
  const [blocked, setBlocked] = useState(false);

  useEffect(() => {
    if (!stream || !ref.current) {
      setBlocked(false);
      return;
    }
    setBlocked(false);
    ref.current.play().catch(() => setBlocked(true));
  }, [stream, ref]);

  const retry = useCallback(() => {
    ref.current
      ?.play()
      .then(() => setBlocked(false))
      .catch(() => setBlocked(true));
  }, [ref]);

  return { blocked, retry };
}
