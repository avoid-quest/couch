export type LiveRelay = { urls: string; username: string; credential: string };
export type LiveRelaySettings = { relay: LiveRelay | null; source: "saved" | "environment" | "none" };
export type LocalRelayState = { enabled: boolean; status: "off" | "waiting" | "starting" | "running" | "error"; error: string | null; relay: LiveRelay | null };
