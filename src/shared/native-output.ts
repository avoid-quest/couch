/** Live audio only. Credentials remain in the owning desktop process, never the PCM helper. */
export type NativeOutputStart = {
  op: "start"; receiverId: string; clientId: string; privateKey: string; name: string; bufferMs: number;
};
export type NativeOutputAction = NativeOutputStart | { op: "stop"; receiverId: string };
export type NativeOutputError = { receiverId: string; error: string };

export const nativeOutputBufferOptions = ["20", "30", "40", "60", "100"] as const;
export type NativeOutputBuffer = typeof nativeOutputBufferOptions[number];
export const isNativeOutputBuffer = (value: unknown): value is NativeOutputBuffer =>
  typeof value === "string" && nativeOutputBufferOptions.includes(value as NativeOutputBuffer);
export type LiveOutputBackend = "browser" | "native";
export const isLiveOutputBackend = (value: unknown): value is LiveOutputBackend => value === "browser" || value === "native";
