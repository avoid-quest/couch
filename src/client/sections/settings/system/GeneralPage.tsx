import { useShell } from "@/sections/shell/AppShell";
import { SettingsSection } from "@/components/SettingsRow";
import { SettingsLayout } from "../SettingsLayout";
import { StartupSettings } from "./StartupSettings";
import { useSessionGate } from "@/session/session-context";
import { DeviceNameSettings } from "./DeviceNameSettings";

export function GeneralPage() {
  const { credentials } = useShell();
  const { connected, identity, details } = useSessionGate();
  const manager = identity?.authority === "administrator" || identity?.authority === "host";
  return (
    <SettingsLayout section="general">
      <SettingsSection>
        <DeviceNameSettings />
        {manager && credentials && details?.tvPresentation && <StartupSettings credentials={credentials} connected={connected} />}
      </SettingsSection>
    </SettingsLayout>
  );
}
