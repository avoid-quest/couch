import { useShell } from "@/sections/shell/AppShell";
import { deviceName } from "@/copy";
import { SettingsLayout } from "../SettingsLayout";
import { SoundSettings } from "./SoundSettings";
import { useSessionGate } from "@/session/session-context";

export function SoundPage() {
  const { credentials } = useShell();
  const { connected, state, details } = useSessionGate();
  return (
    <SettingsLayout section="sound">
      {credentials && <SoundSettings credentials={credentials} connected={connected} hostName={deviceName(state?.installationName ?? details?.name)} />}
    </SettingsLayout>
  );
}
