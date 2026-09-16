import { queryOptions } from "@tanstack/react-query";
import type { ProviderId, ProviderPage } from "../../shared/providers";
import type { Credentials } from "../session/session";
import { apiFetch } from "./client";

export const providerItemsQuery = (credentials: Credentials, provider: ProviderId, url: string) =>
  queryOptions({
    queryKey: ["providers", provider, url] as const,
    queryFn: () => apiFetch(credentials, `/api/providers/${provider}/items?url=${encodeURIComponent(url)}`).then(r => r.json() as Promise<ProviderPage>),
  });

export const providerFavoritesQuery = (credentials: Credentials) =>
  queryOptions({
    queryKey: ["providers", "favorites"],
    queryFn: () => apiFetch(credentials, "/api/providers/favorites").then(r => r.json() as Promise<ProviderPage>),
  });
