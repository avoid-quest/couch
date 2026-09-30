import { useShell } from "@/sections/shell/AppShell";
import { SettingsSection } from "@/components/SettingsRow";
import { SettingsLayout } from "../SettingsLayout";
import { StartupSettings } from "./StartupSettings";
import { TvNameSettings } from "./TvNameSettings";
import { useSessionGate } from "@/session/session-context";
import { DeviceNameSettings } from "./DeviceNameSettings";

export function GeneralPage() {
  const { credentials } = useShell();
  const { connected, identity, details, localHost } = useSessionGate();
  const manager = identity?.authority === "administrator" || identity?.authority === "host";
  return (
    <SettingsLayout section="general">
      <SettingsSection>
        <DeviceNameSettings />
        {!localHost && manager && credentials && <TvNameSettings credentials={credentials} connected={connected} canWrite name={details?.name} />}
        {manager && credentials && details?.tvPresentation && <StartupSettings credentials={credentials} connected={connected} />}
      </SettingsSection>
    </SettingsLayout>
  );
}
