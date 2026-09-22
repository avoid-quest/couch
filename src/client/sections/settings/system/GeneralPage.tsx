import { useShell } from "@/sections/shell/AppShell";
import { SettingsLayout } from "../SettingsLayout";
import { RestartSettings } from "./RestartSettings";
import { StartupSettings } from "./StartupSettings";
import { TvNameSettings } from "./TvNameSettings";

export function GeneralPage() {
  const { credentials, connected, host, identity, details } = useShell();
  const manager = identity?.authority === "administrator" || identity?.authority === "host";
  return (
    <SettingsLayout section="general">
      {manager && credentials ? [
        <TvNameSettings key="tv-name" credentials={credentials} connected={connected} canWrite={connected} host={!!host} />,
        ...(details?.tvPresentation ? [<StartupSettings key="startup" credentials={credentials} connected={connected} />] : []),
        <RestartSettings key="restart" credentials={credentials} connected={connected} />,
      ] : identity && credentials ? [
        <TvNameSettings key="tv-name" credentials={credentials} connected={connected} canWrite={false} host={!!host} />,
      ] : []}
    </SettingsLayout>
  );
}
