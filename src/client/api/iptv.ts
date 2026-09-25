import { queryOptions } from "@tanstack/react-query";
import type { GuidePage, GuideSource } from "../../shared/iptv";
import { apiJson, type ApiCredentials } from "./client";

export const iptvSourcesQuery = (credentials: ApiCredentials) =>
  queryOptions({
    queryKey: ["iptv", "sources"],
    queryFn: ({ signal }) => apiJson<{ sources: GuideSource[] }>(credentials, "/api/iptv/sources", { signal }),
  });

export const guidePageQuery = (credentials: ApiCredentials, search: { query: string; group: string; offset: number }) =>
  queryOptions({
    queryKey: ["iptv", "guide", search] as const,
    queryFn: ({ signal }) => apiJson<GuidePage>(credentials, `/api/iptv/guide?${new URLSearchParams({ q: search.query, group: search.group, offset: String(search.offset) })}`, { signal }),
  });

export const iptvLiveEdgeQuery = (credentials: ApiCredentials, channelId: string | null) =>
  queryOptions({
    queryKey: ["iptv", "live-edge", channelId] as const,
    enabled: !!channelId,
    queryFn: ({ signal }) => apiJson<{ liveEdge: "reload" | null }>(credentials, `/api/iptv/channels/${channelId}/capabilities`, { signal }),
  });
