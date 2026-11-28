import type { CollectionLink, MediaCollection } from "./media";
import type { VideoQuality } from "./providers";
import type { PlaybackActor, PlaybackCollection, QueueEntry } from "./protocol";

/** Whether Core keeps a place for what plays (server/progress.ts): media from a web page, never a station or a channel. */
export const keepsProgress = (entry: Pick<QueueEntry, "endless" | "kind" | "source">) =>
  !entry.endless && entry.kind !== "radio" && /^(web:https?:|https?:)/.test(entry.source);

export type HistorySelection = { collection: MediaCollection; quality?: VideoQuality };
export type WatchingProfile = { id: string; name: string; personName?: string };
type ViewingProgress = {
  position: number;
  duration: number | null;
  watched: boolean;
  lastPlayedAt: number | null;
};
export type HistoryItem = ViewingProgress & {
  creator?: CollectionLink;
  collection?: PlaybackCollection;
  subtitle?: string;
  description?: string;
  playedBy?: PlaybackActor;
  mediaId: string;
  title: string;
  queueEntryId?: string;
  playable?: boolean;
  thumbnail?: string;
  sourceLabel?: string;
  /** Public provider page for exact catalogue matching; never a resolved media URL. */ url?: string;
};
