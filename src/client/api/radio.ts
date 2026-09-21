import { queryOptions } from "@tanstack/react-query";
import { avoidRadioPlaylistId, type AvoidRadioCatalog, type RadioPlaylistSummary, type RadioProgrammeDetails, type RadioStation } from "../../shared/radio";
import type { Credentials } from "../session/session";
import { apiFetch } from "./client";

export const radioCatalogQuery = (credentials: Credentials) =>
  queryOptions({
    queryKey: ["radio", "avoid"],
    queryFn: ({ signal }) => apiFetch(credentials, "/api/radio/avoid", { signal }).then(r => r.json() as Promise<AvoidRadioCatalog>),
    staleTime: 60_000,
  });

// One response shape per cache key, even when a caller wants only the list.
export const radioFavoritesListQuery = (credentials: Credentials) =>
  queryOptions({
    queryKey: ["radio", "favorites", credentials.origin] as const,
    queryFn: ({ signal }) => apiFetch(credentials, "/api/radio/favorites", { signal }).then(r => r.json() as Promise<{ favorites: RadioStation[] }>),
  });

export const radioProgrammesQuery = (credentials: Credentials) =>
  queryOptions({
    queryKey: ["radio", "avoid", "programmes"],
    queryFn: ({ signal }) => apiFetch(credentials, "/api/radio/avoid/programmes", { signal }).then(r => r.json() as Promise<Record<string, RadioProgrammeDetails>>),
    staleTime: 30_000,
  });

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
