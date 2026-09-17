import { queryOptions } from "@tanstack/react-query";
import type { AvoidRadioCatalog, RadioPlaylistSummary, RadioProgrammeDetails, RadioStation } from "../../shared/radio";
import type { Credentials } from "../session/session";
import { apiFetch } from "./client";

export const radioCatalogQuery = (credentials: Credentials) =>
  queryOptions({
    queryKey: ["radio", "avoid"],
    queryFn: () => apiFetch(credentials, "/api/radio/avoid").then(r => r.json() as Promise<AvoidRadioCatalog>),
    staleTime: 60_000,
  });

export const radioFavoritesQuery = (credentials: Credentials) =>
  queryOptions({
    queryKey: ["radio", "favorites"],
    queryFn: () => apiFetch(credentials, "/api/radio/favorites").then(r => r.json() as Promise<RadioStation[]>),
  });

export const radioPlaylistsQuery = (credentials: Credentials) =>
  queryOptions({
    queryKey: ["radio", "playlists"],
    queryFn: () => apiFetch(credentials, "/api/radio/playlists").then(r => r.json() as Promise<RadioPlaylistSummary[]>),
  });

export const radioSourcesQuery = (credentials: Credentials) =>
  queryOptions({
    queryKey: ["radio", "sources"],
    queryFn: () => apiFetch(credentials, "/api/radio/sources").then(r => r.json() as Promise<{ sources: string[] }>),
  });

export const radioProgrammesQuery = (credentials: Credentials) =>
  queryOptions({
    queryKey: ["radio", "avoid", "programmes"],
    queryFn: () => apiFetch(credentials, "/api/radio/avoid/programmes").then(r => r.json() as Promise<Record<string, RadioProgrammeDetails>>),
    staleTime: 30_000,
  });

export const radioFavoritesListQuery = (credentials: Credentials) =>
  queryOptions({
    queryKey: ["radio", "favorites"],
    queryFn: () => apiFetch(credentials, "/api/radio/favorites").then(r => r.json() as Promise<{ favorites: RadioStation[] }>),
  });
