import { useShell } from "@/sections/shell/AppShell";
import { SettingsLayout } from "../SettingsLayout";
import { AppearanceSettings } from "./AppearanceSettings";
import { useSessionGate } from "@/session/session-context";

export function TvAppearancePage() {
  const { credentials } = useShell();
  const { connected, state, tvPresentation, details } = useSessionGate();
  return (
    <SettingsLayout section="tv-appearance">
      {!tvPresentation && !details?.tvPresentation
        ? <p className="text-sm text-muted-foreground">Only on Couch for Linux TVs.</p>
        : <AppearanceSettings scope="tv" tvPresentation={tvPresentation} credentials={credentials} connected={connected} administrator appearance={state?.appearance} />}
    </SettingsLayout>
  );
}
