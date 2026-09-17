import { useShell } from "@/sections/shell/AppShell";
import { SettingsLayout } from "../SettingsLayout";
import { BluetoothSettings } from "./BluetoothSettings";

export function BluetoothPage() {
  const { credentials, connected, identity } = useShell();
  return (
    <SettingsLayout section="bluetooth">
      {(identity?.authority === "administrator" || identity?.authority === "host") && credentials
        ? <BluetoothSettings credentials={credentials} connected={connected} />
        : <p className="text-muted-foreground">An administrator can manage Bluetooth.</p>}
    </SettingsLayout>
  );
}
