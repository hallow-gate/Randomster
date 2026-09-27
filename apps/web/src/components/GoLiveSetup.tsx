import { useState } from "react";

interface GoLiveSetupProps {
  onConfirm: (mode: "random" | "solo", caption: string) => void;
}

const MODES = [
  {
    value: "solo" as const,
    emoji: "🎥",
    label: "Solo",
    blurb: "Just your camera",
    selectedClass: "bg-lime text-black border-black shadow-brutal-sm",
    idleClass: "bg-black/40 text-white border-lime/40 hover:border-lime hover:bg-lime/10",
    ring: "focus-visible:ring-lime",
  },
  {
    value: "random" as const,
    emoji: "🎲",
    label: "Random",
    blurb: "Matched with a friend",
    selectedClass: "bg-magenta text-black border-black shadow-brutal-sm",
    idleClass: "bg-black/40 text-white border-magenta/40 hover:border-magenta hover:bg-magenta/10",
    ring: "focus-visible:ring-magenta",
  },
];

/**
 * Shown the moment the host lands on the Go Live page, before anything is
 * actually published — the same beat as TikTok/Instagram's own "before you
 * go live" sheet. Picking a mode and (optionally) typing a caption are both
 * decided here rather than mid-stream, so the rest of LiveBroadcast never
 * has to render a state where the mode is still unknown.
 */
export function GoLiveSetup({ onConfirm }: GoLiveSetupProps) {
  const [mode, setMode] = useState<"random" | "solo" | null>(null);
  const [caption, setCaption] = useState("");

  return (
    <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-5 bg-charcoal/95 backdrop-blur-sm px-4 py-6 text-center animate-[setupIn_0.25s_ease-out]">
      <div>
        <p className="font-display font-bold text-lime text-lg uppercase tracking-wide">Go Live</p>
        <p className="text-gray-400 text-xs font-mono mt-1">Choose how you want to stream</p>
      </div>

      <div className="grid grid-cols-2 gap-3 w-full max-w-sm" role="radiogroup" aria-label="Stream mode">
        {MODES.map((m) => {
          const selected = mode === m.value;
          return (
            <button
              key={m.value}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => setMode(m.value)}
              className={`relative flex flex-col items-center gap-2 px-3 py-4 border-2 transition-all duration-150 hover:-translate-y-0.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-charcoal ${m.ring} ${
                selected ? m.selectedClass : m.idleClass
              }`}
            >
              {selected && (
                <span className="absolute top-1 right-1 w-4 h-4 flex items-center justify-center rounded-full bg-black text-white text-[10px] leading-none">
                  ✓
                </span>
              )}
              <span className={`text-2xl transition-transform duration-150 ${selected ? "scale-110" : ""}`}>
                {m.emoji}
              </span>
              <span className="font-display font-bold text-xs uppercase">{m.label}</span>
              <span className="text-[10px] font-mono opacity-80">{m.blurb}</span>
            </button>
          );
        })}
      </div>

      <div className="w-full max-w-sm text-left">
        <label htmlFor="go-live-caption" className="sr-only">
          Caption
        </label>
        <input
          id="go-live-caption"
          value={caption}
          onChange={(e) => setCaption(e.target.value.slice(0, 200))}
          placeholder="Add a caption (optional)"
          className="w-full bg-black/50 border-2 border-cyan/40 focus:border-cyan text-white text-sm font-mono px-3 py-2 outline-none placeholder:text-gray-500 transition-colors"
        />
        <p className="text-[10px] text-gray-500 font-mono mt-1 text-right">{caption.length}/200</p>
      </div>

      <button
        onClick={() => mode && onConfirm(mode, caption.trim())}
        disabled={!mode}
        className="font-display font-bold uppercase text-sm px-6 py-2.5 bg-lime text-black border-2 border-black shadow-brutal-sm disabled:opacity-40 disabled:cursor-not-allowed hover:-translate-y-0.5 active:translate-y-0 active:shadow-none transition-transform disabled:hover:translate-y-0"
      >
        {mode ? `Go Live · ${mode === "solo" ? "Solo" : "Random"}` : "Pick a mode to continue"}
      </button>

      <style>{`
        @keyframes setupIn {
          0% { opacity: 0; transform: scale(0.98); }
          100% { opacity: 1; transform: scale(1); }
        }
      `}</style>
    </div>
  );
}
