import { providerForUrl, type ProviderItem } from "../shared/providers";
import type { HistoryItem } from "../shared/viewing";
import type { QueueEntry } from "../shared/protocol";
import type { Store } from "./store";
import { streamingCommunityList, streamingCommunityWatchContext } from "./streamingcommunity";
import { movies123Title } from "./providers/movies123";

export type ProviderMetadata = Pick<QueueEntry, "subtitle" | "description" | "thumbnail" | "collection">;

// Only catalogue fields enter history. Extractor transport/auth metadata remains private.
export function providerMetadata(item?: ProviderItem, selectedCollection = false): ProviderMetadata {
  if (!item) return {};
  const result: ProviderMetadata = {};
  for (const key of ["subtitle", "description"] as const) {
    const text = item[key]?.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ").trim().slice(0, key === "subtitle" ? 300 : 2000);
    if (text) result[key] = text;
  }
  if (item.thumbnail) {
    try { const url = new URL(item.thumbnail); if (["https:", "http:"].includes(url.protocol) && !url.username && !url.password) result.thumbnail = url.href; } catch { /* Optional artwork. */ }
  }
  if (item.collection && (item.provider !== "youtube" || selectedCollection) && providerForUrl(item.collection.url) === item.provider) result.collection = { ...item.collection };
  return result;
}

export async function resolveProviderMetadata(url: string, signal: AbortSignal, fetchPage: typeof fetch = globalThis.fetch): Promise<ProviderMetadata> {
  if (providerForUrl(url) === "movies123") return providerMetadata((await movies123Title(url, signal, fetchPage)).item);
  if (providerForUrl(url) !== "streamingcommunity") return {};
  const context = /\/titles\/\d+-[\w-]+$/.test(new URL(url).pathname) ? { titleUrl: url, seasonUrl: undefined, episodeId: undefined } : await streamingCommunityWatchContext(url, signal, fetchPage);
  const page = await streamingCommunityList(context.seasonUrl ?? context.titleUrl, signal, fetchPage);
  const item = page.items.find(item => context.episodeId !== undefined
    ? new URL(item.url).searchParams.get("e") === String(context.episodeId)
    : item.url === context.titleUrl);
  return providerMetadata(item);
}

export function createProviderMetadata({ store, cachedItem, resolve = resolveProviderMetadata, onChange }: {
  store: Store; cachedItem: (url: string) => ProviderItem | undefined;
  resolve?: typeof resolveProviderMetadata; onChange: () => void;
}) {
  const shutdown = new AbortController();
  const cache = new Map<string, { value: ProviderMetadata; expires: number }>();
  const pending = new Map<string, Promise<ProviderMetadata>>();
  const waiting: Array<() => void> = [];
  let active = 0;
  const cached = (url: string) => {
    const item = cachedItem(url);
    if (item) return providerMetadata(item);
    const found = cache.get(url);
    return found && found.expires > Date.now() ? found.value : undefined;
  };
  const load = (url: string): Promise<ProviderMetadata> => {
    const known = cached(url);
    if (known) return Promise.resolve(known);
    const existing = pending.get(url);
    if (existing) return existing;
    if (shutdown.signal.aborted || pending.size >= 100 || !["streamingcommunity", "movies123"].includes(providerForUrl(url) ?? "")) return Promise.resolve({});
    const task = Promise.withResolvers<ProviderMetadata>();
    const start = () => {
      if (shutdown.signal.aborted) { pending.delete(url); task.resolve({}); return; }
      active++;
      void Promise.resolve().then(() => resolve(url, shutdown.signal)).catch(() => ({})).then(value => {
        if (!shutdown.signal.aborted) {
          if (cache.size >= 100) cache.delete(cache.keys().next().value!);
          cache.set(url, { value, expires: Date.now() + (Object.keys(value).length ? 20 : 5) * 60_000 });
        }
        task.resolve(value);
      }).finally(() => { active--; pending.delete(url); waiting.shift()?.(); });
    };
    pending.set(url, task.promise);
    if (active < 2) start(); else waiting.push(start);
    return task.promise;
  };
  return {
    cached, load,
    refreshHistory(items: HistoryItem[]) {
      for (const item of items.filter(item => !item.watched && item.position > 0)) {
        const entry = store.historySource(item.mediaId);
        if (!entry || !entry.source.startsWith("web:")) continue;
        void load(entry.source.slice(4)).then(metadata => {
          if (!shutdown.signal.aborted && Object.keys(metadata).length && store.enrichHistorySource(item.mediaId, entry.source, metadata)) onChange();
        }).catch(() => {});
      }
    },
    close() { shutdown.abort(); cache.clear(); for (const start of waiting.splice(0)) start(); },
  };
}
