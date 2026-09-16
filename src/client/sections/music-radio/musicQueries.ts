import { queryOptions } from "@tanstack/react-query";
import type { LibraryItem, MusicAlbum, MusicAlbums, MusicArtist, MusicArtists } from "../../../shared/library";
import type { Credentials } from "../../../client/session/session";
import { apiFetch } from "../../../client/api/client";

export type MusicBrowse =
  | { kind: "artists" | "albums"; artist?: MusicArtist; q: string; offset: number }
  | { kind: "album"; album: MusicAlbum; q: string; offset: number };
export type MusicBrowseResult = MusicArtists | MusicAlbums | AlbumTracks;
export type AlbumTracks = { album: MusicAlbum; items: LibraryItem[] };

const pageSize = 24;

export const musicBrowseQuery = (credentials: Credentials, browse: MusicBrowse) => {
  const params = new URLSearchParams({ q: browse.q, offset: String(browse.offset), limit: String(pageSize) });
  if (browse.kind === "albums" && browse.artist) params.set("artistId", browse.artist.id);
  const path = browse.kind === "album"
    ? `/api/library/music/albums/${encodeURIComponent(browse.album.id)}`
    : `/api/library/music/${browse.kind}?${params}`;
  return queryOptions({
    queryKey: ["library", "music", credentials.origin, credentials.token, browse] as const,
    queryFn: () => apiFetch(credentials, path).then(response => response.json() as Promise<MusicBrowseResult>),
  });
};

export const musicPageSize = pageSize;
