import { queryOptions } from "@tanstack/react-query";
import type { HistoryItem, LibraryItem, LibrarySearch, LibrarySource } from "../../shared/library";
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
