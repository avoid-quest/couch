import { useShell } from "@/sections/shell/AppShell";
import { SettingsLayout } from "../SettingsLayout";
import { DisplaySettings } from "./DisplaySettings";

export function DisplayPage() {
  const { credentials, connected, identity } = useShell();
  return (
    <SettingsLayout section="display">
      {(identity?.authority === "administrator" || identity?.authority === "host") && credentials
        ? <DisplaySettings credentials={credentials} connected={connected} />
        : <p className="text-muted-foreground">An administrator can choose the TV screen.</p>}
    </SettingsLayout>
  );
}
