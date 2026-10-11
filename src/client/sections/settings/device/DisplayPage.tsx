import { useShell } from "@/sections/shell/AppShell";
import { SettingsLayout } from "../SettingsLayout";
import { DisplaySettings } from "./DisplaySettings";
import { useSessionGate } from "@/session/session-context";

export function DisplayPage() {
  const { credentials } = useShell();
  const { connected, details } = useSessionGate();
  return (
    <SettingsLayout section="display">
      {!details?.tvPresentation ? <p className="text-sm text-muted-foreground">Only on Couch for Linux TVs.</p>
        : credentials && <DisplaySettings credentials={credentials} connected={connected} />}
    </SettingsLayout>
  );
}
