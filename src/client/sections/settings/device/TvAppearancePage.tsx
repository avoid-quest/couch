import { useShell } from "@/sections/shell/AppShell";
import { SettingsLayout } from "../SettingsLayout";
import { AppearanceSettings } from "./AppearanceSettings";

export function TvAppearancePage() {
  const { credentials, connected, identity, state } = useShell();
  return (
    <SettingsLayout section="tv-appearance">
      {!identity || identity.authority === "host" ? (
        <AppearanceSettings scope="tv" native={true} credentials={credentials} connected={connected}
          administrator={true} appearance={state?.appearance} />
      ) : (
        <AppearanceSettings scope="tv" native={false} credentials={credentials} connected={connected}
          administrator={identity.authority === "administrator"} appearance={state?.appearance} />
      )}
    </SettingsLayout>
  );
}
