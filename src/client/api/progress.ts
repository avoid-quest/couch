import { queryOptions } from "@tanstack/react-query";
import type { HistoryItem } from "../../shared/viewing";
import { apiJson, apiSend, type ApiCredentials } from "./client";

// Keys are rooted in the "progress" session domain the server bumps.
export const historyQuery = (credentials: ApiCredentials, provider?: string) =>
  queryOptions({
    queryKey: ["progress", "history", provider ?? "all"] as const,
    queryFn: ({ signal }) => apiJson<{ items: HistoryItem[] }>(credentials, `/api/progress/history?limit=40${provider ? `&provider=${provider}` : ""}`, { signal }),
    staleTime: 30_000,
  });

type Removal = { undoToken?: string; expiresAt?: number };
const progressPath = (mediaId: string) => `/api/progress/${encodeURIComponent(mediaId)}`;
export const updateProgress = (credentials: ApiCredentials, mediaId: string, body: { watched?: boolean; clearResume?: true }) =>
  apiSend<Removal>(credentials, progressPath(mediaId), body, "POST", 10_000);
export const removeHistory = (credentials: ApiCredentials, mediaId: string) =>
  apiSend<Removal>(credentials, progressPath(mediaId), undefined, "DELETE");
export const removeFromContinue = (credentials: ApiCredentials, mediaId: string) => updateProgress(credentials, mediaId, { clearResume: true });
export const undoProgressAction = (credentials: ApiCredentials, undoToken: string) =>
  apiSend(credentials, "/api/progress/undo", { token: undoToken });
