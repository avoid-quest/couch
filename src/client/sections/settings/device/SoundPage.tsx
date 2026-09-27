import { useShell } from "@/sections/shell/AppShell";
import { deviceName } from "@/copy";
import { SettingsLayout } from "../SettingsLayout";
import { SoundSettings } from "./SoundSettings";
import { useSessionGate } from "@/session/session-context";

export function SoundPage() {
  const { credentials } = useShell();
  const { connected, state, details } = useSessionGate();
  const hostName = deviceName(state?.installationName ?? details?.name);
  return (
    <SettingsLayout section="sound">
      {details?.capabilities?.nativePlayback === false ? <p className="text-sm text-muted-foreground">{hostName} has no built-in player or sound outputs to configure. Adjust a playing device from Now Playing.</p>
        : credentials && <><p className="text-sm text-muted-foreground">Sound settings on {hostName}.</p><SoundSettings credentials={credentials} connected={connected} hostName={hostName} /></>}
    </SettingsLayout>
  );
}
