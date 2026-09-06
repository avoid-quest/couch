import { FolderSettings } from "./FolderSettings";
import { JellyfinSettings } from "./JellyfinSettings";
import { RadioSettings } from "./RadioSettings";

export function SettingsSources({ radioVersion, libraryVersion, ...props }: React.ComponentProps<typeof JellyfinSettings> & { radioVersion: number; libraryVersion: number }) {
  return <div className="space-y-6"><FolderSettings {...props} version={libraryVersion} /><JellyfinSettings {...props} /><RadioSettings {...props} version={radioVersion} /></div>;
}
