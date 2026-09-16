import { queryOptions } from "@tanstack/react-query";
import type { GuideSource } from "../../shared/iptv";
import type { Credentials } from "../session/session";
import { apiFetch } from "./client";

export const iptvSourcesQuery = (credentials: Credentials) =>
  queryOptions({
    queryKey: ["iptv", "sources"],
    queryFn: () => apiFetch(credentials, "/api/iptv/sources").then(r => r.json() as Promise<{ sources: GuideSource[] }>),
  });

export const guideQuery = (credentials: Credentials, search: { query?: string; source?: string } = {}) =>
  queryOptions({
    queryKey: ["iptv", "guide", search] as const,
    queryFn: () => {
      const params = new URLSearchParams();
      if (search.query) params.set("q", search.query);
      if (search.source) params.set("source", search.source);
      return apiFetch(credentials, `/api/iptv/guide?${params}`).then(r => r.json() as Promise<import("../../shared/iptv").GuidePage>);
    },
  });
