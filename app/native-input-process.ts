import { spawn } from "node:child_process";
import type {
  AudioCaptureFormat,
  LiveAudioAction,
  NativeAudioInput,
  NativeBufferFrames,
  NativeChannelMap,
} from "../src/shared/capture";
import { isNativeChannelMap } from "../src/shared/audio-settings";
import { prepareNativeCapture } from "./native-capture";

/** One already-authorized publication. Each upload gets a fresh sample generation. */
export function readNativeInput(
  executable: string,
  input: NativeAudioInput,
  sampleRate: 44100 | 48000,
  bufferFrames: NativeBufferFrames,
  failed: (message: string, uploadId?: string) => void,
  signal: AbortSignal,
  setDeviceRate = false,
  channelMap: NativeChannelMap = [0, 1],
) {
  type Producer = Awaited<ReturnType<typeof prepareNativeCapture>>;
  const lifetime = new AbortController();
  const canceled = AbortSignal.any([signal, lifetime.signal]);
  let producer: Producer | undefined,
    opening: Promise<Producer> | undefined,
    uploadId: string | undefined,
    uploadUrl: string | undefined;
  let muted = false,
    stopped = false,
    serial: Promise<unknown> = Promise.resolve();
  const formatOf = (next: Producer): AudioCaptureFormat => ({
    sampleRate: next.format.sampleRate,
    channels: next.format.channels,
    native: {
      requestedFrames: bufferFrames,
      reportedFrames: next.format.ownerHalBufferFrames,
      inputLatencyMs: next.format.reportedInputLatencyMs,
      inputChannels: input.channels,
      channelMap: next.format.channelMap,
    },
  });
  const prepare = async (): Promise<AudioCaptureFormat> => {
    if (stopped || signal.aborted) throw new Error("Audio capture was canceled.");
    if (!isNativeChannelMap(channelMap, input.channels))
      throw new Error("Choose an available channel or stereo pair for this native input.");
    const child = spawn(
      executable,
      [
        input.name,
        input.uid,
        String(sampleRate),
        String(bufferFrames),
        "0",
        "--channels",
        channelMap.map((channel) => channel + 1).join(","),
        ...(setDeviceRate ? ["--set-rate"] : []),
      ],
      { stdio: ["pipe", "pipe", "pipe"] },
    );
    const pending = (opening = prepareNativeCapture(
      child,
      { sampleRate, requestedCallbackFrames: bufferFrames, channelMap },
      (error) => {
        if (!stopped && !signal.aborted) failed(error.message, uploadId);
      },
      (event) => {
        if (event.event === "end" || event.event === "ready")
          console.info("Native audio capture", event);
      },
      canceled,
    ));
    try {
      const next = await pending;
      if (stopped || signal.aborted) {
        await next.stop();
        throw new Error("Audio capture was canceled.");
      }
      producer = next;
      next.setMuted(muted);
      return formatOf(next);
    } finally {
      if (opening === pending) opening = undefined;
    }
  };
  const stopUpload = async () => {
    uploadId = uploadUrl = undefined;
    const old = producer;
    producer = undefined;
    await old?.stop();
  };
  return {
    prepare,
    async stop() {
      stopped = true;
      lifetime.abort();
      const pending = opening;
      await stopUpload();
      if (pending)
        await pending.then(
          (value) => value.stop(),
          () => {},
        );
    },
    command(action: LiveAudioAction): Promise<AudioCaptureFormat | undefined> {
      const next = serial.then(async () => {
        if (stopped || signal.aborted) throw new Error("Audio capture was canceled.");
        if (action.op === "upload") {
          if (uploadId) throw new Error("This native input already has an upload.");
          if (!producer) await prepare();
          uploadId = action.uploadId;
          uploadUrl = action.url;
          try {
            await producer!.upload(action.url);
          } catch (error) {
            await stopUpload();
            throw error;
          }
          return formatOf(producer!);
        } else if (action.op === "buffer" || action.op === "channels") {
          if (action.op === "channels" && !isNativeChannelMap(action.channelMap, input.channels))
            throw new Error("Choose an available channel or stereo pair for this native input.");
          // Stream settings belong to one helper; replacing it starts a new sample generation.
          const resume = uploadId,
            url = uploadUrl,
            old = producer;
          producer = undefined;
          if (action.op === "buffer") bufferFrames = action.bufferFrames;
          else channelMap = [...action.channelMap];
          await old?.stop();
          const format = await prepare();
          if (resume && url && uploadId === resume) {
            try {
              await producer!.upload(url);
            } catch (error) {
              await stopUpload();
              throw error;
            }
            return formatOf(producer!);
          }
          return format;
        } else if (action.op === "stop-upload" && uploadId === action.uploadId) await stopUpload();
        else if (action.op === "mute") {
          muted = action.muted;
          producer?.setMuted(muted);
        }
        return undefined;
      });
      serial = next.catch(() => {});
      return next;
    },
  };
}

type ReaderOptions = Parameters<typeof readNativeInput>;
type ReaderCall =
  | { type: "prepare" }
  | { type: "stop" }
  | { type: "command"; action: LiveAudioAction };
export type ReaderRequest =
  | {
      type: "open";
      executable: ReaderOptions[0];
      input: ReaderOptions[1];
      sampleRate: ReaderOptions[2];
      bufferFrames: ReaderOptions[3];
      setDeviceRate: boolean;
      channelMap?: NativeChannelMap;
    }
  | { type: "abort" }
  | (ReaderCall & { request: number });
export type ReaderReply =
  | { type: "failed"; message: string; uploadId?: string }
  | { type: "reply"; request: number; value?: AudioCaptureFormat; error?: string };

// In the app, Main forks this file (build/native-input.mjs) and drives it over its
// parent port, so the input's sound reaches Core without waiting on Main's event loop.
type ParentPort = {
  postMessage(message: ReaderReply): void;
  on(event: "message", listener: (event: { data: ReaderRequest }) => void): void;
};
const parent = (process as NodeJS.Process & { parentPort?: ParentPort }).parentPort;
if (parent) {
  const aborted = new AbortController();
  let reader: ReturnType<typeof readNativeInput> | undefined;
  parent.on("message", ({ data }) => {
    if (data.type === "open") {
      reader = readNativeInput(
        data.executable,
        data.input,
        data.sampleRate,
        data.bufferFrames,
        (message, uploadId) =>
          parent.postMessage({ type: "failed", message, ...(uploadId ? { uploadId } : {}) }),
        aborted.signal,
        data.setDeviceRate,
        data.channelMap,
      );
      return;
    }
    if (data.type === "abort") {
      aborted.abort();
      return;
    }
    const run =
      data.type === "prepare"
        ? reader!.prepare()
        : data.type === "stop"
          ? reader!.stop()
          : reader!.command(data.action);
    run.then(
      (value) =>
        parent.postMessage({ type: "reply", request: data.request, ...(value ? { value } : {}) }),
      (error: unknown) =>
        parent.postMessage({
          type: "reply",
          request: data.request,
          error: error instanceof Error ? error.message : String(error),
        }),
    );
  });
}
