import { getRouteApi } from "@tanstack/react-router";
import { SavedSection } from "./SavedSection";
import { useShell } from "@/sections/shell/AppShell";
import { useSessionGate } from "@/session/session-context";

const route = getRouteApi("/library");

export function LibraryPage() {
  const { credentials, available, changeSection, enqueueProvider, enqueueRadio, openProvider } = useShell();
  const { state, connected } = useSessionGate();
  const { tab = "later" } = route.useSearch();
  const navigate = route.useNavigate();
  return (
    <section data-page="Library">
      <SavedSection state={state} credentials={credentials} connected={connected} canPlay={available} tab={tab}
        onTabChange={next => void navigate({ search: next === "later" ? {} : { tab: next }, replace: true })}
        onFind={() => changeSection("Search")} onEnqueueProvider={enqueueProvider} onEnqueueRadio={enqueueRadio} onOpenProvider={openProvider} />
    </section>
  );
}
