import { useShell } from "@/sections/shell/AppShell";
import { SettingsLayout } from "../SettingsLayout";
import { DisplaySettings } from "./DisplaySettings";
import { useSessionGate } from "@/session/session-context";

export function DisplayPage() {
  const { credentials } = useShell();
  const { connected, identity, details } = useSessionGate();
  return (
    <SettingsLayout section="display">
      {!details?.tvPresentation ? <p className="text-muted-foreground">Screen selection applies to a Linux TV host.</p>
        : (identity?.authority === "administrator" || identity?.authority === "host") && credentials
        ? <DisplaySettings credentials={credentials} connected={connected} />
        : <p className="text-muted-foreground">An administrator can choose the TV screen.</p>}
    </SettingsLayout>
  );
}
