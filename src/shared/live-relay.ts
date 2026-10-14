export type LiveRelay = { urls: string; username: string; credential: string };
export type LiveRelaySettings = { relay: LiveRelay | null; source: "saved" | "environment" | "none" };
