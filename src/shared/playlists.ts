import type { QueueEntry } from "./protocol";

export type SavedPlaylist = {
  id: string;
  name: string;
  revision: number;
  updatedAt: number;
  source: PlaylistSource | null;
  entries: Array<Omit<QueueEntry, "source" | "automaticTitle">>;
};

export type SavedPlaylistSummary = Omit<SavedPlaylist, "entries"> & { entryCount: number; totalDuration: number | null };
export type PlaylistLoadMode = "append" | "replace" | "play";
// A source list reference that a playlist can be saved from. Twitch has no lists.
export type PlaylistSource = { provider: "youtube" | "raiplay" | "bandcamp" | "streamingcommunity" | "movies123" | "animesaturn" | "animeunity"; url: string };
