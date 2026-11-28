import { deviceName } from "@/copy";
import { deviceId, useLocalDeviceName } from "@/session/device-id";
import { couchApp } from "@/session/native-context";
import { useSessionGate } from "@/session/session-context";
import { updatesPage } from "@/sections/updates/update-presentation";
import { defaultDeviceName } from "../../../shared/devices";
import { settingsPages, type SettingsPage } from "../../../shared/settings-pages";

/**
 * Who is looking at Settings: this device's name, the Couch's name and whether this device can change the Couch. `known`
 * is false until a remote app's identity arrives, when `administrator` is still a guess.
 */
export function useSettingsScope() {
  const { identity, localHost, state, details } = useSessionGate();
  const savedName = useLocalDeviceName();
  const couch = deviceName(state?.installationName ?? details?.name);
  const host = identity ? identity.authority === "host" : localHost;
  const administrator = host || identity?.authority === "administrator";
  const device = host
    ? couch
    : (savedName ?? identity?.device?.name ?? defaultDeviceName(deviceId()));
  return { device, couch, host, administrator, known: !!identity || localHost };
}

// Pages a non-admin can open but change nothing on; Devices & network, Playback and Sources each have a row anyone can use.
const adminOnly: SettingsPage[] = ["sound", "display"];
export type SettingsGroup = {
  owner: "device" | "couch";
  title: string;
  subtitle: string;
  pages: { id: SettingsPage; locked: boolean }[];
};

/**
 * Settings' pages under their owners, named after the real things: this device by its name, then the Couch by its name.
 * The host has both too: what it keeps for itself, and what it keeps for everyone. Hardware pages need that hardware; a
 * role locks pages, except Updates, which each viewer has once.
 */
export function useSettingsGroups(): SettingsGroup[] {
  const { details, state, identity, tvPresentation } = useSessionGate();
  const { device, couch, administrator } = useSettingsScope();
  const otherApps = state?.devices?.some(
    (device) => device.updates && device.id !== identity?.device?.id,
  );
  const visible = (id: SettingsPage) =>
    !id.startsWith("source-") &&
    // Sound outputs and Bluetooth exist only where Couch controls the system's sound (Linux).
    (id !== "sound" || !!details?.systemAudio) &&
    (id !== "display" ||
      !!(details?.tvPresentation || details?.tvModeChangeable || details?.tvAppliance)) &&
    // An admin's Updates holds this app's own updater too, so it shows when any app can update.
    (id !== "device-updates" || updatesPage(administrator) === id) &&
    (id !== "updates" ||
      (updatesPage(administrator) === id &&
        (!!couchApp?.updates || !!details?.updates || !!otherApps)));
  const pages = (owner: "device" | "couch") =>
    (Object.keys(settingsPages) as SettingsPage[])
      .filter((id) => visible(id) && settingsPages[id].owner === owner)
      .map((id) => ({ id, locked: !administrator && adminOnly.includes(id) }));
  return [
    {
      owner: "device",
      title: device,
      subtitle: tvPresentation ? "This TV" : "This device",
      pages: pages("device"),
    },
    { owner: "couch", title: couch, subtitle: "For everyone", pages: pages("couch") },
  ];
}
