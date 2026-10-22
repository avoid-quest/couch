import { MediaRowsSkeleton } from "@/components/LoadingMedia";
import { useCallback, useState } from "react";
import { Link } from "@tanstack/react-router";
import { collectionLocation, keepSection } from "@/detail-navigation";
import { collectionLinks } from "@/collection-target";
import { providerCollectionCursor } from "@/collection-pagination";
import { useShell } from "@/sections/shell/shell-context";
import { useSessionGate } from "@/session/session-context";
import { HitList, SourcesUnanswered } from "@/sections/find/SearchPanel";
import { providerNames, SearchOnlineResults, type SearchResultSummary } from "@/sections/find/SearchOnlineResults";
import type { CollectionLink, MediaCollection } from "../../shared/media";
import { providerForUrl, type ProviderId, type ProviderItem } from "../../shared/providers";

/** A YouTube video in no list is still its channel's: its Videos tab, the page the channel's own Videos link opens. */
const channelVideos = (creator?: CollectionLink): ProviderItem | undefined => creator && providerForUrl(creator.url) === "youtube" && /^\/(?:channel\/|@|c\/|user\/)[^/]+\/?$/.test(new URL(creator.url).pathname)
  ? { id: creator.url, provider: "youtube", title: creator.title, url: `${creator.url.replace(/\/$/, "")}/videos`, kind: "collection" } : undefined;

/** What sits near an item in its list: its collection, else its YouTube channel's videos, else its source's home. */
export function RelatedCollection({ collection, creator, currentUrl, currentTitle, provider }: { collection?: MediaCollection; creator?: CollectionLink; currentUrl?: string; currentTitle?: string; provider?: ProviderId }) {
  const channel = collection ? undefined : channelVideos(creator);
  const target = collectionLinks(collection).at(-1) ?? channel ?? (provider ? { id: provider, provider, title: providerNames[provider], url: "", kind: "collection" as const } : undefined);
  return target && <RelatedItems key={`${target.provider}:${target.url}`} target={target} collection={collection} more={!!channel} currentUrl={currentUrl} currentTitle={currentTitle} />;
}

function RelatedItems({ target, collection, more, currentUrl, currentTitle }: { target: ProviderItem; collection?: MediaCollection; more: boolean; currentUrl?: string; currentTitle?: string }) {
  const { credentials, available, openProvider, section } = useShell();
  const { connected, run, videoQualityPreference } = useSessionGate();
  const [summary, setSummary] = useState<SearchResultSummary | null>(null);
  const report = useCallback((_: string, summary: SearchResultSummary) => setSummary(summary), []);
  const hits = summary?.hits ?? [];
  const isCurrent = (hit: typeof hits[number]) => currentUrl ? hit.url === currentUrl : !!currentTitle && hit.title === currentTitle;
  const currentIndex = hits.findIndex(isCurrent);
  const start = Math.max(0, currentIndex - 2);
  const nearby = hits.slice(start, start + 5).filter(hit => !isCurrent(hit)).slice(0, 4);
  const cursor = collection ? providerCollectionCursor(target.provider, collection) : undefined;
  const title = collection || more ? `More from ${target.title}` : `Browse ${target.title}`;
  return <section aria-label={title} hidden={!!summary && !summary.loading && !summary.error && !nearby.length} className="mt-10 min-w-0 space-y-4">
    <h2 className="text-heading font-semibold"><Link data-text-link to={keepSection(collectionLocation(target), section)} className="inline-flex min-h-8 items-center hover:text-foreground hover:underline">{title}</Link></h2>
    <SearchOnlineResults provider={target.provider} query="" url={target.url} cursor={cursor} paged onResults={report} onOpenCollection={openProvider} origin={credentials.origin} token={credentials.token} connected={connected} canPlay={available} active onCommand={run} quality={videoQualityPreference.quality} onEnqueued={() => {}} />
    {!connected && <p role="status" className="text-sm text-muted-foreground">Connect to Couch to load this list.</p>}
    {summary?.loading && !hits.length && <MediaRowsSkeleton compact count={4} />}
    <HitList showSource={false} hits={nearby} compact label={title} />
    <SourcesUnanswered summaries={summary ? [[target.title, summary]] : []} />
  </section>;
}
