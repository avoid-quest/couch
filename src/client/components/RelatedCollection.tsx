import { useCallback, useState } from "react";
import { Link } from "@tanstack/react-router";
import { collectionLocation } from "@/detail-navigation";
import { collectionLinks } from "@/collection-target";
import { useShell } from "@/sections/shell/shell-context";
import { useSessionGate } from "@/session/session-context";
import { HitList, SourceProblems } from "@/sections/find/SearchPanel";
import { SearchOnlineResults, type SearchResultSummary } from "@/sections/find/SearchOnlineResults";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import type { MediaCollection } from "../../shared/media";

export function RelatedCollection({ collection, currentUrl, currentTitle }: { collection?: MediaCollection; currentUrl?: string; currentTitle?: string }) {
  const target = collectionLinks(collection).at(-1);
  return target && <RelatedItems key={target.url} collection={collection!} currentUrl={currentUrl} currentTitle={currentTitle} />;
}

function RelatedItems({ collection, currentUrl, currentTitle }: { collection: MediaCollection; currentUrl?: string; currentTitle?: string }) {
  const { credentials, available, openProvider } = useShell();
  const { connected, run, videoQualityPreference } = useSessionGate();
  const target = collectionLinks(collection).at(-1)!;
  const [summary, setSummary] = useState<SearchResultSummary | null>(null);
  const report = useCallback((_: string, summary: SearchResultSummary) => setSummary(summary), []);
  const hits = summary?.hits ?? [];
  const isCurrent = (hit: typeof hits[number]) => currentUrl ? hit.url === currentUrl : !!currentTitle && hit.title === currentTitle;
  const currentIndex = hits.findIndex(isCurrent);
  const start = Math.max(0, currentIndex - 2);
  const nearby = hits.slice(start, start + 7).filter(hit => !isCurrent(hit)).slice(0, 6);
  const cursor = target.provider === "youtube" && collection.index != null && collection.index >= 24 ? String(Math.floor(collection.index / 24) * 24) : undefined;
  return <section aria-label={`More from ${collection.title}`} className="mt-8 min-w-0 space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h2 className="text-lg font-medium tracking-tight">More from {collection.title}</h2>
      <Button asChild variant="ghost"><Link to={collectionLocation(target)}>View all</Link></Button>
    </div>
    <SearchOnlineResults provider={target.provider} query="" url={target.url} cursor={cursor} paged onResults={report} onOpenCollection={openProvider} origin={credentials.origin} token={credentials.token} connected={connected} canPlay={available} active onCommand={run} quality={videoQualityPreference.quality} onEnqueued={() => {}} />
    {!connected && <p role="status" className="text-sm text-muted-foreground">Connect to Couch to load this list.</p>}
    {summary?.loading && !hits.length && <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Spinner className="size-3.5" />Loading items…</p>}
    <HitList hits={nearby} timeline={false} label={`More from ${collection.title}`} />
    {summary && !summary.loading && !summary.error && !nearby.length && <p className="text-sm text-muted-foreground">There are no more items on this page. Open the full list to keep browsing.</p>}
    <SourceProblems summaries={summary ? [[collection.title, summary]] : []} />
  </section>;
}
