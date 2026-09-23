import { useShell } from "@/sections/shell/AppShell";
import { SettingsLayout } from "../SettingsLayout";
import { AppearanceSettings } from "./AppearanceSettings";

export function TvAppearancePage() {
  const { credentials, connected, identity, state, tvPresentation, details } = useShell();
  return (
    <SettingsLayout section="tv-appearance">
      {!tvPresentation && !details?.tvPresentation
        ? <p className="text-muted-foreground">TV appearance applies to a Linux TV host.</p>
        : <AppearanceSettings scope="tv" tvPresentation={tvPresentation} credentials={credentials} connected={connected}
          administrator={identity?.authority === "administrator" || identity?.authority === "host"}
          appearance={state?.appearance} hostName={state?.installationName} />}
    </SettingsLayout>
  );
}
