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
  video?: VideoMetadata | null;
  available: boolean;
  progress?: ViewingProgress | null;
};

export type LibrarySearch = { items: LibraryItem[]; total: number; offset: number; limit: number };

export type MusicArtist = { id: string; name: string; albumCount: number; trackCount: number; artworkId: string | null };
export type MusicAlbum = { id: string; title: string; artist: string | null; artworkId: string | null; trackCount: number; duration: number | null };
export type MusicArtists = { items: MusicArtist[]; total: number; offset: number; limit: number };
export type MusicAlbums = { items: MusicAlbum[]; total: number; offset: number; limit: number };

export type VideoDescription = {
  originalTitle: string | null; plot: string | null; year: number | null; premiered: string | null; genres: string[];
};
export type VideoShow = VideoDescription & { id: string; title: string; artworkId: string | null; fanartId: string | null };
export type VideoMetadata = VideoDescription & {
  type: "movie" | "episode"; show: VideoShow | null; season: number | null; episode: number | null;
  fanartId: string | null; seasonArtworkId: string | null;
};
export type VideoShows = { items: Array<VideoShow & { seasonCount: number; episodeCount: number }>; total: number; offset: number; limit: number };
export type VideoSeason = { season: number | null; episodeCount: number; artworkId: string | null };

export type WatchingProfile = { id: string; name: string; personName?: string };
export type ViewingProgress = { position: number; duration: number | null; watched: boolean; lastPlayedAt: number | null };
export type HistoryItem = ViewingProgress & { playedBy?: import("./protocol").PlaybackActor; mediaId: string; title: string; libraryItemId: string | null; queueEntryId?: string; playable?: boolean; thumbnail?: string; artworkId?: string; sourceLabel?: string };
