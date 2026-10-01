import { loadSendspinClientIdentity, type SendspinStorage } from "@sendspin/sendspin-js";
import { useSyncExternalStore } from "react";
import { toast } from "sonner";
import type { SessionState } from "../../shared/protocol";
import { normalizeDeviceName } from "../../shared/devices";
import { couchApp } from "./native-context";

let id: string | undefined;
// This device's one name, reused with every Couch: the Couch app's installation name, or this browser's storage.
const nameKey = "couch.device-name";
const changed = "couch-device-name";
// Full or blocked storage keeps values for this tab, so saving and pairing still work.
const memory = new Map<string, string>();
const read = (key: string) => { if (memory.has(key)) return memory.get(key)!; try { return localStorage.getItem(key); } catch { return null; } };
const write = (key: string, value: string) => { try { localStorage.setItem(key, value); memory.delete(key); } catch { memory.set(key, value); } };
const validName = (value: unknown) => { try { return normalizeDeviceName(value); } catch { return null; } };
let name = couchApp?.deviceName ? null : validName(read(nameKey));

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

export const subscribeDeviceName = (listener: () => void) => {
  const update = (event: StorageEvent) => {
    if (couchApp?.deviceName || event.key !== nameKey && event.key !== null) return;
    if (event.key === null) memory.clear(); else memory.delete(event.key);
    name = validName(read(nameKey));
    listener();
  };
  window.addEventListener("storage", update);
  window.addEventListener(changed, listener);
  return () => { window.removeEventListener("storage", update); window.removeEventListener(changed, listener); };
};
export const useLocalDeviceName = () => useSyncExternalStore(subscribeDeviceName, localDeviceName, () => null);

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
 * picture and sound are elsewhere. A fixed id keeps a play announced twice (control, then play) one toast.
 */
export function announcePlay(state: Pick<SessionState, "devices" | "controlling"> | null | undefined, target = state?.controlling) {
  const name = target && target !== deviceId() && state?.devices?.find(device => device.id === target)?.name;
  if (name) toast(`Playing on ${name}`, { id: "playing-on" });
}
