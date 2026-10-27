import type { PlayerState } from "./protocol";

export type ConnectionDetails = {
  lanError?: string | null; name: string; installationId?: string; urls: string[]; player: PlayerState["status"]; remoteControlEnabled?: boolean; tvPresentation?: boolean; tvAppliance?: boolean;
  /** An admin can switch TV mode: the Couch app hosts it and no TV launcher locks it. */
  tvModeChangeable?: boolean;
  /** Couch controls this computer's sound outputs and Bluetooth (Linux, #644 ticket 3). */
  systemAudio?: boolean;
  /** Main can update this Couch through an authenticated administrator request. */
  updates?: boolean };

/**
 * A connected client with its screen and speakers (#644). Its stable opaque id is also its Sendspin client_id. "host" is the app window that runs this Couch; its
 * name is this Couch's name.
 */
export type Device = {
  id: string;
  name: string;
  role: "host" | "controller" | "administrator";
  createdAt: number | null;
  lastSeenAt: number | null;
};

/** Offline devices that share a name with another seen since, or online: the same screen paired again, left behind. */
export function staleDuplicates(devices: Device[], online: ReadonlySet<string>, selfId?: string) {
  const name = (device: Device) => device.name.trim().toLowerCase();
  const paired = devices.filter(device => device.role !== "host");
  return paired.filter(device => device.id !== selfId && !online.has(device.id)
    && paired.some(other => other !== device && name(other) === name(device) && (online.has(other.id) || (other.lastSeenAt ?? 0) > (device.lastSeenAt ?? 0))));
}

export type DeviceIdentity = {
  device: Device | null;
  authority: "host" | "administrator" | "controller";
  claimAvailable: boolean;
};

/** A stable opaque device ID, encoded as 32 base64url bytes. */
export const isDeviceId = (value: unknown): value is string => typeof value === "string" && /^[\w-]{43}$/.test(value);

const adjectives = ["Amber", "Blue", "Brave", "Bright", "Calm", "Coral", "Cosy", "Golden", "Green", "Happy", "Jolly", "Lucky", "Mellow", "Misty", "Quiet", "Rosy", "Silver", "Sleepy", "Snowy", "Sunny", "Swift", "Velvet", "Warm", "Wild"];
const animals = ["Badger", "Bear", "Beaver", "Crane", "Deer", "Dolphin", "Eagle", "Falcon", "Fox", "Hare", "Heron", "Koala", "Lynx", "Moose", "Otter", "Owl", "Panda", "Puffin", "Raven", "Robin", "Seal", "Swan", "Tiger", "Wolf"];

/** The name a Device gets when its user skips naming it: random, since its ID is. */
export function defaultDeviceName(id: string) {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return `${adjectives[hash % adjectives.length]} ${animals[Math.floor(hash / adjectives.length) % animals.length]}`;
}

/** A device's one name, which every Couch it joins shows. */
export function normalizeDeviceName(value: unknown): string {
  if (typeof value !== "string" || /\p{Cc}/u.test(value)) throw new Error("Use a name with 1 to 60 characters.");
  const name = value.trim().normalize("NFC");
  if (!name || [...name].length > 60) throw new Error("Use a name with 1 to 60 characters.");
  return name;
}

/** The name Core gives a Couch nobody named; it counts as unnamed. */
export const UNNAMED_COUCH = "Couch";
