import { SavedSection } from "./SavedSection";
import { useShell } from "../../shell";

export function SavedPage() {
  const shell = useShell();
  const { state, credentials, connected, available, section, browseSection, enqueueProvider, enqueueRadio, openProvider } = shell;
  return (
    <section data-page="Saved">
      <SavedSection state={state} credentials={credentials} connected={connected} canPlay={available} active={section === "Saved"} onBrowse={browseSection} onEnqueueProvider={enqueueProvider} onEnqueueRadio={enqueueRadio} onOpenProvider={openProvider} />
    </section>
  );
}
