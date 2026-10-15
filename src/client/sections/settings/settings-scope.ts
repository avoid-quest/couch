import { deviceName } from "@/copy";
import { deviceId, useLocalDeviceName } from "@/session/device-id";
import { couchApp } from "@/session/native-context";
import { useSessionGate } from "@/session/session-context";
import { defaultDeviceName } from "../../../shared/devices";
import { settingsPages, type SettingsPage } from "../../../shared/settings-pages";

/** Who is looking at Settings: this device's name, the Couch's name and this device's role there. */
export function useSettingsScope() {
  const { identity, localHost, state, details } = useSessionGate();
  const savedName = useLocalDeviceName();
  const couch = deviceName(state?.installationName ?? details?.name);
  const host = identity ? identity.authority === "host" : localHost;
  const administrator = host || identity?.authority === "administrator";
  const device = host ? couch : savedName ?? identity?.device?.name ?? defaultDeviceName(deviceId());
  // Unknown until this device's identity arrives.
  const role = host ? "This device runs it" : administrator ? "You're an admin" : identity ? "Only admins change most" : null;
  return { device, couch, host, administrator, role };
}

/** Pages this device and its Couch have. Hardware pages need that hardware; nothing hides for a role. */
export function useSettingsPages() {
  const { details, state, identity } = useSessionGate();
  const { host } = useSettingsScope();
  const otherApps = state?.devices?.some(device => device.updates && device.id !== identity?.device?.id);
  const visible = (id: SettingsPage) => !id.startsWith("source-")
    // This app's updater is the Couch's own when this app hosts it.
    && (id !== "device-updates" || !!couchApp?.updates && !host)
    // Sound outputs and Bluetooth exist only where Couch controls the system's sound (Linux).
    && (id !== "sound" && id !== "bluetooth" || !!details?.systemAudio)
    && (id !== "display" || !!details?.tvPresentation)
    && (id !== "updates" || !!details?.updates || !!otherApps);
  return (Object.keys(settingsPages) as SettingsPage[]).filter(visible);
}
