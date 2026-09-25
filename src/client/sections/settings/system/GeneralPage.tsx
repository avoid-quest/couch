import { useShell } from "@/sections/shell/AppShell";
import { SettingsLayout } from "../SettingsLayout";
import { RestartSettings } from "./RestartSettings";
import { StartupSettings } from "./StartupSettings";
import { TvNameSettings } from "./TvNameSettings";
import { useSessionGate } from "@/session/session-context";

export function GeneralPage() {
  const { credentials } = useShell();
  const { connected, host, identity, details } = useSessionGate();
  const manager = identity?.authority === "administrator" || identity?.authority === "host";
  return (
    <SettingsLayout section="general">
      {manager && credentials ? [
        <TvNameSettings key="tv-name" credentials={credentials} connected={connected} canWrite={connected} host={!!host} name={details?.name} />,
        ...(details?.tvPresentation ? [<StartupSettings key="startup" credentials={credentials} connected={connected} />] : []),
        <RestartSettings key="restart" credentials={credentials} connected={connected} />,
      ] : identity && credentials ? [
        <TvNameSettings key="tv-name" credentials={credentials} connected={connected} canWrite={false} host={!!host} name={details?.name} />,
      ] : []}
    </SettingsLayout>
  );
}
