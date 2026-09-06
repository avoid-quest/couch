export type ReleaseChannel = "stable" | "preview";
export type UpdateCandidate = { id: string; releaseId: string; version: string; revision: string; notes: string; bytes: number; publishedAt: number; expiresAt: number };
export type UpdateState = {
  channel: ReleaseChannel;
  policy: "manual";
  running: { version: string; revision: string | null };
  status: "unavailable" | "idle" | "checking" | "available" | "downloading" | "ready" | "failed";
  lastSuccessfulCheck: number | null;
  currentCheck: boolean;
  candidate: UpdateCandidate | null;
  error: string | null;
};
