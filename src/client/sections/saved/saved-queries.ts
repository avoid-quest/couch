import { queryOptions } from "@tanstack/react-query";
import type { ForLaterItem } from "../../../shared/for-later";
import type { ProviderItem } from "../../../shared/providers";
import type { RadioStation } from "../../../shared/radio";
import type { Credentials } from "../../session/session";
import { apiFetch } from "../../api/client";

// These three reads mirror api/for-later.ts, api/providers.ts and api/radio.ts
// but type the real wire shapes ({ items } and { favorites } envelopes) that
// the shared files miss. The session invalidates ["for-later"], ["providers"]
// and ["radio"] on socket revisions. Flagged on #362: cleanup (#366) should
// fold these into the api/ files and delete this module.
export const forLaterItemsQuery = (credentials: Credentials) =>
  queryOptions({
    queryKey: ["for-later"],
    queryFn: () => apiFetch(credentials, "/api/for-later").then(r => r.json() as Promise<{ items: ForLaterItem[] }>),
  });

export const providerFavoritesListQuery = (credentials: Credentials) =>
  queryOptions({
    queryKey: ["providers", "favorites"],
    queryFn: () => apiFetch(credentials, "/api/providers/favorites").then(r => r.json() as Promise<{ favorites: ProviderItem[] }>),
  });

export const radioFavoritesListQuery = (credentials: Credentials) =>
  queryOptions({
    queryKey: ["radio", "favorites"],
    queryFn: () => apiFetch(credentials, "/api/radio/favorites").then(r => r.json() as Promise<{ favorites: RadioStation[] }>),
  });
