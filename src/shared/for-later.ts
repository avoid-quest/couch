import type { QueueEntry } from "./protocol";

export type ForLaterReference = { kind: "queue" | "library" | "jellyfin"; id: string } | { kind: "web"; url: string; title: string; thumbnail?: string; duration?: number; collection?: Pick<NonNullable<QueueEntry["collection"]>, "url" | "index"> };
export type ForLaterItem = Omit<QueueEntry, "source" | "automaticTitle"> & { url?: string };
