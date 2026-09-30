import type { PlayerState } from "./protocol";

export type ConnectionDetails = {
  lanError?: string | null; name: string; installationId?: string; urls: string[]; player: PlayerState["status"]; remoteControlEnabled?: boolean; tvPresentation?: boolean;
  /** Couch controls this computer's sound outputs and Bluetooth (Linux, #644 ticket 3). */
  systemAudio?: boolean;
  /** Main can update this Couch through an authenticated administrator request. */
  updates?: boolean };

/**
 * A connected client with its screen and speakers (#644). Its id is the X25519
 * public key the Sendspin JS SDK stores for the client's origin, which is also
 * its Sendspin client_id. "host" is the app window that runs this Couch; its
 * name is this Couch's name.
 */
export type Device = {
  id: string;
  name: string;
  role: "host" | "controller" | "administrator";
  createdAt: number | null;
  lastSeenAt: number | null;
};

export type DeviceIdentity = {
  device: Device | null;
  authority: "host" | "administrator" | "controller";
  claimAvailable: boolean;
};

/** A Sendspin client_id: a base64url X25519 public key. */
export const isDeviceId = (value: unknown): value is string => typeof value === "string" && /^[\w-]{43}$/.test(value);

const adjectives = ["Amber", "Blue", "Brave", "Bright", "Calm", "Coral", "Cosy", "Golden", "Green", "Happy", "Jolly", "Lucky", "Mellow", "Misty", "Quiet", "Rosy", "Silver", "Sleepy", "Snowy", "Sunny", "Swift", "Velvet", "Warm", "Wild"];
const animals = ["Badger", "Bear", "Beaver", "Crane", "Deer", "Dolphin", "Eagle", "Falcon", "Fox", "Hare", "Heron", "Koala", "Lynx", "Moose", "Otter", "Owl", "Panda", "Puffin", "Raven", "Robin", "Seal", "Swan", "Tiger", "Wolf"];

/** The name a Device gets when its user skips naming it: random, since its key is. */
export function defaultDeviceName(id: string) {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return `${adjectives[hash % adjectives.length]} ${animals[Math.floor(hash / adjectives.length) % animals.length]}`;
}
