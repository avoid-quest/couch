import { deviceName } from "@/copy";
import { deviceId, useLocalDeviceName } from "@/session/device-id";
import { couchApp } from "@/session/native-context";
import { useSessionGate } from "@/session/session-context";
import { defaultDeviceName } from "../../../shared/devices";
import { settingsPages, type SettingsPage } from "../../../shared/settings-pages";

/** Who is looking at Settings: this device's name, the Couch's name and whether this device can change the Couch. */
export function useSettingsScope() {
  const { identity, localHost, state, details } = useSessionGate();
  const savedName = useLocalDeviceName();
  const couch = deviceName(state?.installationName ?? details?.name);
  const host = identity ? identity.authority === "host" : localHost;
  const administrator = host || identity?.authority === "administrator";
  const device = host ? couch : savedName ?? identity?.device?.name ?? defaultDeviceName(deviceId());
  return { device, couch, host, administrator };
}

// Pages a non-admin can open but change nothing on; Devices & network, Playback and Sources each have a row anyone can use.
const adminOnly: SettingsPage[] = ["sound", "display", "updates"];
export type SettingsGroup = { title: string; subtitle: string; /** The Couch's connection, shown as a dot. */ connected?: boolean; pages: { id: SettingsPage; locked: boolean }[] };

/**
 * Settings' pages under their owners: This device, then the Couch by name with how it is connected. On the host they are
 * one Couch. Hardware pages need that hardware; nothing hides for a role, it locks.
 */
export function useSettingsGroups(): SettingsGroup[] {
  const { details, state, identity, status } = useSessionGate();
  const { device, couch, host, administrator } = useSettingsScope();
  const otherApps = state?.devices?.some(device => device.updates && device.id !== identity?.device?.id);
  const visible = (id: SettingsPage) => !id.startsWith("source-")
    // Sound outputs and Bluetooth exist only where Couch controls the system's sound (Linux).
    && (id !== "sound" || !!details?.systemAudio)
    && (id !== "display" || !!(details?.tvPresentation || details?.tvModeChangeable || details?.tvAppliance))
    // This app's own updater, unless it runs the Couch (then it is the Couch's), and the Couch's apps.
    && (id !== "device-updates" || !!couchApp?.updates && !host)
    && (id !== "updates" || !!details?.updates || !!otherApps);
  const pages = (owner?: "device" | "couch") => (Object.keys(settingsPages) as SettingsPage[])
    .filter(id => visible(id) && (!owner || settingsPages[id].owner === owner)).map(id => ({ id, locked: !administrator && adminOnly.includes(id) }));
  if (host) return [{ title: couch, subtitle: details?.tvPresentation || details?.tvAppliance ? "This TV runs it" : "This computer runs it", pages: pages() }];
  const connection = status === "connected" ? "Connected" : ["connecting", "syncing", "reconnecting"].includes(status) ? "Reconnecting" : "Offline";
  return [
    { title: "This device", subtitle: device, pages: pages("device") },
    { title: couch, subtitle: administrator ? `${connection} · admin` : connection, connected: status === "connected", pages: pages("couch") },
  ];
}
