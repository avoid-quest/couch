import { useShell } from "@/sections/shell/AppShell";
import { SettingsRow, SettingsSection } from "@/components/SettingsRow";
import { deviceName } from "@/copy";
import { SettingsLayout } from "../SettingsLayout";
import { RestartSettings } from "./RestartSettings";
import { StartupSettings } from "./StartupSettings";
import { TvNameSettings } from "./TvNameSettings";
import { useSessionGate } from "@/session/session-context";

export function GeneralPage() {
  const { credentials } = useShell();
  const { connected, identity, details } = useSessionGate();
  const manager = identity?.authority === "administrator" || identity?.authority === "host";
  return (
    <SettingsLayout section="general">
      <SettingsSection>
        {identity?.authority === "host" ? <SettingsRow label="Couch installation" description="Rename this computer in Settings → Devices."><span className="text-sm">{deviceName(details?.name)}</span></SettingsRow>
          : credentials ? <TvNameSettings credentials={credentials} connected={connected} canWrite={manager} name={details?.name} />
          : <SettingsRow label="Couch installation" description="Pair this remote to change it."><span className="text-sm">{deviceName(details?.name)}</span></SettingsRow>}
        {manager && credentials && details?.tvPresentation && <StartupSettings credentials={credentials} connected={connected} />}
        {manager && credentials && details?.capabilities?.restart === true && <RestartSettings credentials={credentials} connected={connected} hostName={deviceName(details?.name)} />}
      </SettingsSection>
    </SettingsLayout>
  );
}
