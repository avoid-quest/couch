import { useShell } from "@/sections/shell/AppShell";
import { SettingsLayout } from "../SettingsLayout";
import { BluetoothSettings } from "./BluetoothSettings";
import { useSessionGate } from "@/session/session-context";

export function BluetoothPage() {
  const { credentials } = useShell();
  const { connected } = useSessionGate();
  return (
    <SettingsLayout section="bluetooth">
      {credentials && <BluetoothSettings credentials={credentials} connected={connected} />}
    </SettingsLayout>
  );
}
