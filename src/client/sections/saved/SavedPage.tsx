import { SavedSection } from "./SavedSection";
import { useShell } from "@/sections/shell/AppShell";
import { useSessionGate } from "@/session/session-context";

export function SavedPage() {
  const shell = useShell();
  const { credentials, available, section, browseSection, enqueueProvider, enqueueRadio, openProvider } = shell;
  const { state, connected } = useSessionGate();
  return (
    <section data-page="Saved">
      <SavedSection state={state} credentials={credentials} connected={connected} canPlay={available} active={section === "Saved"} onBrowse={browseSection} onEnqueueProvider={enqueueProvider} onEnqueueRadio={enqueueRadio} onOpenProvider={openProvider} />
    </section>
  );
}
