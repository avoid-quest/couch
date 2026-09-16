import { queryOptions } from "@tanstack/react-query";
import type { RadioPlaylistSummary, RadioStation } from "../../../shared/radio";
import type { Credentials } from "../../session/session";
import { apiFetch } from "../../api/client";

const radioPath = (path: string) => `/api/radio/${path}`;

export const radioRequest = (credentials: Credentials, path: string, init: RequestInit = {}) =>
  apiFetch(credentials, radioPath(path), { ...init, headers: { "Content-Type": "application/json", ...init.headers } });

export const avoidRadioQuery = (credentials: Credentials, active: boolean, refresh = 0) =>
  queryOptions({
    queryKey: ["radio", "avoid", credentials.origin, credentials.token, refresh] as const,
    queryFn: () => radioRequest(credentials, `avoid${refresh ? "?refresh=true" : ""}`).then(response => response.json() as Promise<{ playlist: { error: string | null }; stations: RadioStation[] }>),
    enabled: active,
    staleTime: 60_000,
    retry: false,
  });

export const radioFavoritesQuery = (credentials: Credentials, active: boolean) =>
  queryOptions({
    queryKey: ["radio", "favorites", credentials.origin, credentials.token] as const,
    queryFn: () => radioRequest(credentials, "favorites").then(response => response.json() as Promise<{ favorites: RadioStation[] }>),
    enabled: active,
  });

export const radioPlaylistsQuery = (credentials: Credentials, active: boolean) =>
  queryOptions({
    queryKey: ["radio", "playlists", credentials.origin, credentials.token] as const,
    queryFn: () => radioRequest(credentials, "playlists").then(response => response.json() as Promise<{ playlists: RadioPlaylistSummary[] }>),
    enabled: active,
  });

export const radioPlaylistStationsQuery = (credentials: Credentials, playlistId: string, query: string, active: boolean) =>
  queryOptions({
    queryKey: ["radio", "playlists", credentials.origin, credentials.token, playlistId, query] as const,
    queryFn: () => radioRequest(credentials, `playlists/${encodeURIComponent(playlistId)}/stations?${new URLSearchParams({ q: query })}`).then(response => response.json() as Promise<{ stations: RadioStation[] }>),
    enabled: active,
  });

export const searchRadioStations = async (credentials: Credentials, query: string, country: string, signal: AbortSignal) => {
  const params = new URLSearchParams({ q: query.trim(), countrycode: country.trim() });
  const response = await radioRequest(credentials, `stations?${params}`, { signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]) });
  return (await response.json() as { stations: RadioStation[] }).stations;
};

export const saveRadioFavorite = async (credentials: Credentials, station: RadioStation, saved: boolean, signal: AbortSignal) => {
  await radioRequest(credentials, saved ? `favorites/${station.id}` : "favorites", {
    method: saved ? "DELETE" : "POST",
    body: saved ? undefined : JSON.stringify({ station }),
    signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
  });
};
