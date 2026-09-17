import { queryOptions } from "@tanstack/react-query";
import type { ControllerIdentity } from "../../shared/controllers";
import { apiFetch, type ApiCredentials } from "./client";

// Remotes keep their credentials in storage; the TV itself has none and is
// the administrator by default.
export function controllerCredentials(): ApiCredentials | null {
  try {
    const token = localStorage.getItem("couch.remote-token");
    return token ? { origin: location.origin, token } : null;
  } catch { return null; }
}

export function identityQuery() {
  return queryOptions({
    queryKey: ["controllers", "me"] as const,
    queryFn: async ({ signal }): Promise<ControllerIdentity | null> => {
      const credentials = controllerCredentials();
      if (!credentials) return null;
      const response = await apiFetch(credentials, "/api/controllers/me", { signal });
      return await response.json() as ControllerIdentity;
    },
    retry: false,
  });
}
