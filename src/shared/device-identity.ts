/** What a client lets other devices use; all off until it opts in. */
export type DeviceSharing = { audio: boolean; video: boolean; administration: boolean };
export const defaultDeviceSharing: DeviceSharing = { audio: false, video: false, administration: false };
export const isDeviceSharing = (value: unknown): value is DeviceSharing => !!value && typeof value === "object"
  && ["audio", "video", "administration"].every(key => typeof (value as Record<string, unknown>)[key] === "boolean");
