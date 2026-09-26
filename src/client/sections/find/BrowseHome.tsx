import { useQuery } from "@tanstack/react-query";
import { MediaList, MediaRow } from "@/components/MediaRow";
import { librarySourcesQuery } from "@/api/library";
import { jellyfinQuery } from "@/api/jellyfin";
import { iptvSourcesQuery } from "@/api/iptv";
import type { Credentials } from "../../session/session";

/** What this Couch has set up beyond the built-in online sources and radio. */
export function useLibraryReach(credentials: Credentials, connected: boolean) {
  const folders = useQuery({ ...librarySourcesQuery(credentials), enabled: connected });
  const jellyfin = useQuery({ ...jellyfinQuery(credentials), enabled: connected });
  const liveTv = useQuery({ ...iptvSourcesQuery(credentials), enabled: connected });
  const reach = { folders: !!folders.data?.sources.length, jellyfin: !!jellyfin.data?.connected, liveTv: !!liveTv.data?.sources.length };
  return { ...reach, any: reach.folders || reach.jellyfin || reach.liveTv, ready: folders.isSuccess && jellyfin.isSuccess && liveTv.isSuccess };
}

/** The sources one search reaches, e.g. "YouTube, Twitch, RaiPlay and radio". */
export function searchReach({ folders, jellyfin }: { folders: boolean; jellyfin: boolean }) {
  const names = ["YouTube", "Twitch", "RaiPlay", "radio", ...(folders ? ["your folders"] : []), ...(jellyfin ? ["Jellyfin"] : [])];
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

// Find with an empty query: what Couch searches and where to browse. What to
// continue and what was saved for later live on Home.
export function BrowseHome({ credentials, connected, onBrowse }: { credentials: Credentials; connected: boolean; onBrowse?: (source: "music" | "radio") => void }) {
  const library = useLibraryReach(credentials, connected);
  return <div className="space-y-6">
    {onBrowse && <section aria-label="Browse">
      <h2 className="mb-2 text-base font-medium">Browse</h2>
      <MediaList>
        <MediaRow title="Radio" meta="Stations and playlists" primary={{ label: "Open", onClick: () => onBrowse("radio") }} />
        <MediaRow title="Music" meta={library.folders || !library.ready ? "Artists and albums in your folders" : "Add a folder to browse its artists and albums"} primary={{ label: "Open", onClick: () => onBrowse("music") }} />
      </MediaList>
    </section>}
    <p className="max-w-prose text-sm text-muted-foreground">Couch searches {searchReach(library)} at once. You can also paste a link.</p>
  </div>;
}
