import { useShell } from "@/sections/shell/AppShell";
import { SettingsSection } from "@/components/SettingsRow";
import { SettingsLayout } from "../SettingsLayout";
import { StartupSettings } from "./StartupSettings";
import { useSessionGate } from "@/session/session-context";
import { DeviceNameSettings } from "./DeviceNameSettings";
import { DeviceSharingSettings } from "./DeviceSharingSettings";
import { QuitAppSettings } from "./QuitAppSettings";

export function GeneralPage() {
  const { credentials } = useShell();
  const { connected, identity, details, localHost } = useSessionGate();
  const manager = identity?.authority === "administrator" || identity?.authority === "host";
  return (
    <SettingsLayout section="general">
      <SettingsSection>
        <DeviceNameSettings />
        {manager && credentials && details?.tvPresentation && <StartupSettings credentials={credentials} connected={connected} />}
      </SettingsSection>
      {!localHost && <DeviceSharingSettings />}
      <QuitAppSettings />
    </SettingsLayout>
  );
}
