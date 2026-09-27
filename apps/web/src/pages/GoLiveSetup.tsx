import { useState } from "react";

interface GoLiveSetupProps {
  onConfirm: (mode: "random" | "solo", caption: string) => void;
}

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
    <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-5 bg-charcoal/95 px-4 py-6 text-center">
      <div>
        <p className="font-display font-bold text-lime text-lg uppercase">Go Live</p>
        <p className="text-gray-400 text-xs font-mono mt-1">Choose how you want to stream</p>
      </div>

      <div className="grid grid-cols-2 gap-3 w-full max-w-sm">
        <button
          onClick={() => setMode("solo")}
          className={`flex flex-col items-center gap-2 px-3 py-4 border-2 shadow-brutal-sm transition-transform hover:-translate-y-0.5 ${
            mode === "solo" ? "bg-lime text-black border-black" : "bg-black/40 text-white border-lime/40"
          }`}
        >
          <span className="text-2xl">🎥</span>
          <span className="font-display font-bold text-xs uppercase">Solo</span>
          <span className="text-[10px] font-mono opacity-80">Just your camera</span>
        </button>
        <button
          onClick={() => setMode("random")}
          className={`flex flex-col items-center gap-2 px-3 py-4 border-2 shadow-brutal-sm transition-transform hover:-translate-y-0.5 ${
            mode === "random" ? "bg-magenta text-black border-black" : "bg-black/40 text-white border-magenta/40"
          }`}
        >
          <span className="text-2xl">🎲</span>
          <span className="font-display font-bold text-xs uppercase">Random</span>
          <span className="text-[10px] font-mono opacity-80">Matched with a stranger</span>
        </button>
      </div>

      <div className="w-full max-w-sm">
        <input
          value={caption}
          onChange={(e) => setCaption(e.target.value.slice(0, 200))}
          placeholder="Add a caption (optional)"
          className="w-full bg-black/50 border-2 border-cyan/40 focus:border-cyan text-white text-sm font-mono px-3 py-2 outline-none placeholder:text-gray-500"
        />
        <p className="text-[10px] text-gray-500 font-mono mt-1 text-right">{caption.length}/200</p>
      </div>

      <button
        onClick={() => mode && onConfirm(mode, caption.trim())}
        disabled={!mode}
        className="font-display font-bold uppercase text-sm px-6 py-2.5 bg-lime text-black border-2 border-black shadow-brutal-sm disabled:opacity-40 disabled:cursor-not-allowed hover:-translate-y-0.5 transition-transform disabled:hover:translate-y-0"
      >
        Go Live
      </button>
    </div>
  );
}
