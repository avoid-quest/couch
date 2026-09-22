import { useEffect, useState } from "react";
import { useLocation } from "@tanstack/react-router";
import { Check, PencilLine } from "lucide-react";
import { BrowseHome } from "./BrowseHome";
import { SearchPanel } from "./SearchPanel";
import { Button } from "@/components/ui/button";
import { readSearchState } from "../../search";
import { moveFindSection, readFindSections, saveFindSections, type FindSectionId } from "../../find-sections";
import { useShell } from "@/sections/shell/AppShell";

export function FindPage() {
  const shell = useShell();
  const { tvPresentation, credentials, state, connected, run, available, active, tv, section, browseSection, changeSearch, openSources, playHistory, enqueueCatalog, enqueueRadio, enqueueProvider, recentRadio, videoQualityPreference } = shell;
  const location = useLocation();
  const searchState = readSearchState(location.searchStr);
  const [homeQuery, setHomeQuery] = useState(searchState.query);
  const [editing, setEditing] = useState(false);
  const [layout, setLayout] = useState(readFindSections);
  const toggleSection = (id: FindSectionId) => {
    const hidden = layout.hidden.includes(id) ? layout.hidden.filter(entry => entry !== id) : [...layout.hidden, id];
    const next = { ...layout, hidden };
    setLayout(next); saveFindSections(next);
  };
  const moveSection = (activeId: string, overId: string) => {
    const order = moveFindSection(layout.order, activeId, overId);
    if (order) { const next = { ...layout, order }; setLayout(next); saveFindSections(next); }
  };
  useEffect(() => setHomeQuery(searchState.query), [searchState.query]);
  const onStage = section === "Find" && (!tvPresentation || tv.browsing);
  return (
    <section data-page="Find">
      <SearchPanel draftQuery={homeQuery} onManageSources={openSources} searchState={searchState} onSearchChange={changeSearch} onQueryChange={setHomeQuery} onCommand={run} defaultQuality={videoQualityPreference.quality} origin={credentials.origin} token={credentials.token} connected={connected} canPlay={available} active={onStage} onBrowse={browseSection} onEnqueue={(source, itemId, options) => enqueueCatalog(source === "Library" ? "enqueueLibrary" : "enqueueJellyfin", itemId, options)} />
      {!homeQuery.trim() && <div className="flex justify-end"><Button variant="ghost" size="icon" aria-label={editing ? "Done customizing" : "Customize this page"} aria-pressed={editing} onClick={() => setEditing(value => !value)}>{editing ? <Check aria-hidden="true" /> : <PencilLine aria-hidden="true" />}</Button></div>}
      <div hidden={!!homeQuery.trim()}>
        <BrowseHome state={state} credentials={credentials} connected={connected} canPlay={available} playing={active} active={onStage && !homeQuery.trim()} editing={editing} hiddenSections={layout.hidden} order={layout.order} onToggleSection={toggleSection} onMoveSection={moveSection} onBrowse={browseSection} onAddSource={() => openSources()} onPlay={playHistory} onAdd={item => item.libraryItemId ? enqueueCatalog("enqueueLibrary", item.libraryItemId) : Promise.resolve(false)} recentRadio={recentRadio} onRadio={station => enqueueRadio(station, true)} />
      </div>
    </section>
  );
}
