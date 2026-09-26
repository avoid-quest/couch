import { queryOptions } from "@tanstack/react-query";
import type { JellyfinConnection, JellyfinStatus } from "../../shared/jellyfin";
import { apiJson, type ApiCredentials } from "./client";

// Administrators also read the configured server address.
export const jellyfinQuery = (credentials: ApiCredentials, manage = false) =>
  queryOptions({
    queryKey: ["jellyfin", manage ? "connection" : "status"] as const,
    staleTime: 30_000,
    queryFn: ({ signal }) => apiJson<JellyfinStatus | JellyfinConnection>(credentials, manage ? "/api/jellyfin/connection" : "/api/jellyfin", { signal }),
  });
