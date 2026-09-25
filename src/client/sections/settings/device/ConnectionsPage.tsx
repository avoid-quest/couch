import { useShell } from "@/sections/shell/AppShell";
import { SettingsLayout } from "../SettingsLayout";
import { ConnectionsSettings } from "./ConnectionsSettings";

export function ConnectionsPage() {
  const { credentials, connected, details, host, identity, remoteControlEnabled, setRemoteControlEnabled, state } = useShell();
  const manager = identity?.authority === "administrator" || identity?.authority === "host";
  return (
    <SettingsLayout section="connection">
      {identity && (manager || identity.claimAvailable) && credentials
        ? <ConnectionsSettings credentials={credentials} connected={connected} urls={host?.urls ?? details?.urls ?? [credentials.origin]} identity={identity} remoteControlEnabled={remoteControlEnabled} setRemoteControlEnabled={setRemoteControlEnabled} administratorClaimed={state?.administratorClaimed !== false} managedLan={details?.lanError !== undefined} lanError={details?.lanError} />
        : <p className="text-muted-foreground">An administrator can manage connections.</p>}
    </SettingsLayout>
  );
}
