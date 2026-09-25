import { supabaseAdmin } from "./supabaseAdmin.js";
import { logger } from "./logger.js";

/**
 * Server-authoritative Realtime notifications. Clients never write these
 * events themselves — only the backend broadcasts, so a client can't spoof
 * "you're matched" or "call ended" for someone else.
 *
 * Channel naming:
 *   user:{userId}   - private to one user; used to tell a queued user they
 *                      were just matched by someone else's join() call.
 *   call:{matchId}  - shared by both participants of a match; used to tell
 *                      the other side the call ended (skip/block/report/mod).
 */

export async function notifyUserMatched(userId: string, matchId: string, partnerId: string) {
  const channel = supabaseAdmin.channel(`user:${userId}`);
  await channel.subscribe();
  await channel.send({
    type: "broadcast",
    event: "matched",
    payload: { matchId, partnerId },
  });
  await supabaseAdmin.removeChannel(channel);
}

export async function notifyCallEnded(matchId: string, reason: "skip" | "block" | "report" | "moderation") {
  const channel = supabaseAdmin.channel(`call:${matchId}`);
  await channel.subscribe();
  await channel.send({
    type: "broadcast",
    event: "ended",
    payload: { matchId, reason },
  });
  await supabaseAdmin.removeChannel(channel);
  logger.info({ matchId, reason }, "call_ended_broadcast");
}
