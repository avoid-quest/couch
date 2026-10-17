import { queryOptions } from "@tanstack/react-query";
import type { ForLaterItem } from "../../shared/for-later";
import { playOnQuery } from "@/components/PlayOn";
import { apiJson, apiSend, type ApiCredentials } from "./client";

export const forLaterQuery = (credentials: ApiCredentials) =>
  queryOptions({
    queryKey: ["for-later"],
    staleTime: 30_000,
    queryFn: ({ signal }) => apiJson<{ items: ForLaterItem[] }>(credentials, "/api/for-later", { signal }),
  });

/** Plays (on a Device, with Play on) or queues a saved item: its Details' Play and Queue, and its Home tile's. */
export const loadForLater = (credentials: ApiCredentials, id: string, mode: "play" | "append", on?: string) =>
  apiSend(credentials, `/api/for-later/${encodeURIComponent(id)}/load${playOnQuery(on)}`, { mode }, "POST", 30_000);
