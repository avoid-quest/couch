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
  progress?: { received: number; total: number };
  idleDeferred?: boolean | null;
  intent?: "install" | "repair-current" | null;
  repairRuntime?: boolean | null;
  restoredVersion?: string | null;
  restoredRevision?: string | null;
};
export type ReleaseChannel = "stable" | "preview";
export type UpdateCandidate = { id: string; releaseId: string; version: string; revision: string; notes: string; bytes: number; publishedAt: number; expiresAt?: number };
export type UpdateState = {
  channel: ReleaseChannel;
  policy: "manual" | "idle";
  waiting?: string | null;
  running: { version: string; revision: string | null };
  status: "unavailable" | "idle" | "checking" | "available" | "downloading" | "ready" | "failed";
  progress?: { received: number; total: number } | null;
  lastSuccessfulCheck: number | null;
  currentCheck: boolean;
  candidate: UpdateCandidate | null;
  error: string | null;
  installationUnavailable?: string;
  installation?: { current?: { candidateId: string; version: string; revision: string } | null; repairAvailable?: boolean; enabled: boolean; transaction: UpdateTransaction | null; requestedTransaction?: UpdateTransaction | null };
};

export type UpdateRequest = { op: "status"; requestId?: string } | { op: "install"; candidateId: string; requestId: string; confirmInterrupt: boolean; whenIdle?: true } | { op: "repair-current"; expectedCurrentId: string; requestId: string; confirmInterrupt: boolean; repairRuntime: false };
export type AppImageUpdateAction = { type: "restart"; confirmInterrupt: boolean } | { type: "status"; requestId?: string } | { type: "install"; candidateId: string; requestId: string; confirmInterrupt: boolean; whenIdle: boolean; repair: boolean; repairRuntime: false } | { type: "complete"; error: string | null } | { type: "check"; channel: ReleaseChannel } | { type: "checkRepair" } | { type: "stage"; candidateId: string };
export type AppImageUpdateReply = { requestId: string; ok?: boolean; accepted?: boolean; transaction?: UpdateTransaction | null; current?: { candidateId: string; version: string; revision: string }; repairCurrent?: boolean; installationAvailable?: boolean; summary?: UpdateCandidate; candidate?: { summary: UpdateCandidate; staged: boolean } | null; staged?: boolean; progress?: { received: number; total: number }; error?: string };
