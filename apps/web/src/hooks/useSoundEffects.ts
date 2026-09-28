import { useCallback, useEffect, useRef, useState } from "react";

// Short, synthesized beeps via WebAudio — no external audio files needed,
// keeps the bundle self-contained. Swap for real SFX assets if you want.
type SoundKind = "click" | "connect" | "disconnect";

export function useSoundEffects() {
  const [muted, setMuted] = useState(false);
  const ctxRef = useRef<AudioContext | null>(null);

  const getContext = useCallback(() => {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return null;
    ctxRef.current ??= new AudioCtx();
    return ctxRef.current;
  }, []);

  // iOS Safari creates a WebAudio context "suspended" unless `resume()` is
  // called synchronously inside a real user-gesture handler, and never
  // resumes it on its own afterwards. `play("connect")`/`play("disconnect")`
  // fire from a `matchState` effect -- not a tap -- so if one of those
  // happens to be the first sound ever requested, the context it creates
  // stays suspended (silently) for the rest of the session, "click" sounds
  // included, since every later call reuses that same never-resumed
  // context. Resuming on literally the next tap/keypress anywhere on the
  // page, whether or not that tap was meant to make a sound, fixes it —
  // and this keeps listening for the life of the page, not just once, so
  // it self-heals even if the context didn't exist yet at the first tap.
  useEffect(() => {
    const unlock = () => {
      const ctx = ctxRef.current;
      if (ctx && ctx.state === "suspended") ctx.resume().catch(() => {});
    };
    document.addEventListener("pointerdown", unlock, { passive: true });
    document.addEventListener("touchend", unlock, { passive: true });
    document.addEventListener("keydown", unlock);
    return () => {
      document.removeEventListener("pointerdown", unlock);
      document.removeEventListener("touchend", unlock);
      document.removeEventListener("keydown", unlock);
    };
  }, []);

  const play = useCallback(
    (kind: SoundKind) => {
      if (muted) return;
      const ctx = getContext();
      if (!ctx) return;
      // Covers the case where `play()` itself is the thing called from
      // inside a genuine tap handler (e.g. the mic/cam toggle buttons) --
      // resuming here is synchronous enough for iOS to still count it as
      // gesture-initiated.
      if (ctx.state === "suspended") ctx.resume().catch(() => {});

      const freqs: Record<SoundKind, number> = { click: 880, connect: 660, disconnect: 220 };
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = freqs[kind];
      osc.type = "square";
      gain.gain.setValueAtTime(0.05, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.15);
    },
    [muted, getContext]
  );

  return { play, muted, toggleMuted: () => setMuted((m) => !m) };
}

