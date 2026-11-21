import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { utilityProcess } from "electron";
import type {
  AudioCaptureFormat,
  LiveAudioAction,
  NativeAudioInput,
  NativeBufferFrames,
  NativeChannelMap,
} from "../src/shared/capture";
import type { ReaderReply, ReaderRequest } from "./native-input-process";

export async function nativeAudioInputs(executable?: string): Promise<NativeAudioInput[]> {
  if (!executable || !existsSync(executable)) return [];
  const { stdout } = await promisify(execFile)(executable, ["--list"], {
    timeout: 5000,
    maxBuffer: 65_536,
  });
  const inputs = JSON.parse(stdout) as NativeAudioInput[];
  if (
    !Array.isArray(inputs) ||
    inputs.length > 128 ||
    inputs.some(
      (input) =>
        !input ||
        typeof input.uid !== "string" ||
        !input.uid ||
        input.uid.length > 512 ||
        typeof input.name !== "string" ||
        !input.name ||
        input.name.length > 1024 ||
        !Number.isInteger(input.channels) ||
        input.channels < 2 ||
        ![44100, 48000].includes(input.nominalRate) ||
        !Number.isInteger(input.ownerHalBufferFrames) ||
        input.ownerHalBufferFrames < 1,
    ) ||
    new Set(inputs.map((input) => input.uid)).size !== inputs.length
  )
    throw new Error("The native input list was invalid.");
  return inputs;
}

/** One already-authorized publication, read in its own utility process
 * (app/native-input-process.ts) so nothing that blocks Main stops its sound.
 */
export function nativeAudioInput(
  executable: string,
  input: NativeAudioInput,
  sampleRate: 44100 | 48000,
  bufferFrames: NativeBufferFrames,
  failed: (message: string, uploadId?: string) => void,
  signal: AbortSignal,
  setDeviceRate = false,
  channelMap?: NativeChannelMap,
) {
  const child = utilityProcess.fork(join(import.meta.dirname, "native-input.mjs"), [], {
    serviceName: "Couch audio input",
    stdio: "pipe",
  });
  child.stdout?.pipe(process.stdout, { end: false });
  child.stderr?.pipe(process.stderr, { end: false });
  const post = (message: ReaderRequest) => child.postMessage(message);
  const waiting = new Map<
    number,
    { resolve(value?: AudioCaptureFormat): void; reject(error: Error): void }
  >();
  let nextRequest = 0,
    exited = false,
    stopping = false;
  const exit = new Promise<void>((resolve) =>
    child.once("exit", () => {
      exited = true;
      for (const entry of waiting.values()) entry.reject(new Error("The audio input stopped."));
      waiting.clear();
      if (!stopping && !signal.aborted) failed("The audio input stopped.");
      resolve();
    }),
  );
  child.on("message", (message: ReaderReply) => {
    if (message.type === "failed") {
      if (!stopping && !signal.aborted) failed(message.message, message.uploadId);
      return;
    }
    const entry = waiting.get(message.request);
    if (!entry) return;
    waiting.delete(message.request);
    if (message.error === undefined) entry.resolve(message.value);
    else entry.reject(new Error(message.error));
  });
  const request = (
    call: { type: "prepare" } | { type: "stop" } | { type: "command"; action: LiveAudioAction },
  ) =>
    new Promise<AudioCaptureFormat | undefined>((resolve, reject) => {
      if (exited) return reject(new Error("The audio input stopped."));
      const id = nextRequest++;
      waiting.set(id, { resolve, reject });
      post({ ...call, request: id });
    });
  post({ type: "open", executable, input, sampleRate, bufferFrames, setDeviceRate, channelMap });
  signal.addEventListener(
    "abort",
    () => {
      if (!exited) post({ type: "abort" });
    },
    { once: true },
  );
  return {
    prepare: () => request({ type: "prepare" }),
    async stop() {
      stopping = true;
      // The reader stops its helper within 4 s (SIGTERM after 2 s, SIGKILL 2 s later); one that
      // doesn't answer by then is killed with it, so a stuck reader can't hold the next share.
      if (!exited)
        await Promise.race([
          request({ type: "stop" }).catch(() => {}),
          new Promise((resolve) => setTimeout(resolve, 5000)),
        ]);
      child.kill();
      await exit;
    },
    command: (action: LiveAudioAction) => request({ type: "command", action }),
  };
}
