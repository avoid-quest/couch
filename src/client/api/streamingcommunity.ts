import { queryOptions } from "@tanstack/react-query";
import type { ProviderPage, StreamingCommunityPreview } from "../../shared/providers";
import type { Credentials } from "../session/session";
import { apiFetch } from "./client";

export type StreamingCommunityBrowse = { q?: string; url?: string; cursor?: string };

export const streamingCommunityBrowse = (credentials: Credentials, request: StreamingCommunityBrowse, signal?: AbortSignal) =>
  apiFetch(credentials, `/api/providers/streamingcommunity/items?${new URLSearchParams(Object.entries(request).filter((entry): entry is [string, string] => entry[1] !== undefined))}`, { signal }).then(response => response.json() as Promise<ProviderPage>);

export const streamingCommunityPreviewQuery = (credentials: Credentials, id: number | null, version = 0) =>
  queryOptions({
    queryKey: ["providers", "streamingcommunity", version, "titles", id] as const,
    queryFn: ({ signal }) => apiFetch(credentials, `/api/providers/streamingcommunity/titles/${id}`, { signal }).then(response => response.json() as Promise<StreamingCommunityPreview>),
    enabled: id !== null,
  });
