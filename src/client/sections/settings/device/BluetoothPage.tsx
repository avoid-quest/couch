import { useShell } from "@/sections/shell/AppShell";
import { deviceName } from "@/copy";
import { SettingsLayout } from "../SettingsLayout";
import { BluetoothSettings } from "./BluetoothSettings";
import { useSessionGate } from "@/session/session-context";

export function BluetoothPage() {
  const { credentials } = useShell();
  const { connected, state, details } = useSessionGate();
  const hostName = deviceName(state?.installationName ?? details?.name);
  return (
    <SettingsLayout section="bluetooth">
      {details?.capabilities?.nativePlayback === false ? <p className="text-sm text-muted-foreground">{hostName} has no built-in player to connect speakers to.</p>
        : credentials && <><p className="text-sm text-muted-foreground">Bluetooth settings on {hostName}.</p><BluetoothSettings credentials={credentials} connected={connected} /></>}
    </SettingsLayout>
  );
}
