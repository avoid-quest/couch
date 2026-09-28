import type { QueueEntry } from "../shared/protocol";
import { isYouTubePlaylistUrl, providerForUrl } from "../shared/providers";
import { providerMetadata } from "./provider-metadata";
import { loadProviderList } from "./providers";
import { streamingCommunityWatchContext } from "./streamingcommunity";

export type PlaybackContinuation = { title: string; entries: QueueEntry[] };

function streamingEpisode(value: string) {
  if (providerForUrl(value) !== "streamingcommunity") return null;
  const url = new URL(value);
  const title = /^\/(?:[a-z]{2}\/)?watch\/(\d+)$/.exec(url.pathname)?.[1];
  const episode = /^\?e=(\d+)$/.exec(url.search)?.[1];
  return title && episode ? { origin: url.origin, title, episode } : null;
}

// Only a source's album or numbered series defines automatic continuation.
// Results stay private to playback; resolving them never edits the manual queue.
export function createContinuationResolver(loadList = loadProviderList) {
  return async (entry: QueueEntry, signal: AbortSignal): Promise<PlaybackContinuation | null> => {
    signal.throwIfAborted();
    if (entry.live || entry.kind === "radio" || !entry.source.startsWith("web:")) return null;
    const url = entry.source.slice(4), episode = streamingEpisode(url);
    const watch = !entry.collection && episode ? await streamingCommunityWatchContext(url, signal) : null;
    let collection = entry.collection ?? (watch ? { title: watch.title, url: watch.titleUrl, index: undefined } : null);
    if (!collection) return null;
    const provider = providerForUrl(url);
    if (!provider || provider !== providerForUrl(collection.url) || !["youtube", "bandcamp", "streamingcommunity"].includes(provider)
      || provider === "youtube" && !isYouTubePlaylistUrl(collection.url)) return null;
    if (episode) {
      const container = new URL(collection.url);
      if (/\/season-\d+$/.test(container.pathname)) {
        container.pathname = container.pathname.replace(/\/season-\d+$/, "");
        // A browsed episode continues its series, not just the visible season.
        collection = { ...collection, url: container.href, index: undefined };
      }
    }
    const page = await loadList(provider, collection.url, signal);
    signal.throwIfAborted();
    const sameItem = (candidate: string) => {
      const next = episode && streamingEpisode(candidate);
      return candidate === url || !!next && next.origin === episode!.origin && next.title === episode!.title && next.episode === episode!.episode;
    };
    const matches = page.items.flatMap((item, index) => sameItem(item.url) ? [index] : []);
    const index = collection.index ?? (matches.length === 1 ? matches[0] : undefined);
    if (index === undefined || !Number.isSafeInteger(index) || index < 0 || !page.items[index] || !sameItem(page.items[index]!.url)) return null;
    const title = page.title ?? collection.title;
    return { title, entries: page.items.slice(index + 1).flatMap((item, offset) => item.kind !== "media" || item.live ? [] : [{
      id: crypto.randomUUID(), source: `web:${item.url}`, ...providerMetadata(item), title: item.title,
      ...(item.thumbnail ? { thumbnail: item.thumbnail } : {}), ...(item.duration === undefined ? {} : { duration: item.duration }),
      ...(entry.quality ? { quality: entry.quality } : {}), collection: { title, url: collection.url, index: index + offset + 1 },
    }]) };
  };
}
