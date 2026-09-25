import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { EmptyContent } from "@/components/ui/empty";
import { MediaList, MediaRow } from "@/components/MediaRow";
import { SettingsRow, SettingsSection } from "@/components/SettingsRow";
import { librarySourcesQuery } from "@/api/library";
import { jellyfinQuery } from "@/api/jellyfin";
import { iptvSourcesQuery } from "@/api/iptv";
import type { Credentials } from "../../session/session";

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;
const status = (count: number, noun: string, note?: string) => count ? [plural(count, noun), note].filter(Boolean).join(" · ") : "Not set up";

// Find with an empty query: what Couch searches and where to browse. What to
// continue and what was saved for later live on Home.
export function BrowseHome({ onBrowse }: { onBrowse?: (source: "music" | "radio") => void }) {
  return <div className="space-y-6">
    {onBrowse && <section aria-label="Browse">
      <h2 className="mb-2 text-base font-medium">Browse</h2>
      <MediaList>
        <MediaRow title="Radio" meta="Stations and playlists" primary={{ label: "Open", onClick: () => onBrowse("radio") }} />
        <MediaRow title="Music" meta="Artists and albums in your folders" primary={{ label: "Open", onClick: () => onBrowse("music") }} />
      </MediaList>
    </section>}
    <p className="max-w-prose text-sm text-muted-foreground">Couch searches YouTube, Twitch, RaiPlay, radio and your folders at once. You can also paste a link.</p>
  </div>;
}

export function SourcesStatus({ credentials, connected, active, onAddSource }: { credentials: Credentials; connected: boolean; active: boolean; onAddSource?: () => void }) {
  const enabled = connected && active;
  const folders = useQuery({ ...librarySourcesQuery(credentials), enabled }).data?.sources ?? [];
  const jellyfin = useQuery({ ...jellyfinQuery(credentials, true), enabled }).data;
  const iptv = useQuery({ ...iptvSourcesQuery(credentials), enabled }).data?.sources ?? [];
  const attention = "Needs attention";
  return <EmptyContent className="mt-4 max-w-xl gap-4">
    <SettingsSection title="Sources" className="w-full">
      <SettingsRow label="Folders"><span className="text-sm leading-6 text-muted-foreground">{status(folders.length, "folder", folders.some(folder => folder.status === "scanning") ? "Scanning" : folders.some(folder => folder.status === "error" || folder.status === "unavailable") ? attention : undefined)}</span></SettingsRow>
      <SettingsRow label="Jellyfin"><span className="text-sm leading-6 text-muted-foreground">{jellyfin?.connected ? "Connected" : "Not set up"}</span></SettingsRow>
      <SettingsRow label="Live TV"><span className="text-sm leading-6 text-muted-foreground">{status(iptv.length, "source", iptv.some(source => source.error) ? attention : undefined)}</span></SettingsRow>
      <SettingsRow label="Radio"><span className="text-sm leading-6 text-muted-foreground">Built in</span></SettingsRow>
    </SettingsSection>
    {onAddSource && <Button variant="outline" onClick={onAddSource}>Add a source</Button>}
  </EmptyContent>;
}
