import { execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { promisify } from "node:util";
import type { AudioCaptureFormat, LiveAudioAction, NativeAudioInput } from "../src/shared/capture";
import { prepareNativeCapture } from "./native-capture";

export async function nativeAudioInputs(executable?: string): Promise<NativeAudioInput[]> {
  if (!executable || !existsSync(executable)) return [];
  const { stdout } = await promisify(execFile)(executable, ["--list"], { timeout: 5000, maxBuffer: 65_536 });
  const inputs = JSON.parse(stdout) as NativeAudioInput[];
  if (!Array.isArray(inputs) || inputs.length > 128 || inputs.some(input => !input || typeof input.uid !== "string" || !input.uid || input.uid.length > 512 ||
    typeof input.name !== "string" || !input.name || input.name.length > 1024 || !Number.isInteger(input.channels) || input.channels < 2 ||
    ![44100, 48000].includes(input.nominalRate) || !Number.isInteger(input.ownerHalBufferFrames) || input.ownerHalBufferFrames < 1) ||
    new Set(inputs.map(input => input.uid)).size !== inputs.length) throw new Error("The native input list was invalid.");
  return inputs;
}

/** One already-authorized publication. Each upload gets a fresh sample generation. */
export function nativeAudioInput(executable: string, input: NativeAudioInput,
  sampleRate: 44100 | 48000, bufferFrames: 128 | 256 | 512 | 1024,
  failed: (message: string, uploadId?: string) => void, signal: AbortSignal, setDeviceRate = false) {
  type Producer = Awaited<ReturnType<typeof prepareNativeCapture>>;
  const lifetime = new AbortController();
  const canceled = AbortSignal.any([signal, lifetime.signal]);
  let producer: Producer | undefined, opening: Promise<Producer> | undefined, uploadId: string | undefined, uploadUrl: string | undefined;
  let muted = false, stopped = false, serial: Promise<unknown> = Promise.resolve();
  const formatOf = (next: Producer): AudioCaptureFormat => ({ sampleRate: next.format.sampleRate, channels: 2,
    native: { requestedFrames: bufferFrames, reportedFrames: next.format.ownerHalBufferFrames, inputLatencyMs: next.format.reportedInputLatencyMs } });
  const prepare = async (): Promise<AudioCaptureFormat> => {
    if (stopped || signal.aborted) throw new Error("Audio capture was canceled.");
    const child = spawn(executable, [input.name, input.uid, String(sampleRate), String(bufferFrames), "0", ...(setDeviceRate ? ["--set-rate"] : [])], { stdio: ["pipe", "pipe", "pipe"] });
    const pending = opening = prepareNativeCapture(child, { sampleRate, requestedCallbackFrames: bufferFrames }, error => {
      if (!stopped && !signal.aborted) failed(error.message, uploadId);
    }, event => { if (event.event === "end" || event.event === "ready") console.info("Native audio capture", event); }, canceled);
    try {
      const next = await pending;
      if (stopped || signal.aborted) { await next.stop(); throw new Error("Audio capture was canceled."); }
      producer = next; next.setMuted(muted);
      return formatOf(next);
    } finally { if (opening === pending) opening = undefined; }
  };
  const stopUpload = async () => {
    uploadId = uploadUrl = undefined;
    const old = producer; producer = undefined;
    await old?.stop();
  };
  return {
    prepare,
    async stop() {
      stopped = true;
      lifetime.abort();
      const pending = opening;
      await stopUpload();
      if (pending) await pending.then(value => value.stop(), () => {});
    },
    command(action: LiveAudioAction): Promise<AudioCaptureFormat | undefined> {
      const next = serial.then(async () => {
        if (stopped || signal.aborted) throw new Error("Audio capture was canceled.");
        if (action.op === "upload") {
          if (uploadId) throw new Error("This native input already has an upload.");
          if (!producer) await prepare();
          uploadId = action.uploadId; uploadUrl = action.url;
          try { await producer!.upload(action.url); }
          catch (error) { await stopUpload(); throw error; }
          return formatOf(producer!);
        } else if (action.op === "buffer") {
          // The helper opens its stream with one buffer size: a new size is a new helper, and a new generation for listeners.
          const resume = uploadId, url = uploadUrl, old = producer;
          producer = undefined; bufferFrames = action.bufferFrames;
          await old?.stop();
          const format = await prepare();
          if (resume && url && uploadId === resume) {
            try { await producer!.upload(url); }
            catch (error) { await stopUpload(); throw error; }
            return formatOf(producer!);
          }
          return format;
        } else if (action.op === "stop-upload" && uploadId === action.uploadId) await stopUpload();
        else if (action.op === "mute") { muted = action.muted; producer?.setMuted(muted); }
        return undefined;
      });
      serial = next.catch(() => {});
      return next;
    },
  };
}
