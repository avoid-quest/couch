import { useShell } from "@/sections/shell/AppShell";
import { SettingsLayout } from "../SettingsLayout";
import { SoundSettings } from "./SoundSettings";

export function SoundPage() {
  const { credentials, connected, identity, state } = useShell();
  return (
    <SettingsLayout section="sound">
      {(identity?.authority === "administrator" || identity?.authority === "host") && credentials
        ? <SoundSettings credentials={credentials} connected={connected} hostName={state?.installationName || "the playback host"} />
        : <p className="text-muted-foreground">An administrator can manage sound on the selected playback host.</p>}
    </SettingsLayout>
  );
}
