import { StreamingCommunitySettings } from "./StreamingCommunitySettings";
import { MetadataSettings } from "./MetadataSettings";
import { FolderSettings } from "./FolderSettings";
import { JellyfinSettings } from "./JellyfinSettings";
import { RadioSettings } from "./RadioSettings";

export function SettingsSources({ radioVersion, libraryVersion, setupOnly = false, source, ...props }: React.ComponentProps<typeof JellyfinSettings> & { radioVersion: number; libraryVersion: number; setupOnly?: boolean; source?: string }) {
  if (source === "folders") return <FolderSettings {...props} version={libraryVersion} />;
  if (source === "jellyfin") return <JellyfinSettings {...props} />;
  if (source === "radio") return <RadioSettings {...props} version={radioVersion} />;
  if (source === "metadata") return <MetadataSettings {...props} version={libraryVersion} />;
  if (source === "streaming-community") return <StreamingCommunitySettings {...props} />;
  return <div className="space-y-6"><FolderSettings {...props} version={libraryVersion} /><JellyfinSettings {...props} />{!setupOnly && <><RadioSettings {...props} version={radioVersion} /><MetadataSettings {...props} version={libraryVersion} /><StreamingCommunitySettings {...props} /></>}</div>;
}
