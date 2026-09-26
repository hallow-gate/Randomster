import { useState } from "react";

interface FloatingHeart {
  id: number;
  x: number;
}

export function HeartReaction({ count, onReact }: { count: number; onReact: () => void }) {
  const [floaters, setFloaters] = useState<FloatingHeart[]>([]);

  const tap = () => {
    const id = Date.now() + Math.random();
    setFloaters((prev) => [...prev, { id, x: Math.random() * 24 - 12 }]);
    setTimeout(() => setFloaters((prev) => prev.filter((f) => f.id !== id)), 1200);
    onReact();
  };

  return (
    <div className="relative flex flex-col items-center gap-1">
      {floaters.map((f) => (
        <span
          key={f.id}
          className="absolute bottom-full text-2xl animate-[floatUp_1.2s_ease-out_forwards] select-none"
          style={{ left: `calc(50% + ${f.x}px)` }}
        >
          ❤️
        </span>
      ))}
      <button
        onClick={tap}
        aria-label="React with a heart"
        className="w-12 h-12 rounded-full bg-black/60 border-2 border-magenta text-magenta text-xl
          flex items-center justify-center active:scale-90 transition-transform"
      >
        ❤️
      </button>
      <span className="text-[10px] font-mono text-white bg-black/60 px-1.5 py-0.5">{count}</span>
      <style>{`
        @keyframes floatUp {
          0% { transform: translateY(0) scale(0.6); opacity: 1; }
          100% { transform: translateY(-90px) scale(1.2); opacity: 0; }
        }
      `}</style>
    </div>
  );
}
