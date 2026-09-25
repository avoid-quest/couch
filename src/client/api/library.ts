import { queryOptions } from "@tanstack/react-query";
import type { HistoryItem, LibraryItem, LibrarySource, MusicAlbum, MusicAlbums, MusicArtist, MusicArtists } from "../../shared/library";
import type { FolderBrowse, ManagedFolder } from "../../shared/folders";
import type { MetadataView } from "../../shared/metadata";
import { apiFetch, apiJson, apiSend, type ApiCredentials } from "./client";

// Keys are rooted in the session domain the server bumps: ["library"] for
// catalog content, ["progress"] for history and Continue.
// Administrators read the managed folder paths behind each source.
export const libraryFoldersQuery = (credentials: ApiCredentials, manage = true) =>
  queryOptions({
    queryKey: ["library", manage ? "folders" : "sources"] as const,
    queryFn: ({ signal }) => apiJson<{ sources: (LibrarySource & Partial<ManagedFolder>)[] }>(credentials, manage ? "/api/library/folders" : "/api/library/sources", { signal }),
  });

export const librarySourcesQuery = (credentials: ApiCredentials) => libraryFoldersQuery(credentials, false);

export const folderBrowseQuery = (credentials: ApiCredentials, path: string | null, offset = 0) =>
  queryOptions({
    queryKey: ["library", "folders", "browse", path, offset] as const,
    queryFn: ({ signal }) => apiJson<FolderBrowse>(credentials, `/api/library/folders/browse${path === null && !offset ? "" : `?${new URLSearchParams({ ...(path === null ? {} : { path }), offset: String(offset) })}`}`, { signal }),
  });

export const metadataItemQuery = (credentials: ApiCredentials, id: string) =>
  queryOptions({
    queryKey: ["library", "metadata", id] as const,
    queryFn: ({ signal }) => apiJson<MetadataView>(credentials, `/api/metadata/items/${id}`, { signal }),
  });

export const metadataProviderQuery = (credentials: ApiCredentials) =>
  queryOptions({
    queryKey: ["library", "metadata", "provider"],
    queryFn: ({ signal }) => apiJson<{ configured: boolean; provider: string }>(credentials, "/api/metadata/provider", { signal }),
  });

// Artwork IDs name immutable images, so blobs stay outside any pushed domain.
export const artworkQuery = (credentials: ApiCredentials, id: string) =>
  queryOptions({
    queryKey: ["artwork", id] as const,
    staleTime: Infinity,
    retry: false,
    queryFn: async ({ signal }) => {
      const response = await apiFetch(credentials, `/api/library/artwork/${encodeURIComponent(id)}`, { signal }, 10_000);
      const blob = await response.blob();
      return blob.size && blob.type.startsWith("image/") ? blob : null;
    },
  });

export const historyQuery = (credentials: ApiCredentials, provider?: string) =>
  queryOptions({
    queryKey: ["progress", "history", provider ?? "all"] as const,
    queryFn: ({ signal }) => apiJson<{ items: HistoryItem[] }>(credentials, `/api/progress/history?limit=40${provider ? `&provider=${provider}` : ""}`, { signal }),
    staleTime: 30_000,
  });

type Removal = { undoToken?: string; expiresAt?: number };
const progressPath = (mediaId: string) => `/api/progress/${encodeURIComponent(mediaId)}`;
export const updateProgress = (credentials: ApiCredentials, mediaId: string, body: { watched?: boolean; clearResume?: true }) =>
  apiSend<Removal>(credentials, progressPath(mediaId), body, "POST", 10_000);
export const removeHistory = (credentials: ApiCredentials, mediaId: string) =>
  apiSend<Removal>(credentials, progressPath(mediaId), undefined, "DELETE");
export const removeFromContinue = (credentials: ApiCredentials, mediaId: string) => updateProgress(credentials, mediaId, { clearResume: true });
export const undoProgressAction = (credentials: ApiCredentials, undoToken: string) =>
  apiSend(credentials, "/api/progress/undo", { token: undoToken });

export type MusicBrowse =
  | { kind: "artists" | "albums"; artist?: MusicArtist; q: string; offset: number }
  | { kind: "album"; album: MusicAlbum; q: string; offset: number };
export type MusicBrowseResult = MusicArtists | MusicAlbums | AlbumTracks;
export type AlbumTracks = { album: MusicAlbum; items: LibraryItem[] };
export const musicPageSize = 24;

export const musicBrowseQuery = (credentials: ApiCredentials, browse: MusicBrowse) => {
  const params = new URLSearchParams({ q: browse.q, offset: String(browse.offset), limit: String(musicPageSize) });
  if (browse.kind === "albums" && browse.artist) params.set("artistId", browse.artist.id);
  const path = browse.kind === "album"
    ? `/api/library/music/albums/${encodeURIComponent(browse.album.id)}`
    : `/api/library/music/${browse.kind}?${params}`;
  return queryOptions({
    queryKey: ["library", "music", browse] as const,
    queryFn: ({ signal }) => apiJson<MusicBrowseResult>(credentials, path, { signal }),
  });
};
