import { useShell } from "@/sections/shell/AppShell";
import { SettingsLayout } from "../SettingsLayout";
import { ConnectionsSettings } from "./ConnectionsSettings";

export function ConnectionsPage() {
  const { credentials, connected, host, identity } = useShell();
  return (
    <SettingsLayout section="connection">
      {identity?.authority === "administrator" && credentials
        ? <ConnectionsSettings credentials={credentials} connected={connected} host={host} selfId={identity.controller?.id ?? null} />
        : <p className="text-muted-foreground">An administrator can manage connections.</p>}
    </SettingsLayout>
  );
}
