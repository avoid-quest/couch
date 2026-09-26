import { useState } from "react";
import { useLocation, useNavigate } from "@tanstack/react-router";
import { BrowseHome } from "./BrowseHome";
import { BrowseMusic } from "./BrowseMusic";
import { BrowseRadio } from "./BrowseRadio";
import { SearchPanel } from "./SearchPanel";
import { readSearchState } from "../../search";
import { useShell } from "@/sections/shell/AppShell";
import { useSessionGate } from "@/session/session-context";

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
  return <section data-page="Find">
    {browse === "music" ? <BrowseMusic credentials={credentials} connected={connected} canPlay={available} active={onStage} onBack={() => void navigate({ href: "/find" })}
      onAlbum={(albumId, playNow) => run({ type: "enqueueAlbum", albumId, playNow })}
      onTrack={(id, playNow) => enqueueCatalog("enqueueLibrary", id, { playNow })} />
    : browse === "radio" ? <BrowseRadio origin={credentials.origin} token={credentials.token} connected={connected} canPlay={available} active={onStage} onCommand={run} onBack={() => void navigate({ href: "/find" })} /> : <>
      <SearchPanel onOpenCollection={shell.openProvider} draftQuery={homeQuery} onManageSources={openSources} canManageMetadata={canManageMetadata} searchState={searchState} onSearchChange={changeSearch} onQueryChange={query => setDraft(current => ({ ...current, query }))} onCommand={run} defaultQuality={videoQualityPreference.quality} origin={credentials.origin} token={credentials.token} connected={connected} canPlay={available} active={onStage} onEnqueue={(source, itemId, options) => enqueueCatalog(source === "Library" ? "enqueueLibrary" : "enqueueJellyfin", itemId, options)} />
      <div hidden={!!homeQuery.trim()} className="mt-8">
        <BrowseHome credentials={credentials} connected={connected} onBrowse={source => void navigate({ href: `/find?browse=${source}` })} />
      </div>
    </>}
  </section>;
}
