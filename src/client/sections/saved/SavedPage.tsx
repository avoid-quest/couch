import { useState } from "react";
import { SavedSection } from "./SavedSection";
import { useShell } from "@/sections/shell/AppShell";

export function SavedPage() {
  const shell = useShell();
  const { state, credentials, connected, available, section, browseSection, enqueueProvider, enqueueRadio, openProvider } = shell;
  const [editing, setEditing] = useState(false);
  return (
    <section data-page="Saved">
      <SavedSection state={state} credentials={credentials} connected={connected} canPlay={available} active={section === "Saved"} editing={editing} onToggleEdit={() => setEditing(value => !value)} onBrowse={browseSection} onEnqueueProvider={enqueueProvider} onEnqueueRadio={enqueueRadio} onOpenProvider={openProvider} />
    </section>
  );
}
