export type LibrarySource = {
  id: string;
  name: string;
  path?: string;
  status: "idle" | "scanning" | "ready" | "unavailable" | "error";
  lastScanned: number | null;
  error: string | null;
  warning: string | null;
  itemCount: number;
};

export type LibraryItem = {
  id: string;
  title: string;
  kind: "video" | "audio";
  duration: number | null;
  artist: string | null;
  album: string | null;
  artists?: string[];
  albumArtist?: string | null;
  albumId?: string | null;
  discNumber?: number | null;
  trackNumber?: number | null;
  artworkId?: string | null;
  available: boolean;
  progress?: ViewingProgress | null;
};

export type LibrarySearch = { items: LibraryItem[]; total: number; offset: number; limit: number };

export type MusicArtist = { id: string; name: string; albumCount: number; trackCount: number; artworkId: string | null };
export type MusicAlbum = { id: string; title: string; artist: string | null; artworkId: string | null; trackCount: number; duration: number | null };
export type MusicArtists = { items: MusicArtist[]; total: number; offset: number; limit: number };
export type MusicAlbums = { items: MusicAlbum[]; total: number; offset: number; limit: number };

export type WatchingProfile = { id: string; name: string };
export type ViewingProgress = { position: number; duration: number | null; watched: boolean; lastPlayedAt: number | null };
export type HistoryItem = ViewingProgress & { mediaId: string; title: string; libraryItemId: string | null; queueEntryId?: string };
