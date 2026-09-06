import { JellyfinSettings } from "./JellyfinSettings";
import { RadioSettings } from "./RadioSettings";

export function SettingsSources({ radioVersion, ...props }: React.ComponentProps<typeof JellyfinSettings> & { radioVersion: number }) {
  return <div className="space-y-6"><JellyfinSettings {...props} /><RadioSettings {...props} version={radioVersion} /></div>;
}
