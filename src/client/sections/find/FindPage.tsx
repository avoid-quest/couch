import { useEffect, useRef, useState } from "react";
import { useLocation } from "@tanstack/react-router";
import { BrowseHome } from "./BrowseHome";
import { SearchPanel } from "./SearchPanel";
import { StreamingCommunityExplorer } from "./StreamingCommunityExplorer";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { readSearchState } from "../../search";
import { useShell } from "@/sections/shell/AppShell";

export function FindPage() {
  const shell = useShell();
  const { nativeHost, credentials, state, connected, run, available, active, tv, section, browseSection, changeSearch, openSources, playHistory, enqueueCatalog, enqueueRadio, enqueueProvider, saveProviderPlaylist, recentRadio, videoQualityPreference } = shell;
  const location = useLocation();
  const searchState = readSearchState(location.searchStr);
  const [homeQuery, setHomeQuery] = useState(searchState.query);
  const [explorerOpen, setExplorerOpen] = useState(false);
  useEffect(() => setHomeQuery(searchState.query), [searchState.query]);
  const draft = useRef(homeQuery);
  draft.current = homeQuery;
  // Leaving Find with an uncommitted draft keeps it in the address, like the
  // debounce would have.
  useEffect(() => () => {
    const query = draft.current.trim();
    if (query !== readSearchState(window.location.search).query) changeSearch({ query, source: readSearchState(window.location.search).source });
  }, []);
  const onStage = section === "Find" && (!nativeHost || tv.browsing);
  return (
    <section data-page="Find">
      <SearchPanel draftQuery={homeQuery} onManageSources={openSources} searchState={searchState} onSearchChange={changeSearch} onQueryChange={setHomeQuery} onCommand={run} defaultQuality={videoQualityPreference.quality} origin={credentials.origin} token={credentials.token} connected={connected} canPlay={available} active={onStage} onBrowse={browseSection} onEnqueue={(source, itemId, options) => enqueueCatalog(source === "Library" ? "enqueueLibrary" : "enqueueJellyfin", itemId, options)} />
      <div hidden={!!homeQuery.trim()}>
        <BrowseHome state={state} credentials={credentials} connected={connected} canPlay={available} playing={active} active={onStage && !homeQuery.trim()} onBrowse={browseSection} onAddSource={() => openSources()} onOpenStreamingCommunity={credentials ? () => setExplorerOpen(true) : undefined} onPlay={playHistory} onAdd={item => item.libraryItemId ? enqueueCatalog("enqueueLibrary", item.libraryItemId) : Promise.resolve(false)} recentRadio={recentRadio} onRadio={station => enqueueRadio(station, true)} />
      </div>
      {/* StreamingCommunity is one source among others: it opens on demand
          from the Sources row instead of leading the page. */}
      {credentials && <Dialog open={explorerOpen} onOpenChange={setExplorerOpen}>
        <DialogContent className="max-h-[85dvh] max-w-3xl overflow-y-auto">
          <DialogHeader><DialogTitle>StreamingCommunity</DialogTitle><DialogDescription>Films and series from the configured website source.</DialogDescription></DialogHeader>
          <StreamingCommunityExplorer showHeading={false} credentials={credentials} connected={connected} canPlay={available} active={onStage && explorerOpen} onEnqueue={enqueueProvider} onSavePlaylist={saveProviderPlaylist} />
        </DialogContent>
      </Dialog>}
    </section>
  );
}
