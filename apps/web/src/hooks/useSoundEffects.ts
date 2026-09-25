import { useCallback, useRef, useState } from "react";

// Short, synthesized beeps via WebAudio — no external audio files needed,
// keeps the bundle self-contained. Swap for real SFX assets if you want.
type SoundKind = "click" | "connect" | "disconnect";

export function useSoundEffects() {
  const [muted, setMuted] = useState(false);
  const ctxRef = useRef<AudioContext | null>(null);

  const play = useCallback(
    (kind: SoundKind) => {
      if (muted) return;
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return;
      ctxRef.current ??= new AudioCtx();
      const ctx = ctxRef.current;

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
    [muted]
  );

  return { play, muted, toggleMuted: () => setMuted((m) => !m) };
}
