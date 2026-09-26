import { queryOptions } from "@tanstack/react-query";
import type { HistoryItem, LibraryItem, LibrarySource, MusicAlbums, MusicArtists, MusicAlbum } from "../../shared/library";
import type { FolderBrowse, ManagedFolder } from "../../shared/folders";
import type { MetadataView } from "../../shared/metadata";
import { apiFetch, apiJson, apiSend, type ApiCredentials } from "./client";

// Keys are rooted in the session domain the server bumps: ["library"] for
// catalog content, ["progress"] for history and Continue.
// Administrators read the managed folder paths behind each source.
export const libraryFoldersQuery = (credentials: ApiCredentials, manage = true) =>
  queryOptions({
    queryKey: ["library", manage ? "folders" : "sources"] as const,
    staleTime: 30_000,
    queryFn: ({ signal }) => apiJson<{ sources: (LibrarySource & Partial<ManagedFolder>)[] }>(credentials, manage ? "/api/library/folders" : "/api/library/sources", { signal }),
  });

export const librarySourcesQuery = (credentials: ApiCredentials) => libraryFoldersQuery(credentials, false);

export const musicPageSize = 24;
export const musicArtistsQuery = (credentials: ApiCredentials, offset: number) =>
  queryOptions({
    queryKey: ["library", "music", "artists", offset] as const,
    queryFn: ({ signal }) => apiJson<MusicArtists>(credentials, `/api/library/music/artists?offset=${offset}&limit=${musicPageSize}`, { signal }),
  });
export const musicAlbumsQuery = (credentials: ApiCredentials, offset: number, artistId?: string) =>
  queryOptions({
    queryKey: ["library", "music", "albums", artistId, offset] as const,
    queryFn: ({ signal }) => apiJson<MusicAlbums>(credentials, `/api/library/music/albums?${new URLSearchParams({ offset: String(offset), limit: String(musicPageSize), ...(artistId ? { artistId } : {}) })}`, { signal }),
  });
export const musicAlbumQuery = (credentials: ApiCredentials, albumId: string) =>
  queryOptions({
    queryKey: ["library", "music", "album", albumId] as const,
    queryFn: ({ signal }) => apiJson<{ album: MusicAlbum; items: LibraryItem[] }>(credentials, `/api/library/music/albums/${encodeURIComponent(albumId)}`, { signal }),
  });

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
