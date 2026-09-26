import { useCallback, useState } from "react";
import { useLocation } from "@tanstack/react-router";
import { providerForUrl, type ProviderId } from "../../../shared/providers";
import { useDetailNavigation } from "@/detail-navigation";
import { useShell } from "@/sections/shell/AppShell";
import { useSessionGate } from "@/session/session-context";
import { PageHeader } from "@/components/PageHeader";
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription } from "@/components/ui/empty";
import { Spinner } from "@/components/ui/spinner";
import { CollectionHeader, HitList, MoreResults, SourceProblems } from "./SearchPanel";
import { providerNames, SearchOnlineResults, type SearchResultSummary } from "./SearchOnlineResults";

export function ProviderPage() {
  const location = useLocation();
  const params = new URLSearchParams(location.searchStr);
  const provider = params.get("provider"), url = params.get("url");
  const navigation = useDetailNavigation();
  if (!url || !provider || providerForUrl(url) !== provider) return <section data-page="Collection">
    <PageHeader title="Collection unavailable" back={{ label: "Back", onClick: () => navigation.back("/find") }} />
    <p className="text-muted-foreground">This collection link is incomplete or unsupported.</p>
  </section>;
  return <CollectionPage key={`${provider}:${url}`} provider={provider as ProviderId} url={url} />;
}

function CollectionPage({ provider, url }: { provider: ProviderId; url: string }) {
  const { credentials, available, openProvider } = useShell();
  const { connected, run, videoQualityPreference } = useSessionGate();
  const navigation = useDetailNavigation();
  const [summary, setSummary] = useState<SearchResultSummary | null>(null);
  const report = useCallback((_: string, next: SearchResultSummary) => setSummary(next), []);
  const collection = summary?.collection ?? { title: providerNames[provider], source: providerNames[provider] };
  const entries: [string, SearchResultSummary][] = summary ? [[providerNames[provider], summary]] : [];
  return <section data-page="Collection" className="min-w-0 space-y-6">
    <SearchOnlineResults provider={provider} query="" url={url} onOpenCollection={openProvider} onResults={report} origin={credentials.origin} token={credentials.token} connected={connected} canPlay={available} active onCommand={run} quality={videoQualityPreference.quality} onEnqueued={() => {}} />
    <CollectionHeader collection={collection} back="Back" onBack={() => navigation.back("/find")} canPlay={available} />
    {summary?.loading && <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Spinner className="size-3.5" />Loading items…</p>}
    {!connected && <p role="status" className="text-sm text-muted-foreground">Connect to Couch to load this collection.</p>}
    <HitList hits={summary?.hits ?? []} label={`${collection.title} items`} origin={credentials.origin} token={credentials.token} />
    {connected && summary && !summary.loading && !summary.error && !summary.hits?.length && <Empty><EmptyHeader><EmptyTitle>No items available</EmptyTitle><EmptyDescription>This collection has no available items.</EmptyDescription></EmptyHeader></Empty>}
    <MoreResults summaries={entries} /><SourceProblems summaries={entries} />
  </section>;
}
