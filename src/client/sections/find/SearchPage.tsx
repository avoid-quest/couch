import { useNavigate, useRouteContext } from "@tanstack/react-router";
import { PageHeader } from "@/components/PageHeader";
import { SearchPanel } from "./SearchPanel";
import { useShell } from "@/sections/shell/AppShell";
import { useSessionGate } from "@/session/session-context";

/** The query lives in the header's field; the page starts with its results. */
export function SearchPage() {
  const shell = useShell();
  const { credentials, available, section, changeSearch } = shell;
  const { connected, run, videoQualityPreference } = useSessionGate();
  const navigate = useNavigate();
  // The destination's URL changes before this page unmounts. Keep the query and scope of this route match.
  const { searchState } = useRouteContext({ from: "/search" });
  return <section data-page="Search">
    <PageHeader title="Search results" hidden />
    <SearchPanel onOpenCollection={shell.openProvider} onManageSources={() => void navigate({ to: "/settings/couch/sources" })} searchState={searchState} onSearchChange={changeSearch} onCommand={run} defaultQuality={videoQualityPreference.quality} origin={credentials.origin} token={credentials.token} connected={connected} canPlay={available} active={section === "Search"} />
  </section>;
}
