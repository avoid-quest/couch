import { useCallback, useState } from "react";
import { Link } from "@tanstack/react-router";
import { collectionLocation } from "@/detail-navigation";
import { collectionLinks } from "@/collection-target";
import { providerCollectionCursor } from "@/collection-pagination";
import { useShell } from "@/sections/shell/shell-context";
import { useSessionGate } from "@/session/session-context";
import { HitList, SourceProblems } from "@/sections/find/SearchPanel";
import { providerNames, SearchOnlineResults, type SearchResultSummary } from "@/sections/find/SearchOnlineResults";
import { Spinner } from "@/components/ui/spinner";
import type { MediaCollection } from "../../shared/media";
import type { ProviderId, ProviderItem } from "../../shared/providers";

export function RelatedCollection({ collection, currentUrl, currentTitle, provider }: { collection?: MediaCollection; currentUrl?: string; currentTitle?: string; provider?: ProviderId }) {
  const target = collectionLinks(collection).at(-1) ?? (provider ? { id: provider, provider, title: providerNames[provider], url: "", kind: "collection" as const } : undefined);
  return target && <RelatedItems key={`${target.provider}:${target.url}`} target={target} collection={collection} currentUrl={currentUrl} currentTitle={currentTitle} />;
}

function RelatedItems({ target, collection, currentUrl, currentTitle }: { target: ProviderItem; collection?: MediaCollection; currentUrl?: string; currentTitle?: string }) {
  const { credentials, available, openProvider } = useShell();
  const { connected, run, videoQualityPreference } = useSessionGate();
  const [summary, setSummary] = useState<SearchResultSummary | null>(null);
  const report = useCallback((_: string, summary: SearchResultSummary) => setSummary(summary), []);
  const hits = summary?.hits ?? [];
  const isCurrent = (hit: typeof hits[number]) => currentUrl ? hit.url === currentUrl : !!currentTitle && hit.title === currentTitle;
  const currentIndex = hits.findIndex(isCurrent);
  const start = Math.max(0, currentIndex - 2);
  const nearby = hits.slice(start, start + 5).filter(hit => !isCurrent(hit)).slice(0, 4);
  const cursor = collection ? providerCollectionCursor(target.provider, collection) : undefined;
  const title = collection ? `More from ${collection.title}` : `Browse ${target.title}`;
  return <section aria-label={title} className="mt-6 min-w-0 space-y-2">
    <h2 className="text-sm text-muted-foreground"><Link to={collectionLocation(target)} className="inline-flex min-h-8 items-center hover:text-foreground hover:underline">{title}</Link></h2>
    <SearchOnlineResults provider={target.provider} query="" url={target.url} cursor={cursor} paged onResults={report} onOpenCollection={openProvider} origin={credentials.origin} token={credentials.token} connected={connected} canPlay={available} active onCommand={run} quality={videoQualityPreference.quality} onEnqueued={() => {}} />
    {!connected && <p role="status" className="text-sm text-muted-foreground">Connect to Couch to load this list.</p>}
    {summary?.loading && !hits.length && <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Spinner className="size-3.5" />Loading items…</p>}
    <HitList hits={nearby} timeline={false} label={title} />
    {summary && !summary.loading && !summary.error && !nearby.length && <p className="text-sm text-muted-foreground">There are no more items on this page. Open the full list to keep browsing.</p>}
    <SourceProblems summaries={summary ? [[target.title, summary]] : []} />
  </section>;
}
