import { useShell } from "@/sections/shell/AppShell";
import { SettingsLayout } from "../SettingsLayout";
import { UpdatesSettings } from "./UpdatesSettings";

export function UpdatesPage() {
  const { credentials, connected, identity } = useShell();
  return (
    <SettingsLayout section="updates">
      {(identity?.authority === "administrator" || identity?.authority === "host") && credentials
        ? <UpdatesSettings credentials={credentials} connected={connected} />
        : <div className="space-y-3"><p>An administrator can install updates.</p><p className="text-muted-foreground">An administrator can approve this remote in Connections.</p></div>}
    </SettingsLayout>
  );
}
