import { useLocation, useNavigate } from "@tanstack/react-router";
import { PageHeader } from "@/components/PageHeader";
import { SearchPanel } from "./SearchPanel";
import { readSearchState } from "../../search";
import { useShell } from "@/sections/shell/AppShell";
import { useSessionGate } from "@/session/session-context";

/** The header's search results: no tab names this page, so its title is the query. */
export function SearchPage() {
  const shell = useShell();
  const { credentials, available, section, changeSearch } = shell;
  const { connected, run, videoQualityPreference } = useSessionGate();
  const navigate = useNavigate();
  const searchState = readSearchState(useLocation().searchStr);
  return <section data-page="Search">
    <PageHeader title={searchState.query} />
    <SearchPanel onOpenCollection={shell.openProvider} onManageSources={() => void navigate({ to: "/settings/couch/sources" })} searchState={searchState} onSearchChange={changeSearch} onCommand={run} defaultQuality={videoQualityPreference.quality} origin={credentials.origin} token={credentials.token} connected={connected} canPlay={available} active={section === "Search"} />
  </section>;
}
