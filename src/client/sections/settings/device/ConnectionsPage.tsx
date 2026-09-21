import { useShell } from "@/sections/shell/AppShell";
import { SettingsLayout } from "../SettingsLayout";
import { ConnectionsSettings } from "./ConnectionsSettings";

export function ConnectionsPage() {
  const { credentials, connected, host, identity, state } = useShell();
  const manager = identity?.authority === "administrator" || identity?.authority === "host";
  return (
    <SettingsLayout section="connection">
      {identity && (manager || identity.claimAvailable) && credentials
        ? <ConnectionsSettings credentials={credentials} connected={connected} host={host} identity={identity} administratorClaimed={state?.administratorClaimed !== false} />
        : <p className="text-muted-foreground">An administrator can manage connections.</p>}
    </SettingsLayout>
  );
}
