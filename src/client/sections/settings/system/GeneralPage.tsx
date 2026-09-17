import { useShell } from "@/sections/shell/AppShell";
import { SettingsLayout } from "../SettingsLayout";
import { RestartSettings } from "./RestartSettings";
import { StartupSettings } from "./StartupSettings";
import { TvNameSettings } from "./TvNameSettings";

export function GeneralPage() {
  const { credentials, connected, host, identity } = useShell();
  return (
    <SettingsLayout section="general">
      <div className="space-y-4">
        {(identity?.authority === "administrator" || identity?.authority === "host") && credentials && (
          <>
            <TvNameSettings credentials={credentials} connected={connected} canWrite={connected} host={!!host} />
            <StartupSettings credentials={credentials} connected={connected} />
            <RestartSettings credentials={credentials} connected={connected} />
          </>
        )}
        {identity && identity.authority !== "administrator" && credentials && <TvNameSettings credentials={credentials} connected={connected} canWrite={false} host={!!host} />}
      </div>
    </SettingsLayout>
  );
}
