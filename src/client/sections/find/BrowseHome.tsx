import { MediaList, MediaRow } from "@/components/MediaRow";
import { useShell } from "@/sections/shell/AppShell";
import { useSessionGate } from "@/session/session-context";
import { Button } from "@/components/ui/button";
import { BrowseActions } from "./SearchPanel";
import { useLiveSourceHits } from "./useLiveSourceHits";
import { collectionLocation, useDetailNavigation } from "@/detail-navigation";
import type { ProviderId } from "../../../shared/providers";

const catalogues: { title: string; meta: string; provider: ProviderId }[] = [
  { title: "Bandcamp", meta: "Albums and tracks", provider: "bandcamp" },
  { title: "SoundCloud", meta: "Tracks", provider: "soundcloud" },
  { title: "RaiPlay", meta: "Programmes and live TV", provider: "raiplay" },
  { title: "StreamingCommunity", meta: "Films and series", provider: "streamingcommunity" },
  { title: "123MoviesFree", meta: "Films and series", provider: "movies123" },
  { title: "AnimeSaturn", meta: "Anime", provider: "animesaturn" },
  { title: "AnimeUnity", meta: "Anime", provider: "animeunity" },
  { title: "YouTube", meta: "Channels and playlists", provider: "youtube" },
  { title: "Twitch", meta: "Live streams and past broadcasts", provider: "twitch" },
];

// Search with an empty query: where to browse. Radio and Live TV live in Live; what to continue and what was
// saved for later live on Home.
export function BrowseHome() {
  const navigation = useDetailNavigation();
  const { connected, tvPresentation } = useSessionGate();
  const { openSources } = useShell();
  const shared = useLiveSourceHits("");
  return <div className="space-y-6">
    <section aria-label="Browse">
      <div className="mb-2 flex items-center justify-between gap-4">
        <h2 className="text-base font-medium">Browse</h2>
        <Button variant="ghost" disabled={!connected} onClick={() => openSources()}>Add source</Button>
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
    </section>
  </div>;
}
