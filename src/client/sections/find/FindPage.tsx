import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "@tanstack/react-router";
import { BrowseHome } from "./BrowseHome";
import { BrowseMusic } from "./BrowseMusic";
import { BrowseRadio } from "./BrowseRadio";
import { CollectionHeader, HitList, MoreResults, SearchPanel, SourceProblems } from "./SearchPanel";
import { SearchOnlineResults, type SearchResultSummary } from "./SearchOnlineResults";
import { readSearchState } from "../../search";
import { useShell } from "@/sections/shell/AppShell";
import { useSessionGate } from "@/session/session-context";
import type { ProviderItem } from "../../../shared/providers";

export function FindPage() {
  const shell = useShell();
  const { credentials, available, section, changeSearch, enqueueCatalog } = shell;
  const { identity, connected, run, videoQualityPreference } = useSessionGate();
  const canManageMetadata = identity?.authority === "host" || identity?.authority === "administrator";
  const navigate = useNavigate();
  const location = useLocation();
  const searchState = readSearchState(location.searchStr);
  const browse = new URLSearchParams(location.searchStr).get("browse");
  // The typed query follows the route until the next edit.
  const [draft, setDraft] = useState({ route: searchState.query, query: searchState.query });
  if (draft.route !== searchState.query) setDraft({ route: searchState.query, query: searchState.query });
  const homeQuery = draft.query;
  const onStage = section === "Find";
  const openSources = () => void navigate({ to: "/settings/sources" });
  const opened = shell.onlineRequest;
  return <section data-page="Find">
    {opened ? <OpenedCollection key={opened.revision} item={opened.item} onBack={() => { shell.closeOnlineRequest(); shell.changeSection("Saved"); }} />
    : browse === "music" ? <BrowseMusic credentials={credentials} connected={connected} canPlay={available} active={onStage} onBack={() => void navigate({ href: "/find" })}
      onAlbum={(albumId, playNow) => run({ type: "enqueueAlbum", albumId, playNow })}
      onTrack={(id, playNow) => enqueueCatalog("enqueueLibrary", id, { playNow })} />
    : browse === "radio" ? <BrowseRadio origin={credentials.origin} token={credentials.token} connected={connected} canPlay={available} active={onStage} onCommand={run} onBack={() => void navigate({ href: "/find" })} /> : <>
      <SearchPanel draftQuery={homeQuery} onManageSources={openSources} canManageMetadata={canManageMetadata} searchState={searchState} onSearchChange={changeSearch} onQueryChange={query => setDraft(current => ({ ...current, query }))} onCommand={run} defaultQuality={videoQualityPreference.quality} origin={credentials.origin} token={credentials.token} connected={connected} canPlay={available} active={onStage} onEnqueue={(source, itemId, options) => enqueueCatalog(source === "Library" ? "enqueueLibrary" : "enqueueJellyfin", itemId, options)} />
      <div hidden={!!homeQuery.trim()} className="mt-8">
        <BrowseHome credentials={credentials} connected={connected} onBrowse={source => void navigate({ href: `/find?browse=${source}` })} />
      </div>
    </>}
  </section>;
}

/** A channel, list or show opened from Saved, shown like one opened from results. */
function OpenedCollection({ item, onBack }: { item: ProviderItem; onBack: () => void }) {
  const { credentials, available } = useShell();
  const { connected, run, videoQualityPreference } = useSessionGate();
  const [summary, setSummary] = useState<SearchResultSummary | null>(null);
  const report = useCallback((_: string, next: SearchResultSummary) => setSummary(next), []);
  const page = useRef<HTMLDivElement>(null);
  useEffect(() => { requestAnimationFrame(() => page.current?.querySelector<HTMLElement>("[data-back]")?.focus()); }, []);
  const collection = summary?.collection ?? { title: item.title, source: "", back: onBack, root: true };
  const source = collection.source || item.provider;
  return <div ref={page} className="min-w-0 space-y-6">
    <SearchOnlineResults provider={item.provider} query="" opened={item} onClose={onBack} onResults={report} origin={credentials.origin} token={credentials.token} connected={connected} canPlay={available} active onCommand={run} quality={videoQualityPreference.quality} onEnqueued={() => {}} />
    <CollectionHeader collection={collection} back={collection.root ? "Saved" : "Back"} onBack={collection.back} canPlay={available} />
    <HitList hits={summary?.hits ?? []} label={`${collection.title} items`} origin={credentials.origin} token={credentials.token} />
    {summary && <><MoreResults summaries={[[source, summary]]} /><SourceProblems summaries={[[source, summary]]} /></>}
  </div>;
}
