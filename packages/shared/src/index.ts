export type MatchScope = "SAME_COUNTRY" | "ALL_COUNTRIES" | "REGION";

export type AgeVerificationStatus = "unverified" | "pending" | "verified" | "rejected";

export interface Profile {
  id: string;
  username: string | null;
  countryCode: string;
  matchScope: MatchScope;
  ageVerificationStatus: AgeVerificationStatus;
}

export type ReportReason =
  | "nudity_sexual_content"
  | "minor_suspected"
  | "harassment"
  | "spam"
  | "violence_threats"
  | "csam_suspected"
  | "other";

export interface JoinQueueResponse {
  status: "queued" | "matched";
  matchId?: string;
  partnerId?: string;
}
