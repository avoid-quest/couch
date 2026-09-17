import type { QueueEntry } from "./protocol";

export type ForLaterReference = { kind: "queue" | "library" | "jellyfin"; id: string } | { kind: "web"; url: string; title: string };
export type ForLaterItem = Omit<QueueEntry, "source" | "automaticTitle">;
