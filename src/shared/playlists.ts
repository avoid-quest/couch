import type { QueueEntry } from "./protocol";

export type SavedPlaylist = {
  id: string;
  name: string;
  revision: number;
  updatedAt: number;
  entries: Array<Omit<QueueEntry, "source" | "automaticTitle">>;
};

export type SavedPlaylistSummary = Omit<SavedPlaylist, "entries"> & { entryCount: number };
export type PlaylistLoadMode = "append" | "replace" | "play";
// A source list reference that a playlist can be saved from. Twitch has no lists.
export type PlaylistSource = { provider: "youtube" | "raiplay" | "bandcamp" | "streamingcommunity"; url: string };
