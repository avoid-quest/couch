import { queryOptions, type QueryClient } from "@tanstack/react-query";
import { avoidRadioPlaylistId, type AvoidRadioCatalog, type RadioPlaylistSummary, type RadioProgrammeDetails, type RadioStation } from "../../shared/radio";
import type { Credentials } from "../session/session";
import { apiFetch } from "./client";

export const radioRequest = (credentials: Credentials, path: string, init: RequestInit = {}) =>
  apiFetch(credentials, `/api/radio/${path}`, { ...init, headers: { "Content-Type": "application/json", ...init.headers } });

export const radioCatalogQuery = (credentials: Credentials) =>
  queryOptions({
    queryKey: ["radio", "avoid", credentials.origin, credentials.token] as const,
    queryFn: ({ signal }) => radioRequest(credentials, "avoid", { signal }).then(r => r.json() as Promise<AvoidRadioCatalog>),
    staleTime: 60_000,
  });

// One response shape per cache key, even when a caller wants only the list.
export const radioFavoritesListQuery = (credentials: Credentials) =>
  queryOptions({
    queryKey: ["radio", "favorites", credentials.origin, credentials.token] as const,
    queryFn: ({ signal }) => radioRequest(credentials, "favorites", { signal }).then(r => r.json() as Promise<{ favorites: RadioStation[] }>),
  });

export const radioProgrammesQuery = (credentials: Credentials) =>
  queryOptions({
    queryKey: ["radio", "avoid", "programmes", credentials.origin, credentials.token] as const,
    queryFn: ({ signal }) => radioRequest(credentials, "avoid/programmes", { signal: AbortSignal.any([signal, AbortSignal.timeout(45_000)]) }).then(r => r.json() as Promise<{ programmes: Record<string, RadioProgrammeDetails> }>).then(({ programmes }) => programmes),
    staleTime: 30_000,
  });

export const cancelRadioReads = (client: QueryClient, credentials: Credentials) =>
  Promise.all([radioCatalogQuery(credentials), radioFavoritesListQuery(credentials), radioProgrammesQuery(credentials)].map(query => client.cancelQueries({ queryKey: query.queryKey })));

export const radioPlaylistsQuery = (credentials: Credentials) =>
  queryOptions({
    queryKey: ["radio", "playlists", credentials.origin, credentials.token] as const,
    queryFn: ({ signal }) => radioRequest(credentials, "playlists", { signal }).then(response => response.json() as Promise<{ playlists: RadioPlaylistSummary[] }>),
  });

export const radioPlaylistStationsQuery = (credentials: Credentials, playlistId: string, query: string) =>
  queryOptions({
    queryKey: ["radio", "playlists", credentials.origin, credentials.token, playlistId, query] as const,
    queryFn: ({ signal }) => radioRequest(credentials, `playlists/${encodeURIComponent(playlistId)}/stations?${new URLSearchParams({ q: query })}`, { signal }).then(response => response.json() as Promise<{ stations: RadioStation[] }>),
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

export const radioSearchQuery = (credentials: Credentials, source: "avoid radio" | "Radio playlists" | "Radio directory", query: string, refresh = false) =>
  queryOptions({
    // The external directory is independent of local favorites/source revisions.
    queryKey: [source === "Radio directory" ? "radio-directory" : "radio", "search", source, credentials.origin, query] as const,
    retry: false,
    queryFn: async ({ signal }): Promise<{ stations: RadioStation[]; error?: string }> => {
      if (query.length > 100) throw new Error("Search radio with at most 100 characters.");
      const read = <T,>(path: string) => apiFetch(credentials, path, { signal }, 30_000).then(response => response.json() as Promise<T>);
      const search = new URLSearchParams({ q: query });
      if (source === "avoid radio") {
        const { playlist, stations } = await read<AvoidRadioCatalog>(`/api/radio/avoid${refresh ? "?refresh=true" : ""}`);
        return { stations: stations.filter(station => `${station.name} ${station.groupTitle ?? ""}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())), ...(playlist?.error ? { error: playlist.error } : {}) };
      }
      if (source === "Radio directory") return read<{ stations: RadioStation[] }>(`/api/radio/stations?${search}`);
      const { playlists: all } = await read<{ playlists: RadioPlaylistSummary[] }>("/api/radio/playlists");
      const playlists = all.filter(playlist => playlist.id !== avoidRadioPlaylistId);
      const results: RadioStation[][] = Array.from({ length: playlists.length }, () => []);
      const failures: string[] = [];
      let index = 0;
      // Preserve bounded concurrency and usable partial configured-source results.
      await Promise.all(Array.from({ length: Math.min(3, playlists.length) }, async () => {
        while (index < playlists.length && !signal.aborted) {
          const current = index++, playlist = playlists[current]!;
          try { results[current] = (await read<{ stations: RadioStation[] }>(`/api/radio/playlists/${encodeURIComponent(playlist.id)}/stations?${search}`)).stations; }
          catch (reason) { failures.push(`${playlist.name}: ${reason instanceof Error ? reason.message : "Could not complete this request."}`); }
        }
      }));
      signal.throwIfAborted();
      return { stations: [...new Map(results.flat().map(station => [station.id, station])).values()], ...(failures.length ? { error: failures.join(" ") } : {}) };
    },
  });
