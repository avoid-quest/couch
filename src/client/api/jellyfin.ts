import { queryOptions } from "@tanstack/react-query";
import type { LibraryItem } from "../../shared/library";
import type { Credentials } from "../session/session";
import { apiFetch } from "./client";

export const jellyfinItemsQuery = (credentials: Credentials, search: { query?: string; offset?: number; limit?: number } = {}) =>
  queryOptions({
    queryKey: ["jellyfin", "items", search] as const,
    queryFn: () => {
      const params = new URLSearchParams();
      if (search.query) params.set("q", search.query);
      params.set("offset", String(search.offset ?? 0));
      params.set("limit", String(search.limit ?? 24));
      return apiFetch(credentials, `/api/jellyfin/items?${params}`).then(r => r.json() as Promise<{ items: LibraryItem[]; total: number; offset: number; limit: number }>);
    },
  });

export const jellyfinConnectionQuery = (credentials: Credentials) =>
  queryOptions({
    queryKey: ["jellyfin", "connection"],
    queryFn: () => apiFetch(credentials, "/api/jellyfin/connection").then(r => r.json() as Promise<{ configured: boolean }>),
  });
