import { infiniteQueryOptions, queryOptions } from "@tanstack/react-query";
import type { BrowseRequest, ProviderId, ProviderItem, ProviderPage } from "../../shared/providers";
import type { Credentials } from "../session/session";
import { apiFetch } from "./client";

export type ProviderSearchPage = ProviderPage & { warning?: string };

async function browse(credentials: Credentials, provider: ProviderId, target: BrowseRequest, signal: AbortSignal): Promise<ProviderSearchPage> {
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

export const providerBrowseQuery = (credentials: Credentials, provider: ProviderId, request: BrowseRequest) =>
  infiniteQueryOptions({
    queryKey: ["search", "providers", credentials.origin, provider, request] as const,
    initialPageParam: request.cursor as string | undefined,
    queryFn: ({ pageParam, signal }) => browse(credentials, provider, { ...request, cursor: pageParam }, signal),
    getNextPageParam: (page: ProviderSearchPage) => page.nextCursor || undefined,
    staleTime: 60_000,
    retry: false,
  });

export const providerItemsQuery = (credentials: Credentials, provider: ProviderId, url: string) =>
  queryOptions({
    queryKey: ["providers", provider, url] as const,
    queryFn: ({ signal }) => browse(credentials, provider, { url }, signal),
  });

export const providerFavoritesQuery = (credentials: Credentials) =>
  queryOptions({
    queryKey: ["providers", "favorites", credentials.origin] as const,
    queryFn: ({ signal }) => apiFetch(credentials, "/api/providers/favorites", { signal }).then(r => r.json() as Promise<{ favorites: ProviderItem[] }>),
  });
