import type { PlaybackCollection } from "../shared/protocol";
import { providerForUrl, type ProviderItem } from "../shared/providers";

/** Start a saved episode at its show so every season remains reachable. */
export function collectionTarget(collection?: PlaybackCollection): ProviderItem | undefined {
  if (!collection) return;
  const provider = providerForUrl(collection.url);
  if (!provider) return;
  const url = new URL(collection.url);
  if (provider === "streamingcommunity") url.pathname = url.pathname.replace(/(\/titles\/\d+(?:-[\w-]*)?)\/season-\d+$/, "$1");
  return { id: url.href, url: url.href, title: collection.title, provider, kind: "collection" };
}
