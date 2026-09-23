import { useShell } from "@/sections/shell/AppShell";
import { SettingsLayout } from "../SettingsLayout";
import { AppearanceSettings } from "./AppearanceSettings";

export function AppearancePage() {
  const shell = useShell();
  const { credentials, connected, identity, state, tvPresentation } = shell;
  return (
    <SettingsLayout section="appearance">
      <AppearanceSettings scope="device" tvPresentation={tvPresentation} credentials={credentials} connected={connected}
        administrator={identity?.authority === "administrator" || identity?.authority === "host"}
        appearance={state?.appearance} hostName={state?.installationName} />
    </SettingsLayout>
  );
}
