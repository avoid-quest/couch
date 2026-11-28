import { queryOptions } from "@tanstack/react-query";
import type { ForLaterItem } from "../../shared/for-later";
import { playOnQuery } from "@/components/PlayOn";
import { apiJson, apiSend, type ApiCredentials } from "./client";
import type { PlayOn } from "../../shared/protocol";

export const forLaterQuery = (credentials: ApiCredentials) =>
  queryOptions({
    queryKey: ["for-later"],
    staleTime: 30_000,
    queryFn: ({ signal }) =>
      apiJson<{ items: ForLaterItem[] }>(credentials, "/api/for-later", { signal }),
  });

/** Plays (on a Device, with Play on) or queues a saved item: its Details' Play and Queue, and its Home tile's. */
export const loadForLater = (
  credentials: ApiCredentials,
  id: string,
  mode: "play" | "append",
  on?: PlayOn,
) =>
  apiSend(
    credentials,
    `/api/for-later/${encodeURIComponent(id)}/load${playOnQuery(on)}`,
    { mode },
    "POST",
    30_000,
  );

/** Takes an item out of For later; the token Core answers with restores it, as its Undo. */
export const removeForLater = (credentials: ApiCredentials, id: string) =>
  apiSend<{ undoToken?: string }>(
    credentials,
    `/api/for-later/${encodeURIComponent(id)}`,
    undefined,
    "DELETE",
  );
export const restoreForLater = (credentials: ApiCredentials, token: string) =>
  apiSend(credentials, "/api/for-later/restore", { token }, "POST", 10_000);
