import { MediaList, MediaRow } from "@/components/MediaRow";
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
  const shared = useLiveSourceHits("");
  // As on Home's shelves, the heading has no action: the tabs reach Settings → Sources, and Down from the field meets the first source.
  return <section aria-label="Sources">
    <h2 className="mb-2 flex min-h-8 items-center text-base font-medium">Sources</h2>
    <MediaList>
      {shared.map(hit => <MediaRow key={hit.id} data-hit-id={hit.id} title={hit.title} meta={hit.meta}
        primary={{ label: hit.primary.label, disabled: hit.primary.disabled, onClick: hit.primary.run }}
        menu={hit.actions.filter(action => action.label !== "Play")} />)}
      {catalogues.map(item => {
        const href = collectionLocation({ provider: item.provider, url: "" });
        return <MediaRow key={item.provider} title={item.title} meta={item.meta} primary={{ label: "Open", href, onClick: () => navigation.open(href) }} />;
      })}
    </MediaList>
  </section>;
}
