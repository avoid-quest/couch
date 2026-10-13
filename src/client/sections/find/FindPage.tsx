import { useState } from "react";
import { useLocation, useNavigate } from "@tanstack/react-router";
import { BrowseHome } from "./BrowseHome";
import { BrowseRadio } from "./BrowseRadio";
import { BrowseLiveTv } from "./BrowseLiveTv";
import { SearchPanel } from "./SearchPanel";
import { LiveSources } from "./LiveSources";
import { readSearchState } from "../../search";
import { useShell } from "@/sections/shell/AppShell";
import { useSessionGate } from "@/session/session-context";

export function FindPage() {
  const shell = useShell();
  const { credentials, available, section, changeSearch } = shell;
  const { connected, run, videoQualityPreference } = useSessionGate();
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
    {browse === "radio" ? <BrowseRadio origin={credentials.origin} token={credentials.token} connected={connected} canPlay={available} active={onStage} onCommand={run} /> : browse === "live-tv" ? <BrowseLiveTv /> : browse === "device-inputs" ? <LiveSources /> : <>
      <SearchPanel onOpenCollection={shell.openProvider} draftQuery={homeQuery} onManageSources={openSources} searchState={searchState} onSearchChange={changeSearch} onQueryChange={query => setDraft(current => ({ ...current, query }))} onCommand={run} defaultQuality={videoQualityPreference.quality} origin={credentials.origin} token={credentials.token} connected={connected} canPlay={available} active={onStage} />
      <div hidden={!!homeQuery.trim()} className="mt-8">
        <BrowseHome onBrowse={source => void navigate({ href: `/find?browse=${source}` })} />
      </div>
    </>}
  </section>;
}
