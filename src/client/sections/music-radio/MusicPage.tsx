import { MusicPanel } from "@/components/MusicPanel";
import { useShell } from "@/sections/shell/AppShell";
import { useSessionGate } from "@/session/session-context";

export function MusicPage() {
  const shell = useShell();
  const { credentials, available, enqueueCatalog, gotoSearch } = shell;
  const { connected, run } = useSessionGate();
  return <section data-page="Music" className="space-y-6">
    <MusicPanel origin={credentials.origin} token={credentials.token} connected={connected} canPlay={available} active view="albums" onEnqueue={(id, options) => enqueueCatalog("enqueueLibrary", id, options)} onQueueAlbum={(albumId, playNow) => run({ type: "enqueueAlbum", albumId, playNow })} onArtistTracks={artist => gotoSearch({ query: artist.name, source: "All" })} />
  </section>;
}
