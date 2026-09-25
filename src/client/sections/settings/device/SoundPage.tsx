import { useShell } from "@/sections/shell/AppShell";
import { SettingsLayout } from "../SettingsLayout";
import { SoundSettings } from "./SoundSettings";
import { useSessionGate } from "@/session/session-context";

export function SoundPage() {
  const { credentials } = useShell();
  const { connected, identity, state } = useSessionGate();
  return (
    <SettingsLayout section="sound">
      {(identity?.authority === "administrator" || identity?.authority === "host") && credentials
        ? <SoundSettings credentials={credentials} connected={connected} hostName={state?.installationName || "the playback host"} />
        : <p className="text-muted-foreground">An administrator can manage sound on the selected playback host.</p>}
    </SettingsLayout>
  );
}
