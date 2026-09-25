import { useShell } from "@/sections/shell/AppShell";
import { SettingsLayout } from "../SettingsLayout";
import { AdvancedSettings } from "./AdvancedSettings";
import { useSessionGate } from "@/session/session-context";

export function AdvancedPage() {
  const { credentials } = useShell();
  const { connected } = useSessionGate();
  return (
    <SettingsLayout section="advanced">
      {credentials && <AdvancedSettings credentials={credentials} connected={connected} />}
    </SettingsLayout>
  );
}
