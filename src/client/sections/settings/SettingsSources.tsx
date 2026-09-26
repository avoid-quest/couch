import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight } from "lucide-react";
import { librarySourcesQuery, metadataProviderQuery } from "@/api/library";
import { jellyfinQuery } from "@/api/jellyfin";
import { radioSourcesQuery } from "@/api/radio";
import { streamingCommunityQuery } from "@/api/settings";
import { iptvSourcesQuery } from "@/api/iptv";
import { avoidRadioPlaylistId } from "../../../shared/radio";
import { settingsPages, type SettingsPage } from "../../../shared/settings-pages";
import { FolderSettings } from "./sources/FolderSettings";
import { IptvSettings } from "./sources/IptvSettings";
import { JellyfinSettings } from "./sources/JellyfinSettings";
import { MetadataSettings } from "./sources/MetadataSettings";
import { RadioSettings } from "./sources/RadioSettings";
import { StreamingCommunitySettings } from "./sources/StreamingCommunitySettings";
import type { SourceKind, SourceSettingsProps } from "@/components/sourceTypes";

const sourcePages: SourceKind[] = ["folders", "jellyfin", "iptv", "radio", "streaming-community", "metadata"];
const plural = (count: number, one: string) => `${count.toLocaleString()} ${one}${count === 1 ? "" : "s"}`;

export function SettingsSources({ source, ...props }: SourceSettingsProps & { source?: SourceKind }) {
  if (source === "folders") return <FolderSettings {...props} />;
  if (source === "jellyfin") return <JellyfinSettings {...props} />;
  if (source === "radio") return <RadioSettings {...props} />;
  if (source === "metadata") return <MetadataSettings {...props} />;
  if (source === "streaming-community") return <StreamingCommunitySettings {...props} />;
  if (source === "iptv") return <IptvSettings {...props} />;
  return <SourcesOverview {...props} />;
}

function SourcesOverview({ credentials, connected, canManage }: SourceSettingsProps) {
  const available = connected && !!credentials;
  const empty = { origin: "", token: "" };
  const folders = useQuery({ ...librarySourcesQuery(credentials ?? empty), enabled: available });
  const iptv = useQuery({ ...iptvSourcesQuery(credentials ?? empty), enabled: available });
  const jellyfin = useQuery({ ...jellyfinQuery(credentials ?? empty, canManage), enabled: available });
  const radio = useQuery({ ...radioSourcesQuery(credentials ?? empty), enabled: available && canManage });
  const metadata = useQuery({ ...metadataProviderQuery(credentials ?? empty), enabled: available && canManage });
  const streaming = useQuery({ ...streamingCommunityQuery(credentials ?? empty), enabled: available && canManage });
  const folderSources = folders.data?.sources;
  const radioSources = radio.data?.sources.filter(item => item.id !== avoidRadioPlaylistId);
  const status: Record<SourceKind, string | undefined> = {
    folders: folderSources && (folderSources.length ? `${plural(folderSources.length, "folder")} · ${plural(folderSources.reduce((total, item) => total + item.itemCount, 0), "item")}` : "Not set up"),
    jellyfin: jellyfin.data && (jellyfin.data.connected ? jellyfin.data.serverName || "Connected" : "Not set up"),
    iptv: iptv.data && (iptv.data.sources.length ? `${plural(iptv.data.sources.length, "list")} · ${plural(iptv.data.sources.reduce((total, item) => total + item.channelCount, 0), "channel")}` : "Not set up"),
    radio: radioSources && (radioSources.length ? plural(radioSources.length, "playlist") : "Built in only"),
    "streaming-community": streaming.data?.origin,
    metadata: metadata.data && (metadata.data.configured ? "Set up" : "Not set up"),
  };

  return (
    <nav aria-label="Sources" className="flex min-w-0 flex-col border-t">
      {sourcePages.map(id => (
        <div key={id} className="border-b py-1"><Link to={settingsPages[`source-${id}` as SettingsPage].path} className="-mx-2 flex min-w-0 items-center gap-4 rounded-sm px-2 py-2 hover:bg-muted">
          <span className="flex min-w-0 flex-1 flex-col gap-0.5 md:flex-row md:items-baseline md:gap-8">
            <span className="shrink-0 text-base md:w-56">{settingsPages[`source-${id}` as SettingsPage].label}</span>
            <span className="truncate text-sm text-muted-foreground">{status[id]}</span>
          </span>
          <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
        </Link></div>
      ))}
    </nav>
  );
}
