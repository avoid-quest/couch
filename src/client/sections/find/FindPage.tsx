import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "@tanstack/react-router";
import { BrowseHome } from "./BrowseHome";
import { SearchPanel } from "./SearchPanel";
import { readSearchState } from "../../search";
import { apiFetch } from "@/api/client";
import { useShell } from "@/sections/shell/AppShell";
import { Button } from "@/components/ui/button";
import { ProviderPanel } from "@/components/ProviderPanel";
import { useSessionGate } from "@/session/session-context";

export function FindPage() {
  const shell = useShell();
  const { credentials, available, section, changeSearch, playHistory, enqueueCatalog } = shell;
  const { identity, state, connected, run, videoQualityPreference } = useSessionGate();
  const canManageMetadata = identity?.authority === "host" || identity?.authority === "administrator";
  const navigate = useNavigate();
  const location = useLocation();
  const searchState = readSearchState(location.searchStr);
  const [homeQuery, setHomeQuery] = useState(searchState.query);
  const collectionBack = useRef<HTMLButtonElement>(null);
  useEffect(() => setHomeQuery(searchState.query), [searchState.query]);
  useEffect(() => { if (shell.onlineRequest) requestAnimationFrame(() => collectionBack.current?.focus()); }, [shell.onlineRequest?.revision]);
  const onStage = section === "Find";
  const openSources = () => void navigate({ to: "/settings/sources" });
  return <section data-page="Find">
    {shell.onlineRequest ? <div className="min-w-0 space-y-6 pb-8">
      <header className="flex flex-wrap items-center gap-4 border-b border-border pb-4"><Button ref={collectionBack} data-page-first variant="ghost" onClick={() => { shell.closeOnlineRequest(); shell.changeSection("Saved"); }}>‹ Saved</Button><h1 className="min-w-0 text-2xl font-semibold tracking-tight">{shell.onlineRequest.item.title}</h1></header>
      <ProviderPanel key={shell.onlineRequest.revision} showHeading={false} collectionMode active initialItem={shell.onlineRequest.item} origin={credentials.origin} token={credentials.token} connected={connected} canPlay={available} defaultQuality={videoQualityPreference.quality} onPlayHistory={playHistory} onEnqueue={shell.enqueueProvider} />
    </div> : <>
    <SearchPanel draftQuery={homeQuery} onManageSources={openSources} canManageMetadata={canManageMetadata} searchState={searchState} onSearchChange={changeSearch} onQueryChange={setHomeQuery} onCommand={run} defaultQuality={videoQualityPreference.quality} origin={credentials.origin} token={credentials.token} connected={connected} canPlay={available} active={onStage} onEnqueue={(source, itemId, options) => enqueueCatalog(source === "Library" ? "enqueueLibrary" : "enqueueJellyfin", itemId, options)} />
    <div hidden={!!homeQuery.trim()}>
      <BrowseHome state={state} credentials={credentials} connected={connected} canPlay={available} canManageMetadata={canManageMetadata} active={onStage && !homeQuery.trim()} onAddSource={openSources} onPlay={playHistory} onAdd={async item => {
        if (item.libraryItemId) return enqueueCatalog("enqueueLibrary", item.libraryItemId);
        if (!state || !item.playable) return false;
        await apiFetch(credentials, `/api/progress/${encodeURIComponent(item.mediaId)}/queue`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ profileId: state.activeProfile.id }) });
        return true;
      }} />
    </div></>}
  </section>;
}
