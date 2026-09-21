import { queryOptions } from "@tanstack/react-query";
import type { GuidePage, GuideSource } from "../../shared/iptv";
import type { Credentials } from "../session/session";
import { apiFetch } from "./client";

export const iptvSourcesQuery = (credentials: Credentials) =>
  queryOptions({
    queryKey: ["iptv", "sources"],
    queryFn: ({ signal }) => apiFetch(credentials, "/api/iptv/sources", { signal }).then(r => r.json() as Promise<{ sources: GuideSource[] }>),
  });

export const guideQuery = (credentials: Credentials, search: { query?: string; source?: string } = {}) =>
  queryOptions({
    queryKey: ["iptv", "guide", search] as const,
    queryFn: ({ signal }) => {
      const params = new URLSearchParams();
      if (search.query) params.set("q", search.query);
      if (search.source) params.set("source", search.source);
      return apiFetch(credentials, `/api/iptv/guide?${params}`, { signal }).then(r => r.json() as Promise<import("../../shared/iptv").GuidePage>);
    },
  });

export const guidePageQuery = (credentials: Credentials, search: { query: string; group: string; offset: number }) =>
  queryOptions({
    queryKey: ["iptv", "guide", search] as const,
    queryFn: ({ signal }) => {
      const params = new URLSearchParams({ q: search.query, group: search.group, offset: String(search.offset) });
      return apiFetch(credentials, `/api/iptv/guide?${params}`, { signal }).then(r => r.json() as Promise<GuidePage>);
    },
  });

export const iptvLiveEdgeQuery = (credentials: Credentials, channelId: string | null) =>
  queryOptions({
    queryKey: ["iptv", "live-edge", channelId] as const,
    enabled: !!channelId,
    queryFn: ({ signal }) => apiFetch(credentials, `/api/iptv/channels/${channelId}/capabilities`, { signal }).then(r => r.json() as Promise<{ liveEdge: "reload" | null }>),
  });
