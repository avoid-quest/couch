/** Which of its outputs a client lets other devices use; both off until it opts in. */
export type DeviceSharing = { audio: boolean; video: boolean };
export const defaultDeviceSharing: DeviceSharing = { audio: false, video: false };
export const isDeviceSharing = (value: unknown): value is DeviceSharing => !!value && typeof value === "object" && !Array.isArray(value)
  && Object.keys(value).sort().join() === "audio,video" && typeof (value as DeviceSharing).audio === "boolean" && typeof (value as DeviceSharing).video === "boolean";
