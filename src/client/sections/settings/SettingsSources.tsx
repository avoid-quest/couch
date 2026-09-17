import { settingsPagePath, type SettingsPage } from "../../../shared/settings-pages";
import { FolderSettings } from "./sources/FolderSettings";
import { IptvSettings } from "./sources/IptvSettings";
import { JellyfinSettings } from "./sources/JellyfinSettings";
import { MetadataSettings } from "./sources/MetadataSettings";
import { RadioSettings } from "./sources/RadioSettings";
import { StreamingCommunitySettings } from "./sources/StreamingCommunitySettings";
import type { SourceKind, SourceSettingsProps } from "@/components/sourceTypes";

const sourcePages: [SourceKind, string][] = [
  ["folders", "TV folders"],
  ["jellyfin", "Jellyfin"],
  ["radio", "Radio playlist"],
  ["metadata", "Metadata"],
  ["streaming-community", "Streaming Community"],
];

export function SettingsSources({ source, setupOnly = false, ...props }: SourceSettingsProps & { setupOnly?: boolean; source?: SourceKind }) {
  if (source === "folders") return <FolderSettings {...props} />;
  if (source === "jellyfin") return <JellyfinSettings {...props} />;
  if (source === "radio") return <RadioSettings {...props} />;
  if (source === "metadata") return <MetadataSettings {...props} />;
  if (source === "streaming-community") return <StreamingCommunitySettings {...props} />;
  if (source === "iptv") return <IptvSettings {...props} />;

  return (
    <nav aria-label="Sources" className="max-w-2xl space-y-4">
      {sourcePages.map(([id, label]) => (
        <div key={id} className="border-b border-border pb-4">
          <Link className="flex min-h-11 items-center justify-between gap-3 rounded-md px-3 py-3 hover:bg-muted" to={settingsPagePath(`source-${id}` as SettingsPage)}>
            <span>{label}</span>
            <span aria-hidden="true">→</span>
          </Link>
        </div>
      ))}
      {!setupOnly && <p className="px-3 text-sm text-muted-foreground">IPTV is set up from the source dialog on Find or Now.</p>}
    </nav>
  );
}
import { Link } from "@tanstack/react-router";
