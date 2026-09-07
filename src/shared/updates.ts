export type UpdateTransaction = {
  updateId: string;
  requestId: string;
  candidateId: string;
  version: string | null;
  revision: string | null;
  phase: "accepted" | "preflight" | "installing" | "quiescing" | "trial" | "committing" | "succeeded" | "failed" | "operator-required" | "restoring" | "restored";
  error: string | null;
  createdAt: number;
  updatedAt: number;
  restoredVersion?: string | null;
  restoredRevision?: string | null;
};
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
  installation?: { enabled: boolean; transaction: UpdateTransaction | null; requestedTransaction?: UpdateTransaction | null };
};
