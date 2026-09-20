import { useShell } from "@/sections/shell/AppShell";
import { SettingsLayout } from "../SettingsLayout";
import { ConnectionsSettings } from "./ConnectionsSettings";

export function ConnectionsPage() {
  const { credentials, connected, host, identity, state } = useShell();
  const manager = identity?.authority === "administrator" || identity?.authority === "host";
  const firstClaim = identity?.authority === "controller" && state?.administratorClaimed === false;
  return (
    <SettingsLayout section="connection">
      {(manager || firstClaim) && credentials
        ? <ConnectionsSettings credentials={credentials} connected={connected} host={host} selfId={identity?.controller?.id ?? null} identity={identity} administratorClaimed={state?.administratorClaimed !== false} />
        : <p className="text-muted-foreground">An administrator can manage connections.</p>}
    </SettingsLayout>
  );
}
