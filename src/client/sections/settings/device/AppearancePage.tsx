import { useShell } from "@/sections/shell/AppShell";
import { SettingsLayout } from "../SettingsLayout";
import { AppearanceSettings } from "./AppearanceSettings";
import { useSessionGate } from "@/session/session-context";

export function AppearancePage() {
  const shell = useShell();
  const { credentials } = shell;
  const { connected, identity, state, tvPresentation } = useSessionGate();
  return (
    <SettingsLayout section="appearance">
      <AppearanceSettings scope="device" tvPresentation={tvPresentation} credentials={credentials} connected={connected}
        administrator={identity?.authority === "administrator" || identity?.authority === "host"}
        appearance={state?.appearance} hostName={state?.installationName} />
    </SettingsLayout>
  );
}
