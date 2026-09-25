import { useEffect, useRef, useState } from "react";
import { supabase, apiBaseUrl } from "../lib/supabase";

interface ChatMessage {
  id: string;
  sender_id: string;
  content: string;
  created_at: string;
}

export function ChatPanel({ matchId, selfId }: { matchId: string; selfId: string }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const channel = supabase
      .channel(`messages:${matchId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages", filter: `match_id=eq.${matchId}` },
        (payload) => {
          const incoming = payload.new as ChatMessage;
          // Our own messages are already shown optimistically by send(); the
          // realtime echo of our own INSERT would otherwise duplicate them.
          if (incoming.sender_id === selfId) return;
          setMessages((prev) => [...prev, incoming]);
        }
      )
      .subscribe();

    return () => {
      channel.unsubscribe();
    };
  }, [matchId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  const send = async () => {
    const content = draft.trim();
    if (!content) return;
    setDraft("");
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    const res = await fetch(`${apiBaseUrl}/api/chat/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ matchId, content }),
    });
    if (res.ok) {
      // Show it immediately rather than waiting on the realtime echo -- the
      // server is the source of truth for the persisted row/profanity
      // filtering, but the sender shouldn't have to wait on Realtime just to
      // see their own message.
      setMessages((prev) => [
        ...prev,
        { id: crypto.randomUUID(), sender_id: selfId, content, created_at: new Date().toISOString() },
      ]);
    }
  };

  return (
    <div className="flex flex-col h-full bg-black border-2 border-cyan shadow-brutal font-mono text-sm">
      <div className="flex-1 overflow-y-auto p-3 space-y-1">
        {messages.map((m) => {
          const time = new Date(m.created_at).toLocaleTimeString([], { hour12: false });
          const mine = m.sender_id === selfId;
          return (
            <div key={m.id} className={mine ? "text-lime" : "text-cyan"}>
              <span className="text-gray-500">[{time}]</span> {mine ? "you" : "stranger"}: {m.content}
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>
      <div className="flex border-t-2 border-cyan">
        <input
          value={draft}
          maxLength={500}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
          placeholder="type a message..."
          className="flex-1 bg-charcoal text-white px-3 py-2 outline-none placeholder:text-gray-600"
        />
        <button onClick={send} className="bg-magenta text-black font-bold px-4 uppercase">
          Send
        </button>
      </div>
    </div>
  );
}
