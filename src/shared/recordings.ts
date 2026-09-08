export type RecordingStatus = "checking" | "pending" | "running" | "completed" | "failed" | "cancelled";
export type Recording = { id: string; programId: string; channelId: string; channelName: string; title: string; start: number; end: number; status: RecordingStatus; cause: string | null; revision: number; cancelRequested: boolean; backend?: "ant" };
export type RecordingsPage = { configured: boolean; antConfigured?: boolean; revision: number; checkedAt: number | null; error: string | null; jobs: Recording[] };
export type RecordingMapping = { channelId: string; sourceId: string; tvgId: string; backendChannel: string };
