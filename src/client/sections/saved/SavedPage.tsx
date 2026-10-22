import { getRouteApi } from "@tanstack/react-router";
import { SavedSections } from "./SavedSections";
import { useShell } from "@/sections/shell/AppShell";
import { useSessionGate } from "@/session/session-context";

const route = getRouteApi("/saved");

export function SavedPage() {
  const { credentials, available, focusSearch, enqueueProvider, enqueueRadio, openProvider } = useShell();
  const { state, connected } = useSessionGate();
  const { tab } = route.useSearch();
  const navigate = route.useNavigate();
  return (
    <section data-page="Saved">
      <SavedSections state={state} credentials={credentials} connected={connected} canPlay={available} tab={tab}
        onTabChange={next => void navigate({ search: { tab: next }, replace: true })}
        onFind={focusSearch} onEnqueueProvider={enqueueProvider} onEnqueueRadio={enqueueRadio} onOpenProvider={openProvider} />
    </section>
  );
}
