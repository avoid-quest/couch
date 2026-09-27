import { useShell } from "@/sections/shell/AppShell";
import { SettingsLayout } from "../SettingsLayout";
import { AdvancedSettings } from "./AdvancedSettings";
import { SendspinHostingSettings } from "./SendspinHostingSettings";
import { useSessionGate } from "@/session/session-context";

export function AdvancedPage() {
  const { credentials } = useShell();
  const { connected, identity } = useSessionGate();
  return (
    <SettingsLayout section="advanced">
      {credentials && <AdvancedSettings credentials={credentials} connected={connected} />}
      {credentials && (identity?.authority === "host" || identity?.authority === "administrator") && <SendspinHostingSettings credentials={credentials} connected={connected} />}
    </SettingsLayout>
  );
}
