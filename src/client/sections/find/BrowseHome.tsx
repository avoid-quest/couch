import { MediaList, MediaRow } from "@/components/MediaRow";
import { useShell } from "@/sections/shell/AppShell";
import { useSessionGate } from "@/session/session-context";
import { Button } from "@/components/ui/button";
import { BrowseActions } from "./SearchPanel";
import { useLiveSourceHits } from "./useLiveSourceHits";
import { collectionLocation, useDetailNavigation } from "@/detail-navigation";
import type { ProviderId } from "../../../shared/providers";

// Video sources, then music. Each opens its own home; YouTube, Bandcamp and SoundCloud have none, so theirs is a search.
const catalogues: { title: string; meta: string; provider: ProviderId }[] = [
  { title: "YouTube", meta: "Channels and playlists", provider: "youtube" },
  { title: "Twitch", meta: "Live streams and past broadcasts", provider: "twitch" },
  { title: "RaiPlay", meta: "Programmes and live TV", provider: "raiplay" },
  { title: "StreamingCommunity", meta: "Films and series", provider: "streamingcommunity" },
  { title: "123MoviesFree", meta: "Films and series", provider: "movies123" },
  { title: "Bandcamp", meta: "Albums and tracks", provider: "bandcamp" },
  { title: "SoundCloud", meta: "Tracks", provider: "soundcloud" },
];

// Search with an empty query: the sources, each a row that opens its home. Radio and Live TV live in Live; what to
// continue and what was saved for later live on Home.
export function BrowseHome() {
  const navigation = useDetailNavigation();
  const { connected, tvPresentation } = useSessionGate();
  const { openSources } = useShell();
  const shared = useLiveSourceHits("");
  return <section aria-label="Sources">
    <div className="mb-2 flex min-h-8 items-center justify-between gap-4">
      <h2 className="text-base font-medium">Sources</h2>
      {/* As on Home's shelves, the TV's tab bar reaches Settings, so Down from the field meets the first source. */}
      <Button variant="ghost" className="-mr-2.5 tv:hidden" disabled={!connected} onClick={() => openSources()}>Add source</Button>
    </div>
    <MediaList>
      {shared.map(hit => <MediaRow key={hit.id} data-hit-id={hit.id} title={hit.title} meta={hit.meta} tvSecondaryActions
        primary={{ label: hit.primary.label, disabled: hit.primary.disabled, onClick: hit.primary.run }}
        actions={<BrowseActions title={hit.title} actions={tvPresentation ? hit.actions.filter(action => action.label !== "Play") : hit.actions} />} />)}
      {catalogues.map(item => {
        const href = collectionLocation({ provider: item.provider, url: "" });
        return <MediaRow key={item.provider} title={item.title} meta={item.meta} primary={{ label: "Open", href, onClick: () => navigation.open(href) }} />;
      })}
    </MediaList>
  </section>;
}
