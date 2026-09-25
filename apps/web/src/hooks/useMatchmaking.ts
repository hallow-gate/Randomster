import { useCallback, useEffect, useRef, useState } from "react";
import { supabase, apiBaseUrl } from "../lib/supabase";

type MatchScope = "SAME_COUNTRY" | "ALL_COUNTRIES" | "REGION";
type MatchmakingState = "idle" | "queued" | "matched" | "ended";

export function useMatchmaking(selfId: string | undefined) {
  const [state, setState] = useState<MatchmakingState>("idle");
  const [matchId, setMatchId] = useState<string | null>(null);
  const [partnerId, setPartnerId] = useState<string | null>(null);
  const [lastEndReason, setLastEndReason] = useState<string | null>(null);
  const callChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  const authedFetch = useCallback(async (path: string, body: unknown) => {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    const res = await fetch(`${apiBaseUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`request_failed:${res.status}`);
    return res.json();
  }, []);

  const teardown = useCallback(() => {
    callChannelRef.current?.unsubscribe();
    callChannelRef.current = null;
  }, []);

  const enterMatch = useCallback(
    (id: string, partner: string) => {
      setMatchId(id);
      setPartnerId(partner);
      setState("matched");

      // Listen for the backend telling us the call ended (partner skipped,
      // reported us, blocked us, or a moderation event terminated it) so we
      // never rely on the client that took the action to also tell us.
      const callChannel = supabase.channel(`call:${id}`);
      callChannel
        .on("broadcast", { event: "ended" }, ({ payload }) => {
          setLastEndReason(payload.reason ?? null);
          setState("ended");
          setMatchId(null);
          setPartnerId(null);
          teardown();
        })
        .subscribe();
      callChannelRef.current = callChannel;
    },
    [teardown]
  );

  // While queued, listen on our own private channel for the moment someone
  // else's join() call pairs with us — see apps/api/src/lib/realtime.ts.
  useEffect(() => {
    if (!selfId || state !== "queued") return;

    const channel = supabase.channel(`user:${selfId}`);
    channel
      .on("broadcast", { event: "matched" }, ({ payload }) => {
        enterMatch(payload.matchId, payload.partnerId);
      })
      .subscribe();

    return () => {
      channel.unsubscribe();
    };
  }, [selfId, state, enterMatch]);

  const join = useCallback(
    async (scope: MatchScope) => {
      setState("queued");
      const result = await authedFetch("/api/match/join", { scope });
      if (result.status === "matched") {
        enterMatch(result.matchId, result.partnerId);
      }
      // else remains 'queued' — the effect above picks up the eventual match.
    },
    [authedFetch, enterMatch]
  );

  const skip = useCallback(async () => {
    if (!matchId) return;
    await authedFetch("/api/match/skip", { matchId });
    teardown();
    setMatchId(null);
    setPartnerId(null);
    setState("idle");
  }, [authedFetch, matchId, teardown]);

  // Same as skip(), but goes straight back into the queue instead of
  // dropping to the idle screen -- lets someone move on to the next
  // stranger with one click instead of skip, then Start, then wait.
  const next = useCallback(
    async (scope: MatchScope) => {
      if (!matchId) return;
      await authedFetch("/api/match/skip", { matchId });
      teardown();
      setMatchId(null);
      setPartnerId(null);
      setState("queued");
      const result = await authedFetch("/api/match/join", { scope });
      if (result.status === "matched") {
        enterMatch(result.matchId, result.partnerId);
      }
      // else remains 'queued' — the effect above picks up the eventual match.
    },
    [authedFetch, matchId, teardown, enterMatch]
  );

  const report = useCallback(
    async (reason: string, details?: string) => {
      if (!partnerId) return;
      await authedFetch("/api/match/report", { matchId, reportedId: partnerId, reason, details });
    },
    [authedFetch, matchId, partnerId]
  );

  const block = useCallback(async () => {
    if (!partnerId) return;
    await authedFetch("/api/match/block", { blockedId: partnerId, matchId });
    teardown();
    setMatchId(null);
    setPartnerId(null);
    setState("idle");
  }, [authedFetch, matchId, partnerId, teardown]);

  const resetAfterEnd = useCallback(() => setState("idle"), []);

  return { state, matchId, partnerId, lastEndReason, join, skip, next, report, block, resetAfterEnd };
}
