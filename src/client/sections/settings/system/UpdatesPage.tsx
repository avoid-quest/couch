import { useShell } from "@/sections/shell/AppShell";
import { deviceName } from "@/copy";
import { SettingsLayout } from "../SettingsLayout";
import { UpdatesSettings } from "./UpdatesSettings";
import { useSessionGate } from "@/session/session-context";

export function UpdatesPage() {
  const { credentials } = useShell();
  const { connected, localHost, state, details } = useSessionGate();
  return (
    <SettingsLayout section="updates">
      {credentials && <UpdatesSettings credentials={credentials} connected={connected} target={localHost ? "this app" : "selected host"} hostName={deviceName(state?.installationName ?? details?.name)} />}
    </SettingsLayout>
  );
}
