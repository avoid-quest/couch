import { loadSendspinClientIdentity, type SendspinStorage } from "@sendspin/sendspin-js";
import { useSyncExternalStore } from "react";
import type { SessionState } from "../../shared/protocol";
import { normalizeDeviceName } from "../../shared/devices";
import { couchApp } from "./native-context";
import { fromSavedCouch } from "./connection";
import * as toasts from "../toasts";
import { defaultDeviceSharing, isDeviceSharing, type DeviceSharing } from "../../shared/device-sharing";
import { playingOn } from "./where-it-plays";

let id: string | undefined;
// This device's one name, reused with every Couch: the Couch app's installation name, or this browser's storage.
const nameKey = "couch.device-name";
const changed = "couch-device-identity";
// Full or blocked storage keeps values for this tab, so saving and pairing still work.
const memory = new Map<string, string>();
const read = (key: string) => { if (memory.has(key)) return memory.get(key)!; try { return localStorage.getItem(key); } catch { return null; } };
const write = (key: string, value: string) => { try { localStorage.setItem(key, value); memory.delete(key); } catch { memory.set(key, value); } };
const validName = (value: unknown) => { try { return normalizeDeviceName(value); } catch { return null; } };
let name = couchApp?.deviceName ? null : validName(read(nameKey));
// A deliberate browser switch carries only the public name, never the Sendspin key, and only a saved Couch may rename this browser.
if (!couchApp && typeof location !== "undefined" && new URLSearchParams(location.hash.slice(1)).has("device-name")) {
  const fragment = new URLSearchParams(location.hash.slice(1));
  const carried = fromSavedCouch && validName(fragment.get("device-name"));
  if (carried) { name = carried; write(nameKey, carried); }
  fragment.delete("device-name");
  history.replaceState(history.state, "", location.pathname + location.search + (fragment.size ? `#${fragment}` : ""));
}
export const deviceNameHash = () => name ? `#device-name=${encodeURIComponent(name)}` : "";
// What this device shares, like its name: the Couch app's own choice, or this browser's storage.
const sharingKey = "couch.device-sharing";
const readSharing = (): DeviceSharing => {
  try { const value: unknown = JSON.parse(read(sharingKey) ?? "null"); return isDeviceSharing(value) ? value : defaultDeviceSharing; }
  catch { return defaultDeviceSharing; }
};
let sharing = couchApp?.deviceSharing ? defaultDeviceSharing : readSharing();

/** The SDK and Couch use the same storage, including when browser storage is unavailable. */
export const storage: SendspinStorage = { getItem: read, setItem: write };

const announce = (next: string | null) => { if (next !== name) { name = next; window.dispatchEvent(new Event(changed)); } };
/** Reads the Couch app's name; older apps without the bridge keep browser storage. */
export async function loadLocalDeviceName() {
  if (couchApp?.deviceName) announce(await couchApp.deviceName());
}

export const localDeviceName = () => name;

export async function saveLocalDeviceName(value: string) {
  const next = normalizeDeviceName(value);
  if (couchApp?.deviceName) await couchApp.deviceName(next);
  else write(nameKey, next);
  announce(next);
  return next;
}

const announceSharing = (next: DeviceSharing) => { if (next.audio !== sharing.audio || next.video !== sharing.video) { sharing = next; window.dispatchEvent(new Event(changed)); } };
/** Reads the Couch app's choice; older apps without the bridge keep browser storage. */
export async function loadLocalDeviceSharing() {
  if (couchApp?.deviceSharing) announceSharing(await couchApp.deviceSharing());
}

export const localDeviceSharing = () => sharing;
export async function saveLocalDeviceSharing(value: DeviceSharing) {
  if (!isDeviceSharing(value)) throw new Error("Choose which outputs to share.");
  if (couchApp?.deviceSharing) await couchApp.deviceSharing(value);
  else write(sharingKey, JSON.stringify(value));
  announceSharing(value);
}

export const subscribeDeviceIdentity = (listener: () => void) => {
  const update = (event: StorageEvent) => {
    const named = !couchApp?.deviceName && (event.key === nameKey || event.key === null), shared = !couchApp?.deviceSharing && (event.key === sharingKey || event.key === null);
    if (!named && !shared) return;
    if (event.key === null) memory.clear(); else memory.delete(event.key);
    if (named) name = validName(read(nameKey));
    if (shared) sharing = readSharing();
    listener();
  };
  window.addEventListener("storage", update);
  window.addEventListener(changed, listener);
  return () => { window.removeEventListener("storage", update); window.removeEventListener(changed, listener); };
};
export const useLocalDeviceName = () => useSyncExternalStore(subscribeDeviceIdentity, localDeviceName, () => null);
export const useLocalDeviceSharing = () => useSyncExternalStore(subscribeDeviceIdentity, localDeviceSharing, () => defaultDeviceSharing);

/**
 * This Device's one ID: the X25519 key the Sendspin JS SDK stores for this
 * origin, which is also its Sendspin client_id. Tabs on one origin share it.
 * The SDK generates it with @noble/curves, so plain-HTTP LAN pages have it too.
 */
export function deviceId() {
  if (id) return id;
  id = loadSendspinClientIdentity(storage).clientId;
  return id;
}

type Outputs = Pick<SessionState, "outputs" | "devices" | "controlling"> & { player: Pick<SessionState["player"], "status"> } | null | undefined;
/**
 * Where the controlled Playback plays: the Device to name (the controlled one while it serves it, else
 * the one showing the picture, else the first), how many more, and whether that is only this Device.
 */
export function playsOn(state: Outputs) {
  const outputs = state?.outputs ?? [];
  const ids = [...new Set(outputs.map(output => output.deviceId))];
  if (!ids.length) return null;
  const controlled = state!.controlling ?? deviceId();
  const id = ids.includes(controlled) ? controlled : (outputs.find(output => output.picture) ?? outputs[0]!).deviceId;
  const name = state!.devices?.find(device => device.id === id)?.name ?? "another device";
  const active = ["loading", "playing", "paused", "ended"].includes(state!.player.status);
  return { deviceId: id, name, more: ids.length - 1, elsewhere: active && !(ids.length === 1 && ids[0] === deviceId()) };
}

/** Whether this Device shows the looked-at Playback's picture. */
export const showsPicture = (state: Outputs) => !!state?.outputs?.some(output => output.deviceId === deviceId() && output.picture);

/**
 * One "Playing on {name}" toast when a play this window started lands on another Device: its
 * picture and sound are elsewhere. Its kind keeps it one toast when both the command and Play on announce it.
 */
export function announcePlay(state: Pick<SessionState, "devices" | "controlling"> | null | undefined, target = state?.controlling) {
  const name = playingOn(state, target, deviceId());
  if (name) toasts.playingOn(name);
}
