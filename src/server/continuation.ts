import type { LibraryItem } from "../shared/library";
import type { QueueEntry } from "../shared/protocol";
import { isYouTubePlaylistUrl, providerForUrl } from "../shared/providers";
import type { JellyfinSource } from "./jellyfin";
import type { Library } from "./library";
import { providerMetadata } from "./provider-metadata";
import { loadProviderList } from "./providers";
import { streamingCommunityWatchContext } from "./streamingcommunity";

export type PlaybackContinuation = { title: string; entries: QueueEntry[] };

const numbered = (value: number | null | undefined): value is number => Number.isSafeInteger(value) && value! >= 0;
const libraryEntry = (item: LibraryItem): QueueEntry => ({
  id: crypto.randomUUID(), title: item.title.slice(0, 300), source: `library:${item.id}`,
  ...(item.artworkId ? { artworkId: item.artworkId } : {}), ...(item.duration == null ? {} : { duration: item.duration }),
});
function streamingEpisode(value: string) {
  if (providerForUrl(value) !== "streamingcommunity") return null;
  const url = new URL(value);
  const title = /^\/(?:[a-z]{2}\/)?watch\/(\d+)$/.exec(url.pathname)?.[1];
  const episode = /^\?e=(\d+)$/.exec(url.search)?.[1];
  return title && episode ? { origin: url.origin, title, episode } : null;
}

// Only a source's album or numbered series defines automatic continuation.
// Results stay private to playback; resolving them never edits the manual queue.
export function createContinuationResolver({ library, jellyfin, loadList = loadProviderList }: {
  library: Pick<Library, "getItem" | "albumTracks" | "search">;
  jellyfin: Pick<JellyfinSource, "continuation">;
  loadList?: typeof loadProviderList;
}) {
  return async (entry: QueueEntry, signal: AbortSignal): Promise<PlaybackContinuation | null> => {
    signal.throwIfAborted();
    if (entry.live || entry.kind === "radio") return null;
    if (entry.source.startsWith("jellyfin:")) return jellyfin.continuation(entry.source.slice(9), signal);
    if (entry.source.startsWith("web:")) {
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
    }
    if (!entry.source.startsWith("library:")) return null;
    const current = library.getItem(entry.source.slice(8));
    if (!current) return null;
    if (current.kind === "audio" && current.albumId) {
      const { album, items } = library.albumTracks(current.albumId);
      const index = items.findIndex(item => item.id === current.id);
      return index < 0 ? null : { title: album.title, entries: items.slice(index + 1).filter(item => item.available).map(libraryEntry) };
    }
    const video = current.video;
    if (video?.type !== "episode" || !video.show || !numbered(video.season) || !numbered(video.episode)) return null;
    const items: LibraryItem[] = [];
    let offset = 0;
    while (true) {
      signal.throwIfAborted();
      const page = library.search({ showId: video.show.id, videoType: "episode", offset, limit: 100 });
      items.push(...page.items);
      offset += page.items.length;
      if (offset >= page.total) break;
      if (!page.items.length) return null;
    }
    const episodes = new Set<string>();
    return { title: video.show.title, entries: items.filter(item => {
      const next = item.video;
      if (!item.available || !next || !numbered(next.season) || !numbered(next.episode)
        || next.season < video.season! || next.season === video.season && next.episode <= video.episode!) return false;
      const key = `${next.season}:${next.episode}`;
      if (episodes.has(key)) return false;
      episodes.add(key);
      return true;
    }).map(libraryEntry) };
  };
}
