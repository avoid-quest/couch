import { useShell } from "../../../shell";
import { SettingsLayout } from "../SettingsLayout";
import { AppearanceSettings } from "./AppearanceSettings";

export function AppearancePage() {
  const shell = useShell();
  const { credentials, connected, host, identity, state } = shell;
  return (
    <SettingsLayout section="appearance">
      <AppearanceSettings scope="device" native={!!host} credentials={credentials} connected={connected}
        administrator={identity?.authority === "administrator" || !!host && identity?.authority === "host"}
        appearance={state?.appearance} />
    </SettingsLayout>
  );
}
