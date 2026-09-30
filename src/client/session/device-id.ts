import { loadSendspinClientIdentity, type SendspinStorage } from "@sendspin/sendspin-js";
import { useSyncExternalStore } from "react";
import { toast } from "sonner";
import type { SessionState } from "../../shared/protocol";
import { defaultDeviceSharing, isDeviceSharing, normalizeDeviceName, type DeviceSharing, type LocalDeviceIdentity } from "../../shared/device-identity";
import { couchApp } from "./native-context";

let id: string | undefined;
let nativeIdentity: LocalDeviceIdentity | null = null;
const nameKey = "couch.device-name";
const sharingKey = "couch.device-sharing";
const changed = "couch-device-identity";
const memory = new Map<string, string>();
const read = (key: string) => { if (memory.has(key)) return memory.get(key)!; try { return localStorage.getItem(key); } catch { return null; } };
const write = (key: string, value: string) => { try { localStorage.setItem(key, value); memory.delete(key); } catch { memory.set(key, value); } };
const validName = (value: unknown) => { try { return normalizeDeviceName(value); } catch { return null; } };
let name = validName(read(nameKey));
const readSharing = (): DeviceSharing => {
  try { const value: unknown = JSON.parse(read(sharingKey) ?? "null"); return isDeviceSharing(value) ? value : defaultDeviceSharing; }
  catch { return defaultDeviceSharing; }
};
let sharing = readSharing();

// Deliberate browser switches carry only the public name, never the Sendspin key.
if (!couchApp && typeof location !== "undefined" && new URLSearchParams(location.hash.slice(1)).has("device-name")) {
  const fragment = new URLSearchParams(location.hash.slice(1));
  const carried = validName(fragment.get("device-name"));
  if (carried) { name = carried; write(nameKey, carried); }
  fragment.delete("device-name");
  history.replaceState(history.state, "", location.pathname + location.search + (fragment.size ? `#${fragment}` : ""));
}

const storage: SendspinStorage = {
  getItem: key => key === "sendspin-identity-sk" && nativeIdentity ? nativeIdentity.key : read(key),
  setItem: (key, value) => { if (key !== "sendspin-identity-sk" || !nativeIdentity) write(key, value); },
};
/** The SDK and Couch use the same storage, including when browser storage is blocked. */
export const deviceStorage = () => storage;

export async function initializeDeviceIdentity() {
  if (!couchApp?.deviceIdentity) return;
  const previousName = name, previousSharing = sharing;
  const key = read("sendspin-identity-sk");
  nativeIdentity = await couchApp.deviceIdentity(key && /^[\w-]{43}$/.test(key) ? { key } : {});
  if (!nativeIdentity.name && name) nativeIdentity = await couchApp.deviceIdentity({ name });
  name = nativeIdentity.name;
  sharing = nativeIdentity.sharing;
  id = undefined;
  if (name !== previousName || JSON.stringify(sharing) !== JSON.stringify(previousSharing)) window.dispatchEvent(new Event(changed));
}

export const localDeviceName = () => name;
export const localDeviceSharing = () => sharing;
export const deviceNameHash = () => name ? `#device-name=${encodeURIComponent(name)}` : "";

export async function saveLocalDeviceName(value: string) {
  const next = normalizeDeviceName(value);
  if (couchApp?.deviceIdentity) nativeIdentity = await couchApp.deviceIdentity({ name: next });
  name = next;
  write(nameKey, next);
  window.dispatchEvent(new Event(changed));
  return next;
}

export async function saveLocalDeviceSharing(value: DeviceSharing) {
  if (!isDeviceSharing(value)) throw new Error("Choose which features to share.");
  if (couchApp?.deviceIdentity) nativeIdentity = await couchApp.deviceIdentity({ sharing: value });
  sharing = value;
  write(sharingKey, JSON.stringify(value));
  window.dispatchEvent(new Event(changed));
}

export const subscribeDeviceIdentity = (listener: () => void) => {
  const update = (event: StorageEvent) => {
    if (event.key === null) memory.clear(); else memory.delete(event.key);
    if (event.key === nameKey || event.key === null) name = validName(read(nameKey));
    if (event.key === sharingKey || event.key === null) sharing = readSharing();
    if ([nameKey, sharingKey, null].includes(event.key)) listener();
  };
  window.addEventListener("storage", update);
  window.addEventListener(changed, listener);
  return () => { window.removeEventListener("storage", update); window.removeEventListener(changed, listener); };
};
export const useLocalDeviceName = () => useSyncExternalStore(subscribeDeviceIdentity, localDeviceName, () => null);
export const useLocalDeviceSharing = () => useSyncExternalStore(subscribeDeviceIdentity, localDeviceSharing, () => defaultDeviceSharing);

/**
 * This Device's one ID: the X25519 key the Sendspin JS SDK stores for this
 * origin (or this native app), which is also its Sendspin client_id.
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
 * picture and sound are elsewhere. A fixed id keeps a play announced twice (control, then play) one toast.
 */
export function announcePlay(state: Pick<SessionState, "devices" | "controlling"> | null | undefined, target = state?.controlling) {
  const name = target && target !== deviceId() && state?.devices?.find(device => device.id === target)?.name;
  if (name) toast(`Playing on ${name}`, { id: "playing-on" });
}
