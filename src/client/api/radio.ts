import { queryOptions } from "@tanstack/react-query";
import { avoidRadioPlaylistId, type AvoidRadioCatalog, type RadioPlaylist, type RadioPlaylistSummary, type RadioProgrammeDetails, type RadioStation } from "../../shared/radio";
import { apiFetch, type ApiCredentials } from "./client";

const radioRequest = (credentials: ApiCredentials, path: string, init: RequestInit = {}) =>
  apiFetch(credentials, `/api/radio/${path}`, { ...init, headers: { "Content-Type": "application/json", ...init.headers } });

export const radioStationQuery = (credentials: ApiCredentials, id: string) => queryOptions({
  queryKey: ["radio", "item", id], staleTime: 30_000, retry: false,
  queryFn: ({ signal }) => radioRequest(credentials, `stations/${encodeURIComponent(id)}`, { signal }).then(response => response.json() as Promise<{ station: RadioStation }>).then(result => result.station),
});

export const radioFavoritesListQuery = (credentials: ApiCredentials) =>
  queryOptions({
    queryKey: ["radio", "favorites"],
    staleTime: 30_000,
    queryFn: ({ signal }) => radioRequest(credentials, "favorites", { signal }).then(r => r.json() as Promise<{ favorites: RadioStation[] }>),
  });

export const radioSourcesQuery = (credentials: ApiCredentials) =>
  queryOptions({
    queryKey: ["radio", "sources"],
    queryFn: ({ signal }) => radioRequest(credentials, "sources", { signal }).then(response => response.json() as Promise<{ sources: RadioPlaylist[] }>),
  });

export const radioProgrammesQuery = (credentials: ApiCredentials) =>
  queryOptions({
    queryKey: ["radio", "avoid", "programmes"] as const,
    queryFn: ({ signal }) => radioRequest(credentials, "avoid/programmes", { signal }).then(response => response.json() as Promise<{ programmes: Record<string, RadioProgrammeDetails> }>).then(result => result.programmes),
    staleTime: 30_000,
  });

export const radioSearchQuery = (credentials: ApiCredentials, source: "avoid radio" | "Radio playlists" | "Radio directory", query: string, refresh = false) =>
  queryOptions({
    // The external directory is independent of local favorites/source revisions.
    queryKey: [source === "Radio directory" ? "radio-directory" : "radio", "search", source, source === "avoid radio" ? "" : query] as const,
    staleTime: 30_000,
    // The built-in catalogue is shared; each observer selects its own search.
    select: (data: { stations: RadioStation[]; error?: string }) => {
      if (query.length > 100) throw new Error("Search radio with at most 100 characters.");
      return source === "avoid radio" ? { ...data, stations: data.stations.filter(station => `${station.name} ${station.groupTitle ?? ""}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())) } : data;
    },
    retry: false,
    queryFn: async ({ signal }): Promise<{ stations: RadioStation[]; error?: string }> => {
      if (source !== "avoid radio" && query.length > 100) throw new Error("Search radio with at most 100 characters.");
      const read = <T,>(path: string) => apiFetch(credentials, path, { signal }, 30_000).then(response => response.json() as Promise<T>);
      const search = new URLSearchParams({ q: query });
      if (source === "avoid radio") {
        const { playlist, stations } = await read<AvoidRadioCatalog>(`/api/radio/avoid${refresh ? "?refresh=true" : ""}`);
        return { stations, ...(playlist?.error ? { error: playlist.error } : {}) };
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
