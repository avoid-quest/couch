import { infiniteQueryOptions, queryOptions } from "@tanstack/react-query";
import type { BrowseRequest, ProviderId, ProviderItem, ProviderPage } from "../../shared/providers";
import { apiFetch, apiJson, type ApiCredentials } from "./client";

export type ProviderSearchPage = ProviderPage & { warning?: string };

export const providerPageQuery = (credentials: ApiCredentials, provider: ProviderId, request: BrowseRequest) => queryOptions({
  queryKey: ["search", "provider-page", provider, request] as const,
  queryFn: ({ signal }) => browse(credentials, provider, request, signal),
  staleTime: 60_000, retry: false,
});

async function browse(credentials: ApiCredentials, provider: ProviderId, target: BrowseRequest, signal: AbortSignal): Promise<ProviderSearchPage> {
  const read = (request: BrowseRequest) => apiFetch(credentials,
    `/api/providers/${provider}/items?${new URLSearchParams(Object.entries({ q: request.query, url: request.url, cursor: request.cursor }).filter((entry): entry is [string, string] => !!entry[1]))}`,
    { signal }, 30_000).then(response => response.json() as Promise<ProviderPage>);
  if (provider !== "raiplay" || !target.query || target.cursor) return read(target);
  const [catalogue, live] = await Promise.allSettled([read(target), read({ url: "https://www.raiplay.it/dirette" })]);
  signal.throwIfAborted();
  const normalize = (value: string) => value.toLocaleLowerCase().replace(/\s/g, "");
  const channels = live.status === "fulfilled" ? live.value.items.filter(item => normalize(item.title).includes(normalize(target.query!))) : [];
  if (catalogue.status === "rejected" && !channels.length) throw catalogue.reason;
  const result = catalogue.status === "fulfilled" ? catalogue.value : { items: [] };
  return { ...result, items: [...channels, ...result.items.filter(item => !channels.some(channel => channel.id === item.id))],
    ...(catalogue.status === "rejected" || live.status === "rejected" ? { warning: "Some RaiPlay results could not be loaded. Try this search again to refresh them." } : {}) };
}

// External catalogs are not Couch state: keep them outside pushed domains so a
// kept item does not re-run every open provider search.
export const providerBrowseQuery = (credentials: ApiCredentials, provider: ProviderId, request: BrowseRequest) =>
  infiniteQueryOptions({
    queryKey: ["search", "providers", provider, request] as const,
    initialPageParam: request.cursor as string | undefined,
    queryFn: ({ pageParam, signal }) => browse(credentials, provider, { ...request, cursor: pageParam }, signal),
    getNextPageParam: (page: ProviderSearchPage) => page.nextCursor || undefined,
    staleTime: 60_000,
    retry: false,
  });

export const providerFavoritesQuery = (credentials: ApiCredentials) =>
  queryOptions({
    queryKey: ["providers", "favorites"],
    staleTime: 30_000,
    queryFn: ({ signal }) => apiJson<{ favorites: ProviderItem[] }>(credentials, "/api/providers/favorites", { signal }),
  });
