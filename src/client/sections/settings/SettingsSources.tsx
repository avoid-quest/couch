import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/api/client";
import { Button } from "@/components/ui/button";
import { librarySourcesQuery } from "@/api/library";
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

function SourcesOverview({ credentials, connected, canManage, setupOnly }: SourceSettingsProps & { setupOnly: boolean }) {
  const shell = useOptionalShell();
  const redesigned = shell?.standardLayout;
  const available = connected && !!credentials;
  const empty = { origin: "", token: "" };
  const folders = useQuery({ ...librarySourcesQuery(credentials ?? empty), enabled: available });
  const iptv = useQuery({ ...iptvSourcesQuery(credentials ?? empty), enabled: available });
  const jellyfin = useQuery({ queryKey: ["jellyfin", "settings-connection", canManage], enabled: available, queryFn: () => apiFetch(credentials ?? empty, `/api/jellyfin${canManage ? "/connection" : ""}`).then(response => response.json() as Promise<{ connected?: boolean; serverName?: string }>) });
  const radio = useQuery({ queryKey: ["radio", "settings-sources"], enabled: available && canManage, queryFn: () => apiFetch(credentials ?? empty, "/api/radio/sources").then(response => response.json() as Promise<{ sources: { name: string; stationCount: number }[] }>) });
  const metadata = useQuery({ queryKey: ["metadata", "provider"], enabled: available && canManage, queryFn: () => apiFetch(credentials ?? empty, "/api/metadata/provider").then(response => response.json() as Promise<{ configured: boolean }>) });
  const streaming = useQuery({ queryKey: ["settings", "streaming-community"], enabled: available && canManage, queryFn: () => apiFetch(credentials ?? empty, "/api/settings/streamingcommunity").then(response => response.json() as Promise<{ origin?: string }>) });
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
    <nav aria-label="Sources" className={redesigned ? "settings-source-list" : "max-w-2xl space-y-4"}>
      {sourcePages.map(([id, label]) => (
        id === "iptv" ? redesigned ? <div key={id} className="border-t border-border"><Button variant="ghost" className="settings-source-row grid min-h-14 w-full grid-cols-[16rem_minmax(0,1fr)_auto] items-center gap-4 rounded-none px-0 py-3 text-left text-base font-normal max-[900px]:grid-cols-[minmax(0,1fr)_auto]" onClick={() => shell?.openSources("iptv") }><span>{label}</span><span className="text-sm text-muted-foreground max-[900px]:col-start-1">{details[id]}</span><span aria-hidden="true">→</span></Button></div> : null :
        <div key={id} className={redesigned ? "border-t border-border" : "border-b border-border pb-4"}>
          <Link className={redesigned ? "settings-source-row grid min-h-14 grid-cols-[16rem_minmax(0,1fr)_auto] items-center gap-4 py-3 max-[900px]:grid-cols-[minmax(0,1fr)_auto]" : "flex min-h-11 items-center justify-between gap-3 rounded-md px-3 py-3 hover:bg-muted"} to={settingsPagePath(`source-${id}` as SettingsPage)}>
            <span>{label}</span>
            {redesigned && <span className="text-sm text-muted-foreground max-[900px]:col-start-1">{details[id] ?? "Open settings"}</span>}
            <span aria-hidden="true">→</span>
          </Link>
        </div>
      ))}
      {!redesigned && !setupOnly && <p className="px-3 text-sm text-muted-foreground">IPTV is set up from the source dialog on Find or Now.</p>}
      {redesigned && !connected && <p className="mt-4 text-sm text-muted-foreground">Reconnect to see source states.</p>}
    </nav>
  );
}
