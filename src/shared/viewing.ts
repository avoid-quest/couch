import type { CollectionLink, MediaCollection } from "./media";
import type { VideoQuality } from "./providers";
import type { PlaybackActor, PlaybackCollection } from "./protocol";

export type HistorySelection = { collection: MediaCollection; quality?: VideoQuality };
export type WatchingProfile = { id: string; name: string; personName?: string };
type ViewingProgress = { position: number; duration: number | null; watched: boolean; lastPlayedAt: number | null };
export type HistoryItem = ViewingProgress & { creator?: CollectionLink; collection?: PlaybackCollection; subtitle?: string; description?: string; playedBy?: PlaybackActor; mediaId: string; title: string; queueEntryId?: string; playable?: boolean; thumbnail?: string; sourceLabel?: string; /** Public provider page for exact catalogue matching; never a resolved media URL. */ url?: string };
