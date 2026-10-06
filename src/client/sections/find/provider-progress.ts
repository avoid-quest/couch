import { publicProviderMediaUrl, type ProviderItem } from "../../../shared/providers";
import type { HistoryItem } from "../../../shared/viewing";
import { collectionLinks } from "../../collection-target";

function identity(value: string) {
  const publicUrl = publicProviderMediaUrl(value);
  if (!publicUrl) return;
  const url = new URL(publicUrl);
  const title = url.pathname.match(/^\/(?:[a-z]{2}\/)?(?:titles|watch)\/(\d+)(?:-[\w-]+)?\/?$/);
  // Healing changes SC's origin; locale/slug changes do not change its title/episode IDs.
  return title ? `streamingcommunity:${title[1]}:${url.searchParams.get("e") ?? "film"}` : publicUrl;
}

export function progressFor(item: ProviderItem, history: HistoryItem[]) {
  const key = item.kind === "media" && !item.live ? identity(item.url) : undefined;
  return key ? history.find(progress => progress.url && identity(progress.url) === key) : undefined;
}

export function nextEpisode(items: ProviderItem[], history: HistoryItem[]) {
  const episodes = items.filter(item => item.kind === "media");
  const unfinished = episodes.map(item => ({ item, progress: progressFor(item, history) }))
    .filter(({ progress }) => progress?.playable && !progress.watched && progress.position > 0)
    .sort((a, b) => (b.progress!.lastPlayedAt ?? 0) - (a.progress!.lastPlayedAt ?? 0))[0];
  return unfinished?.item ?? episodes.find(item => !progressFor(item, history)?.watched) ?? episodes[0];
}

export function seriesResumeFor(series: ProviderItem, history: HistoryItem[]) {
  const key = series.provider === "streamingcommunity" && series.kind === "collection" ? identity(series.url) : undefined;
  const episodePrefix = key?.replace(/:film$/, ":");
  return key ? history.find(progress => {
    const episode = progress.url && identity(progress.url);
    return progress.playable && !progress.watched && progress.position > 0 && episode && episode !== key
      && episode.startsWith(episodePrefix!) && collectionLinks(progress.collection).some(collection => identity(collection.url) === key);
  }) : undefined;
}
