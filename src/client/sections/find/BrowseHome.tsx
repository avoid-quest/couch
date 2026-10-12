import { useQuery } from "@tanstack/react-query";
import { MediaList, MediaRow } from "@/components/MediaRow";
import { iptvSourcesQuery } from "@/api/iptv";
import { useShell } from "@/sections/shell/AppShell";
import { useSessionGate } from "@/session/session-context";
import { collectionLocation, useDetailNavigation } from "@/detail-navigation";
import type { ProviderId } from "../../../shared/providers";

const catalogues: { title: string; meta: string; provider: ProviderId }[] = [
  { title: "Bandcamp", meta: "Albums and tracks", provider: "bandcamp" },
  { title: "SoundCloud", meta: "Tracks", provider: "soundcloud" },
  { title: "RaiPlay", meta: "Programmes and live TV", provider: "raiplay" },
  { title: "StreamingCommunity", meta: "Films and series", provider: "streamingcommunity" },
  { title: "123MoviesFree", meta: "Films and series", provider: "movies123" },
  { title: "YouTube", meta: "Channels and playlists", provider: "youtube" },
  { title: "Twitch", meta: "Live streams and past broadcasts", provider: "twitch" },
];

// Find with an empty query: where to browse. What to continue and what was
// saved for later live on Home.
export function BrowseHome({ onBrowse }: { onBrowse?: (source: "radio" | "live-tv") => void }) {
  const navigation = useDetailNavigation();
  const { connected } = useSessionGate();
  // Live TV appears once a source has channels.
  const iptv = useQuery({ ...iptvSourcesQuery(useShell().credentials), enabled: connected });
  const liveTv = !!iptv.data?.sources.some(source => source.channelCount);
  return <div className="space-y-6">
    {onBrowse && <section aria-label="Browse">
      <h2 className="mb-2 text-base font-medium">Browse</h2>
      <MediaList>
        <MediaRow title="Radio" meta="Stations and playlists" primary={{ label: "Open", onClick: () => onBrowse("radio") }} />
        {liveTv && <MediaRow title="Live TV" meta="Channels and what's on" primary={{ label: "Open", onClick: () => onBrowse("live-tv") }} />}
        {catalogues.map(item => {
          const href = collectionLocation({ provider: item.provider, url: "" });
          return <MediaRow key={item.provider} title={item.title} meta={item.meta} primary={{ label: "Open", href, onClick: () => navigation.open(href) }} />;
        })}
      </MediaList>
    </section>}
  </div>;
}
