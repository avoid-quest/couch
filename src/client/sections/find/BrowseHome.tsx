import { MediaList, MediaRow } from "@/components/MediaRow";
import { collectionLocation, useDetailNavigation } from "@/detail-navigation";
import type { ProviderId } from "../../../shared/providers";

const catalogues: { title: string; meta: string; provider: ProviderId }[] = [
  { title: "Music", meta: "Bandcamp albums and tracks", provider: "bandcamp" },
  { title: "RaiPlay", meta: "Programmes, live TV and replay", provider: "raiplay" },
  { title: "StreamingCommunity", meta: "Films and series", provider: "streamingcommunity" },
  { title: "YouTube", meta: "Channels and playlists", provider: "youtube" },
  { title: "Twitch", meta: "Live streams and past broadcasts", provider: "twitch" },
];

// Find with an empty query: what Couch searches and where to browse. What to
// continue and what was saved for later live on Home.
export function BrowseHome({ onBrowse }: { onBrowse?: (source: "radio") => void }) {
  const navigation = useDetailNavigation();
  return <div className="space-y-6">
    {onBrowse && <section aria-label="Browse">
      <h2 className="mb-2 text-base font-medium">Browse</h2>
      <MediaList>
        <MediaRow title="Radio" meta="Stations and playlists" primary={{ label: "Open", onClick: () => onBrowse("radio") }} />
        {catalogues.map(item => {
          const href = collectionLocation({ provider: item.provider, url: "" });
          return <MediaRow key={item.provider} title={item.title} meta={item.meta} primary={{ label: "Open", href, onClick: () => navigation.open(href) }} />;
        })}
      </MediaList>
    </section>}
    <p className="max-w-prose text-sm text-muted-foreground">Couch searches YouTube, Twitch, RaiPlay and radio at once. You can also paste a link.</p>
  </div>;
}
