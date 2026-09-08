import type { QueueEntry } from "./protocol";

export type ForLaterReference = { kind: "queue" | "library" | "jellyfin"; id: string };
export type ForLaterItem = Omit<QueueEntry, "source" | "automaticTitle">;
