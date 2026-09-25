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
        {credentials ? <TvNameSettings credentials={credentials} connected={connected} canWrite={manager} name={details?.name} />
          : <SettingsRow label="Name" description="Pair this browser to change it."><span className="text-sm">{deviceName(details?.name)}</span></SettingsRow>}
        {manager && credentials && details?.tvPresentation && <StartupSettings credentials={credentials} connected={connected} />}
        {manager && credentials && <RestartSettings credentials={credentials} connected={connected} hostName={deviceName(details?.name)} />}
      </SettingsSection>
    </SettingsLayout>
  );
}
