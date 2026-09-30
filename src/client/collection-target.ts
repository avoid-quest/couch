import type { PlaybackCollection } from "../shared/protocol";
import { providerForUrl, type ProviderItem } from "../shared/providers";

/** Named destinations, outermost first. Old episode metadata already contains the series URL. */
export function collectionLinks(collection?: PlaybackCollection): ProviderItem[] {
  if (!collection) return [];
  const provider = providerForUrl(collection.url);
  if (!provider) return [];
  let parent = collection.parent;
  const url = new URL(collection.url);
  if (!parent && provider === "streamingcommunity" && /\/season-\d+$/.test(url.pathname)) {
    url.pathname = url.pathname.replace(/\/season-\d+$/, "");
    parent = { title: collection.title.replace(/\s+-\s+Season \d+$/i, "") || "Series", url: url.href };
  }
  return [...(parent && parent.url !== collection.url && providerForUrl(parent.url) === provider ? [parent] : []), collection]
    .map(link => ({ id: link.url, url: link.url, title: link.title, provider, kind: "collection" }));
}

/** Start a saved episode at its show so every season remains reachable. */
export function collectionTarget(collection?: PlaybackCollection): ProviderItem | undefined {
  if (!collection) return;
  const provider = providerForUrl(collection.url);
  if (!provider) return;
  const url = new URL(collection.url);
  if (provider === "streamingcommunity") url.pathname = url.pathname.replace(/(\/titles\/\d+(?:-[\w-]*)?)\/season-\d+$/, "$1");
  return { id: url.href, url: url.href, title: collection.title, provider, kind: "collection" };
}
