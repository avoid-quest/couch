import { useShell } from "@/sections/shell/AppShell";
import { SettingsLayout } from "../SettingsLayout";
import { AdvancedSettings } from "./AdvancedSettings";
import { useSessionGate } from "@/session/session-context";

export function AdvancedPage() {
  const { credentials } = useShell();
  const { connected, identity } = useSessionGate();
  return (
    <SettingsLayout section="advanced">
      {(identity?.authority === "administrator" || identity?.authority === "host") && credentials
        ? <AdvancedSettings credentials={credentials} connected={connected} />
        : <p className="text-muted-foreground">An administrator can view diagnostics.</p>}
    </SettingsLayout>
  );
}
