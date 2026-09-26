import { providerForUrl, type ProviderItem } from "../shared/providers";
import type { HistoryItem } from "../shared/library";
import type { QueueEntry } from "../shared/protocol";
import type { Store } from "./store";
import { streamingCommunityList, streamingCommunityWatchContext } from "./streamingcommunity";

export type ProviderMetadata = Pick<QueueEntry, "subtitle" | "description" | "thumbnail">;

// Only catalogue fields enter history. Extractor transport/auth metadata remains private.
export function providerMetadata(item?: ProviderItem): ProviderMetadata {
  if (!item) return {};
  const result: ProviderMetadata = {};
  for (const key of ["subtitle", "description"] as const) {
    const text = item[key]?.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ").trim().slice(0, key === "subtitle" ? 300 : 2000);
    if (text) result[key] = text;
  }
  if (item.thumbnail) {
    try { const url = new URL(item.thumbnail); if (["https:", "http:"].includes(url.protocol) && !url.username && !url.password) result.thumbnail = url.href; } catch { /* Optional artwork. */ }
  }
  return result;
}

export async function resolveProviderMetadata(url: string, signal: AbortSignal, fetchPage: typeof fetch = globalThis.fetch): Promise<ProviderMetadata> {
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
    if (shutdown.signal.aborted || active >= 2 || providerForUrl(url) !== "streamingcommunity") return Promise.resolve({});
    active++;
    const task = resolve(url, shutdown.signal).catch(() => ({})).then(value => {
      if (!shutdown.signal.aborted) {
        if (cache.size >= 100) cache.delete(cache.keys().next().value!);
        cache.set(url, { value, expires: Date.now() + (Object.keys(value).length ? 20 : 5) * 60_000 });
      }
      return value;
    }).finally(() => { active--; pending.delete(url); });
    pending.set(url, task);
    return task;
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
    close() { shutdown.abort(); cache.clear(); },
  };
}
