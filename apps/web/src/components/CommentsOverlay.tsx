import { useEffect, useRef, useState } from "react";

export interface LiveComment {
  id: string;
  user_id: string;
  username: string;
  text: string;
  created_at: string;
}

export function CommentsOverlay({
  comments,
  onSend,
  disabled,
}: {
  comments: LiveComment[];
  onSend: (text: string) => void;
  disabled?: boolean;
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
        {comments.map((c) => (
          <div
            key={c.id}
            className="bg-black/55 backdrop-blur-[1px] text-white text-xs font-mono px-2 py-1 w-fit max-w-full break-words"
          >
            <span className="text-lime">@{c.username}</span> <span>{c.text}</span>
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
          placeholder={disabled ? "comments off" : "say something..."}
          className="flex-1 bg-black/70 text-white text-xs font-mono px-2 py-2 outline-none placeholder:text-gray-500"
        />
        <button
          onClick={send}
          disabled={disabled}
          className="bg-cyan text-black font-display font-bold text-xs px-3 uppercase disabled:opacity-40"
        >
          Send
        </button>
      </div>
    </div>
  );
}
