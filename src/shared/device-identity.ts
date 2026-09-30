/** A device's own name, independent of the servers it joins. */
export function normalizeDeviceName(value: unknown): string {
  if (typeof value !== "string" || /\p{Cc}/u.test(value)) throw new Error("Use a name with 1 to 60 characters.");
  const name = value.trim().normalize("NFC");
  if (!name || [...name].length > 60) throw new Error("Use a name with 1 to 60 characters.");
  return name;
}

export type DeviceSharing = { audio: boolean; video: boolean; administration: boolean };
export const defaultDeviceSharing: DeviceSharing = { audio: false, video: false, administration: false };
export const isDeviceSharing = (value: unknown): value is DeviceSharing => !!value && typeof value === "object"
  && ["audio", "video", "administration"].every(key => typeof (value as Record<string, unknown>)[key] === "boolean");
export type LocalDeviceIdentity = { key: string; name: string | null; sharing: DeviceSharing };
export type DeviceIdentityUpdate = { key?: string; name?: string; sharing?: DeviceSharing };
