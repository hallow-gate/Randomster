import type { NextFunction, Response } from "express";
import type { AuthedRequest } from "./auth.js";
import { supabaseAdmin } from "../lib/supabaseAdmin.js";

/**
 * Blocks any request from a user who is banned, or whose age verification
 * came back 'rejected' (i.e. confirmed under 18, or vendor flagged fraud).
 * Must run after requireAuth. Fails closed on lookup errors.
 */
export async function requireNotBanned(req: AuthedRequest, res: Response, next: NextFunction) {
  if (!req.userId) return res.status(401).json({ error: "missing_token" });

  const { data, error } = await supabaseAdmin
    .from("profiles")
    .select("is_banned, age_verification_status")
    .eq("id", req.userId)
    .single();

  if (error || !data) {
    return res.status(403).json({ error: "profile_not_found" });
  }

  if (data.is_banned || data.age_verification_status === "rejected") {
    return res.status(403).json({ error: "account_restricted" });
  }

  next();
}
