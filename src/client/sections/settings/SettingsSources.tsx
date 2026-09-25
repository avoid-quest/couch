import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { librarySourcesQuery, metadataProviderQuery } from "@/api/library";
import { jellyfinQuery } from "@/api/jellyfin";
import { radioSourcesQuery } from "@/api/radio";
import { streamingCommunityQuery } from "@/api/settings";
import { iptvSourcesQuery } from "@/api/iptv";
import { settingsPagePath, type SettingsPage } from "../../../shared/settings-pages";
import { FolderSettings } from "./sources/FolderSettings";
import { IptvSettings } from "./sources/IptvSettings";
import { JellyfinSettings } from "./sources/JellyfinSettings";
import { MetadataSettings } from "./sources/MetadataSettings";
import { RadioSettings } from "./sources/RadioSettings";
import { StreamingCommunitySettings } from "./sources/StreamingCommunitySettings";
import type { SourceKind, SourceSettingsProps } from "@/components/sourceTypes";
import { useOptionalShell } from "@/sections/shell/shell-context";

const sourcePages: [SourceKind, string][] = [
  ["folders", "TV folders"],
  ["jellyfin", "Jellyfin"],
  ["iptv", "Live TV (IPTV)"],
  ["radio", "Radio playlists"],
  ["streaming-community", "StreamingCommunity"],
  ["metadata", "Film and series details"],
];

export function SettingsSources({ source, setupOnly = false, ...props }: SourceSettingsProps & { setupOnly?: boolean; source?: SourceKind }) {
  if (source === "folders") return <FolderSettings {...props} />;
  if (source === "jellyfin") return <JellyfinSettings {...props} />;
  if (source === "radio") return <RadioSettings {...props} />;
  if (source === "metadata") return <MetadataSettings {...props} />;
  if (source === "streaming-community") return <StreamingCommunitySettings {...props} />;
  if (source === "iptv") return <IptvSettings {...props} />;

  return <SourcesOverview setupOnly={setupOnly} {...props} />;
}

function SourcesOverview({ credentials, connected, canManage }: SourceSettingsProps & { setupOnly: boolean }) {
  const shell = useOptionalShell();
  const available = connected && !!credentials;
  const empty = { origin: "", token: "" };
  const folders = useQuery({ ...librarySourcesQuery(credentials ?? empty), enabled: available });
  const iptv = useQuery({ ...iptvSourcesQuery(credentials ?? empty), enabled: available });
  const jellyfin = useQuery({ ...jellyfinQuery(credentials ?? empty, canManage), enabled: available });
  const radio = useQuery({ ...radioSourcesQuery(credentials ?? empty), enabled: available && canManage });
  const metadata = useQuery({ ...metadataProviderQuery(credentials ?? empty), enabled: available && canManage });
  const streaming = useQuery({ ...streamingCommunityQuery(credentials ?? empty), enabled: available && canManage });
  const folderSources = folders.data?.sources ?? [];
  const details: Partial<Record<SourceKind, string>> = {
    folders: folderSources.length ? `${folderSources.length} ${folderSources.length === 1 ? "folder" : "folders"}, ${folderSources.reduce((total, item) => total + item.itemCount, 0).toLocaleString()} items` : "No folders added",
    jellyfin: jellyfin.data?.connected ? jellyfin.data.serverName || "Connected" : "Not connected",
    radio: radio.data?.sources.length ? `${radio.data.sources.length} playlists, ${radio.data.sources.reduce((total, item) => total + item.stationCount, 0)} stations` : "No playlists added",
    "streaming-community": streaming.data?.origin || "Not configured",
    metadata: metadata.data?.configured ? "TMDB token saved" : "Not configured",
    iptv: iptv.data?.sources.length ? `${iptv.data.sources.length} sources` : "Not set up",
  };

  return (
    <nav aria-label="Sources" className="settings-source-list">
      {sourcePages.map(([id, label]) => (
        id === "iptv" ? <div key={id} className="border-t border-border"><Button variant="ghost" className="settings-source-row grid min-h-14 w-full grid-cols-[16rem_minmax(0,1fr)_auto] items-center gap-4 rounded-none px-0 py-3 text-left text-base font-normal max-[900px]:grid-cols-[minmax(0,1fr)_auto]" onClick={() => shell?.openSources("iptv") }><span>{label}</span><span className="text-sm text-muted-foreground max-[900px]:col-start-1">{details[id]}</span><span aria-hidden="true">→</span></Button></div> :
        <div key={id} className="border-t border-border">
          <Link className="settings-source-row grid min-h-14 grid-cols-[16rem_minmax(0,1fr)_auto] items-center gap-4 py-3 max-[900px]:grid-cols-[minmax(0,1fr)_auto]" to={settingsPagePath(`source-${id}` as SettingsPage)}>
            <span>{label}</span>
            <span className="text-sm text-muted-foreground max-[900px]:col-start-1">{details[id] ?? "Open settings"}</span>
            <span aria-hidden="true">→</span>
          </Link>
        </div>
      ))}
      {!connected && <p className="mt-4 text-sm text-muted-foreground">Reconnect to see source states.</p>}
    </nav>
  );
}
