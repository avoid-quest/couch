import { queryOptions } from "@tanstack/react-query";
import type { Controller } from "../../shared/controllers";
import { apiFetch, type ApiCredentials } from "./client";

// Identity comes from the live session handshake, never a second storage read.
// SessionGate replaces the entire client on a connection or authority change.
export function controllersQuery(credentials: ApiCredentials) {
  return queryOptions({
    queryKey: ["controllers", "list"] as const,
    queryFn: async ({ signal }): Promise<Controller[]> => {
      const response = await apiFetch(credentials, "/api/controllers", { signal });
      return (await response.json() as { controllers: Controller[] }).controllers;
    },
    retry: false,
  });
}
