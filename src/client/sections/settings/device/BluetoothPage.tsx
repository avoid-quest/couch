import { useShell } from "@/sections/shell/AppShell";
import { SettingsLayout } from "../SettingsLayout";
import { BluetoothSettings } from "./BluetoothSettings";
import { useSessionGate } from "@/session/session-context";

export function BluetoothPage() {
  const { credentials } = useShell();
  const { connected, identity } = useSessionGate();
  return (
    <SettingsLayout section="bluetooth">
      {(identity?.authority === "administrator" || identity?.authority === "host") && credentials
        ? <BluetoothSettings credentials={credentials} connected={connected} />
        : <p className="text-muted-foreground">An administrator can manage Bluetooth.</p>}
    </SettingsLayout>
  );
}
