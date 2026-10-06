import { queryOptions } from "@tanstack/react-query";
import type { GuidePage, GuideSource } from "../../shared/iptv";
import { ApiError, apiFetch, apiJson, type ApiCredentials } from "./client";

// Core gives a refresh 20 seconds; allow transport time for its result too.
export async function iptvRequest(credentials: ApiCredentials, path: string, init: RequestInit = {}) {
  try {
    return await apiFetch(credentials, `/api/iptv/${path}`, { ...init, headers: { "Content-Type": "application/json", ...init.headers } }, 25_000);
  } catch (error) {
    init.signal?.throwIfAborted();
    if (error instanceof DOMException && error.name === "TimeoutError") throw new Error("Live TV took too long to respond. Try refreshing the source again.");
    throw error;
  }
}

export const iptvSourcesQuery = (credentials: ApiCredentials) =>
  queryOptions({
    queryKey: ["iptv", "sources"],
    queryFn: ({ signal }) => apiJson<{ sources: GuideSource[] }>(credentials, "/api/iptv/sources", { signal }),
  });

/** Up to 50 channels from offset, each with what's on now and next. */
export const iptvGuideQuery = (credentials: ApiCredentials, search: { offset: number; group: string; q: string }) =>
  queryOptions({
    queryKey: ["iptv", "guide", search],
    queryFn: ({ signal }) => apiJson<GuidePage>(credentials, `/api/iptv/guide?${new URLSearchParams({ offset: String(search.offset), group: search.group, q: search.q })}`, { signal }),
  });

// Logos stay behind Core's auth, so they load as blobs. Core fetches at most eight
// at once and answers busy past that, hence the retries. Kept outside ["iptv"] so a
// guide change doesn't refetch every logo.
export const iptvLogoQuery = (credentials: ApiCredentials, channelId: string) =>
  queryOptions({
    queryKey: ["iptv-logo", channelId],
    queryFn: ({ signal }) => apiFetch(credentials, `/api/iptv/channels/${channelId}/logo`, { signal }).then(response => response.blob()),
    staleTime: 5 * 60_000,
    retry: (attempt, error) => attempt < 3 && (!(error instanceof ApiError) || error.status >= 500),
  });
