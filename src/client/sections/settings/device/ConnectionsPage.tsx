import { useShell } from "@/sections/shell/AppShell";
import { SettingsLayout } from "../SettingsLayout";
import { ConnectionsSettings } from "./ConnectionsSettings";
import { useSessionGate } from "@/session/session-context";

export function ConnectionsPage() {
  const { credentials } = useShell();
  const { connected, details, host, identity, remoteControlEnabled, state } = useSessionGate();
  const manager = identity?.authority === "administrator" || identity?.authority === "host";
  return (
    <SettingsLayout section="connection">
      {identity && (manager || identity.claimAvailable) && credentials
        ? <ConnectionsSettings credentials={credentials} connected={connected} urls={host?.urls ?? details?.urls ?? [credentials.origin]} identity={identity} remoteControlEnabled={remoteControlEnabled} administratorClaimed={state?.administratorClaimed !== false} managedLan={details?.lanError !== undefined} lanError={details?.lanError} />
        : <p className="text-muted-foreground">An administrator can manage connections.</p>}
    </SettingsLayout>
  );
}
