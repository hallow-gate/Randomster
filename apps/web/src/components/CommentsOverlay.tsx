import { useEffect, useRef, useState } from "react";

export interface LiveComment {
  id: string;
  user_id: string;
  username: string;
  text: string;
  created_at: string;
}

// A small, fixed palette so each username gets a stable, readable color
// (picked by a cheap hash of the name) instead of every comment looking
// identical — makes a fast-moving comment stream much easier to scan.
const NAME_COLORS = ["text-lime", "text-cyan", "text-magenta", "text-amber-300", "text-emerald-300", "text-sky-300"];
function colorFor(username: string) {
  let hash = 0;
  for (let i = 0; i < username.length; i++) hash = (hash * 31 + username.charCodeAt(i)) | 0;
  return NAME_COLORS[Math.abs(hash) % NAME_COLORS.length];
}

export function CommentsOverlay({
  comments,
  onSend,
  disabled,
  placeholder = "say something...",
}: {
  comments: LiveComment[];
  onSend: (text: string) => void;
  disabled?: boolean;
  /** Overrides the input's placeholder text, e.g. "view only" for a host who can watch but not post. */
  placeholder?: string;
}) {
  const [draft, setDraft] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [comments.length]);

  const send = () => {
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    onSend(text);
  };

  return (
    <div className="absolute left-0 bottom-0 top-0 w-[62%] sm:w-1/2 flex flex-col justify-end pointer-events-none">
      <div className="flex flex-col gap-1 max-h-[70%] overflow-y-auto px-2 pb-1 pointer-events-auto [mask-image:linear-gradient(to_top,black_70%,transparent)]">
        {comments.length === 0 && (
          <p className="text-[10px] font-mono text-gray-400 bg-black/40 px-2 py-1 w-fit">
            No comments yet — be the first
          </p>
        )}
        {comments.map((c) => (
          <div
            key={c.id}
            className="bg-black/55 backdrop-blur-[1px] text-white text-xs font-mono px-2 py-1 w-fit max-w-full break-words animate-[commentIn_0.2s_ease-out]"
          >
            <span className={colorFor(c.username)}>@{c.username}</span> <span>{c.text}</span>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      <div className="flex border-t-2 border-black pointer-events-auto">
        <input
          value={draft}
          maxLength={200}
          disabled={disabled}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
          placeholder={placeholder}
          className="flex-1 bg-black/70 text-white text-xs font-mono px-2 py-2 outline-none placeholder:text-gray-500 disabled:placeholder:text-gray-600"
        />
        <button
          onClick={send}
          disabled={disabled}
          className="bg-cyan text-black font-display font-bold text-xs px-3 uppercase disabled:opacity-40 transition-opacity hover:enabled:bg-cyan/80"
        >
          Send
        </button>
      </div>
    </div>
  );
}
