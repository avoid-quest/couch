export type ToolObservation = { status: "ready" | "missing" | "corrupt" | "error" | "unknown"; version: string | null; error: string | null };
export type ManagedToolHealth = {
  name: "yt-dlp" | "Deno";
  expectedVersion: string | null;
  installed: ToolObservation;
  effective: ToolObservation & { source: "package" | "environment" | "search-path" | "unavailable" };
};
export type ToolHealth = { checkedAt: string; tools: ManagedToolHealth[]; ffprobe: ToolObservation; cacheSeconds: number };

export type UbuntuPackageStatus = { available: number | null; security: number | null; broken: number | null; indexUpdatedAt: number | null; checkedAt: string; error: string | null };
