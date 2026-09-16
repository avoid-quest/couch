import { useShell } from "../../../shell";
import { SettingsLayout } from "../SettingsLayout";
import { AdvancedSettings } from "./AdvancedSettings";

export function AdvancedPage() {
  const { credentials, connected, identity } = useShell();
  return (
    <SettingsLayout section="advanced">
      {identity?.authority === "administrator" && credentials
        ? <AdvancedSettings credentials={credentials} connected={connected} />
        : <p className="text-muted-foreground">An administrator can view diagnostics.</p>}
    </SettingsLayout>
  );
}
