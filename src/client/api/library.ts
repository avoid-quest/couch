import { queryOptions } from "@tanstack/react-query";
import type { HistoryItem, LibraryItem, LibrarySearch, LibrarySource, MusicAlbum, MusicAlbums, MusicArtist, MusicArtists } from "../../shared/library";
import type { Credentials } from "../session/session";
import { apiFetch } from "./client";

export const libraryItemsQuery = (credentials: Credentials, search: { query?: string; kind?: string; offset?: number; limit?: number } = {}) =>
  queryOptions({
    queryKey: ["library", "items", search] as const,
    queryFn: () => {
      const params = new URLSearchParams();
      if (search.query) params.set("q", search.query);
      if (search.kind) params.set("kind", search.kind);
      params.set("offset", String(search.offset ?? 0));
      params.set("limit", String(search.limit ?? 24));
      return apiFetch(credentials, `/api/library/items?${params}`).then(r => r.json() as Promise<LibrarySearch>);
    },
    staleTime: 60_000,
  });

export const librarySourcesQuery = (credentials: Credentials) =>
  queryOptions({
    queryKey: ["library", "sources"],
    queryFn: () => apiFetch(credentials, "/api/library/sources").then(r => r.json() as Promise<{ sources: LibrarySource[] }>),
  });

export const libraryFoldersQuery = (credentials: Credentials) =>
  queryOptions({
    queryKey: ["library", "folders"],
    queryFn: () => apiFetch(credentials, "/api/library/folders").then(r => r.json() as Promise<{ folders: LibraryItem[] }>),
  });

export const historyQuery = (credentials: Credentials, provider?: string) =>
  queryOptions({
    queryKey: ["library", "history", provider ?? "all"] as const,
    queryFn: () => apiFetch(credentials, `/api/progress/history?limit=40${provider ? `&provider=${provider}` : ""}`).then(r => r.json() as Promise<{ items: HistoryItem[] }>),
    staleTime: 30_000,
  });

export const removeHistory = (credentials: Credentials, mediaId: string) =>
  apiFetch(credentials, `/api/progress/${encodeURIComponent(mediaId)}`, { method: "DELETE" });

export type MusicBrowse =
  | { kind: "artists" | "albums"; artist?: MusicArtist; q: string; offset: number }
  | { kind: "album"; album: MusicAlbum; q: string; offset: number };
export type MusicBrowseResult = MusicArtists | MusicAlbums | AlbumTracks;
export type AlbumTracks = { album: MusicAlbum; items: LibraryItem[] };
export const musicPageSize = 24;

export const musicBrowseQuery = (credentials: Credentials, browse: MusicBrowse) => {
  const params = new URLSearchParams({ q: browse.q, offset: String(browse.offset), limit: String(musicPageSize) });
  if (browse.kind === "albums" && browse.artist) params.set("artistId", browse.artist.id);
  const path = browse.kind === "album"
    ? `/api/library/music/albums/${encodeURIComponent(browse.album.id)}`
    : `/api/library/music/${browse.kind}?${params}`;
  return queryOptions({
    queryKey: ["library", "music", credentials.origin, credentials.token, browse] as const,
    queryFn: () => apiFetch(credentials, path).then(response => response.json() as Promise<MusicBrowseResult>),
  });
};
