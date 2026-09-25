import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "@tanstack/react-router";
import { BrowseHome } from "./BrowseHome";
import { SearchPanel } from "./SearchPanel";
import { readSearchState } from "../../search";
import { apiFetch } from "@/api/client";
import { useShell } from "@/sections/shell/AppShell";

export function FindPage() {
  const shell = useShell();
  const { credentials, identity, state, connected, run, available, active, section, browseSection, changeSearch, playHistory, enqueueCatalog, videoQualityPreference } = shell;
  const canManageMetadata = identity?.authority === "host" || identity?.authority === "administrator";
  const navigate = useNavigate();
  const location = useLocation();
  const searchState = readSearchState(location.searchStr);
  const [homeQuery, setHomeQuery] = useState(searchState.query);
  useEffect(() => setHomeQuery(searchState.query), [searchState.query]);
  const onStage = section === "Find";
  const openSources = () => void navigate({ to: "/settings/sources" });
  return <section data-page="Find">
    <SearchPanel draftQuery={homeQuery} onManageSources={openSources} canManageMetadata={canManageMetadata} searchState={searchState} onSearchChange={changeSearch} onQueryChange={setHomeQuery} onCommand={run} defaultQuality={videoQualityPreference.quality} origin={credentials.origin} token={credentials.token} connected={connected} canPlay={available} active={onStage} onBrowse={browseSection} onEnqueue={(source, itemId, options) => enqueueCatalog(source === "Library" ? "enqueueLibrary" : "enqueueJellyfin", itemId, options)} />
    <div hidden={!!homeQuery.trim()}>
      <BrowseHome state={state} credentials={credentials} connected={connected} canPlay={available} canManageMetadata={canManageMetadata} playing={active} active={onStage && !homeQuery.trim()} onBrowse={browseSection} onAddSource={openSources} onPlay={playHistory} onAdd={async item => {
        if (item.libraryItemId) return enqueueCatalog("enqueueLibrary", item.libraryItemId);
        if (!state || !item.playable) return false;
        await apiFetch(credentials, `/api/progress/${encodeURIComponent(item.mediaId)}/queue`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ profileId: state.activeProfile.id }) });
        return true;
      }} />
    </div>
  </section>;
}
