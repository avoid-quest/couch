import { MusicPanel } from "./MusicPanel";
import { useShell } from "../../shell";

export function MusicPage() {
  const shell = useShell();
  const { credentials, connected, available, run, enqueueCatalog, gotoSearch } = shell;
  return <section data-page="Music" className="space-y-6">
    <MusicPanel origin={credentials.origin} token={credentials.token} connected={connected} canPlay={available} active view="albums" onEnqueue={(id, options) => enqueueCatalog("enqueueLibrary", id, options)} onQueueAlbum={(albumId, playNow) => run({ type: "enqueueAlbum", albumId, playNow })} onArtistTracks={artist => gotoSearch({ query: artist.name, source: "All" })} />
  </section>;
}
