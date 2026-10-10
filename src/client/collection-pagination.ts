import { providerForUrl, type ProviderId } from "../shared/providers";
import type { CollectionLink, MediaCollection } from "../shared/media";

export const collectionPageSize = 24;
export function readCollectionSearch(search: Record<string, unknown>) {
  const url = typeof search.url === "string" && search.url.length <= 4096 ? search.url : undefined;
  const provider = ["youtube", "twitch", "raiplay", "bandcamp", "soundcloud", "streamingcommunity"].includes(String(search.provider)) && (search.url === undefined || search.url === "" || !!url && providerForUrl(url) === search.provider) ? search.provider as ProviderId : undefined;
  const cursors = Array.isArray(search.cursors) && search.cursors.length <= 100 && search.cursors.every(cursor => typeof cursor === "string" && cursor.length > 0 && cursor.length <= 4096) ? search.cursors as string[] : [];
  const page = typeof search.page === "number" && Number.isSafeInteger(search.page) && search.page > 0 && search.page <= 10000 ? search.page : 1;
  const filter = typeof search.filter === "string" ? search.filter.slice(0, 200) : "";
  const validLink = (link: unknown): link is CollectionLink => !!link && typeof link === "object" && "title" in link && typeof link.title === "string" && link.title.length > 0 && link.title.length <= 300
    && !/[\u0000-\u001f\u007f]/.test(link.title) && "url" in link && typeof link.url === "string" && link.url.length <= 4096 && !!provider && providerForUrl(link.url) === provider;
  const value = search.context;
  const context: MediaCollection | undefined = validLink(value) ? { title: value.title, url: value.url,
    ...("parent" in value && validLink(value.parent) ? { parent: value.parent } : {}),
    ...("index" in value && typeof value.index === "number" && Number.isSafeInteger(value.index) && value.index >= 0 && value.index <= 2400 ? { index: value.index } : {}) } : undefined;
  return { provider, url, cursors, page, filter, ...(context ? { context } : {}) };
}

export const providerCollectionCursor = (provider: ProviderId, collection: MediaCollection) =>
  ["youtube", "raiplay"].includes(provider) && collection.index != null && collection.index >= collectionPageSize ? String(Math.floor(collection.index / collectionPageSize) * collectionPageSize) : undefined;

export function collectionPagination(count: number, requested: number, cursors: string[], nextCursor?: string) {
  const remote = cursors.length > 0 || !!nextCursor;
  const pages = remote ? undefined : Math.max(1, Math.ceil(count / collectionPageSize));
  const page = remote ? cursors.length + 1 : Math.min(requested, pages!);
  return { remote, page, pages, start: remote ? 0 : (page - 1) * collectionPageSize,
    end: remote ? count : Math.min(page * collectionPageSize, count),
    previous: remote ? cursors.length > 0 : page > 1,
    next: remote ? !!nextCursor : page < pages! };
}
