import { queryOptions } from "@tanstack/react-query";
import type { SavedPlaylist, SavedPlaylistSummary } from "../../shared/playlists";
import { apiJson, type ApiCredentials } from "./client";

export const playlistsQuery = (credentials: ApiCredentials) =>
  queryOptions({
    staleTime: 30_000,
    queryKey: ["playlists", "list"],
    queryFn: ({ signal }) => apiJson<{ playlists: SavedPlaylistSummary[] }>(credentials, "/api/playlists", { signal }, 10_000),
  });

export const playlistQuery = (credentials: ApiCredentials, id: string) =>
  queryOptions({
    staleTime: 30_000,
    queryKey: ["playlists", "detail", id] as const,
    queryFn: ({ signal }) => apiJson<{ playlist: SavedPlaylist }>(credentials, `/api/playlists/${encodeURIComponent(id)}`, { signal }, 10_000),
  });
