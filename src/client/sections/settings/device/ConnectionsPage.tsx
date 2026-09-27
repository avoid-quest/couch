import { useShell } from "@/sections/shell/AppShell";
import { deviceName } from "@/copy";
import { SettingsLayout } from "../SettingsLayout";
import { ConnectionsSettings } from "./ConnectionsSettings";
import { SendspinHostingSettings } from "./SendspinHostingSettings";
import { useSessionGate } from "@/session/session-context";

export function ConnectionsPage() {
  const { credentials } = useShell();
  const { connected, details, host, identity, remoteControlEnabled, state } = useSessionGate();
  return (
    <SettingsLayout section="connection">
      {identity && credentials && <ConnectionsSettings credentials={credentials} connected={connected} urls={host?.urls ?? details?.urls ?? [credentials.origin]} identity={identity} remoteControlEnabled={remoteControlEnabled}
        administratorClaimed={state?.administratorClaimed !== false} managedLan={details?.lanError !== undefined} lanError={details?.lanError} hostName={deviceName(state?.installationName ?? details?.name)} />}
      {identity && credentials && (identity.authority === "host" || identity.authority === "administrator") && <SendspinHostingSettings credentials={credentials} connected={connected} />}
    </SettingsLayout>
  );
}
