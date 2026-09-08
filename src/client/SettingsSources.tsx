import { MetadataSettings } from "./MetadataSettings";
import { FolderSettings } from "./FolderSettings";
import { JellyfinSettings } from "./JellyfinSettings";
import { RadioSettings } from "./RadioSettings";

export function SettingsSources({ radioVersion, libraryVersion, setupOnly = false, ...props }: React.ComponentProps<typeof JellyfinSettings> & { radioVersion: number; libraryVersion: number; setupOnly?: boolean }) {
  return <div className="space-y-6"><FolderSettings {...props} version={libraryVersion} /><JellyfinSettings {...props} />{!setupOnly && <><RadioSettings {...props} version={radioVersion} /><MetadataSettings {...props} version={libraryVersion} /></>}</div>;
}
