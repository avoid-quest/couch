import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import WebSocket from "ws";
import type { NativeChannelMap } from "../src/shared/capture";

// capture-queue.h's CaptureError codes, in the words a sharer sees. The log keeps the helper's raw event.
const captureErrors: Record<number, string> = {
  1: "The audio input dropped samples.",
  2: "The audio input stopped delivering sound.",
  3: "The audio input changed its format or device.",
  4: "The audio input's clock jumped.",
  5: "Couch fell behind reading the audio input.",
  6: "The audio input delivered invalid samples.",
};

export type NativeCaptureFormat = {
  sampleRate: 44100 | 48000;
  channels: 1 | 2;
  channelMap: NativeChannelMap;
  requestedCallbackFrames: import("../src/shared/capture").NativeBufferFrames;
  ownerHalBufferFrames: number;
  nominalRate: number;
  reportedInputLatencyMs: number;
};

/** Capture adapter. Caller owns the microphone grant and this exact child handle.
 * The helper never receives credentials.
 */
export async function prepareNativeCapture(child: ChildProcessWithoutNullStreams,
  requested: Pick<NativeCaptureFormat, "sampleRate" | "requestedCallbackFrames"> & { channelMap?: NativeChannelMap },
  failed: (error: Error) => void,
  observed: (event: Record<string, unknown>) => void = () => {}, signal?: AbortSignal) {
  let stopped = false, accepting = false, uploadAttempted = false, muted = false, socket: WebSocket | undefined;
  let control = "", nextNonce = 0, sequence = 0, position = 0;
  let pending: Buffer = Buffer.alloc(0);
  const channelMap = requested.channelMap ?? [0, 1], channels = channelMap.length;
  let stopTimer: ReturnType<typeof setTimeout> | undefined, killTimer: ReturnType<typeof setTimeout> | undefined;
  const waiters = new Map<string, { resolve(value: Record<string, unknown>): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>();
  const closed = new Promise<void>(resolve => child.once("close", () => resolve()));
  const wait = (key: string, timeoutMs = 2000) => new Promise<Record<string, unknown>>((resolve, reject) => {
    if (stopped) return reject(new Error("Native capture stopped."));
    const timer = setTimeout(() => {
      waiters.delete(key);
      const error = new Error("Native capture did not respond."); reject(error); fail(error);
    }, timeoutMs);
    waiters.set(key, { resolve, reject, timer });
  });
  const stop = () => {
    if (!stopped) {
      stopped = true; accepting = false;
      for (const entry of waiters.values()) { clearTimeout(entry.timer); entry.reject(new Error("Native capture stopped.")); }
      waiters.clear();
      socket?.terminate();
      child.stdin.end("stop\n");
      stopTimer = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
        killTimer = setTimeout(() => {
          if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
        }, 2000);
      }, 2000);
    }
    return closed;
  };
  const fail = (reason: unknown) => {
    if (stopped) return;
    const error = reason instanceof Error ? reason : new Error("Native capture failed.");
    void stop(); failed(error);
  };
  child.on("error", () => fail(new Error("The native capture helper could not run.")));
  child.stdin.on("error", () => fail(new Error("The native capture control pipe closed.")));
  child.stdout.on("error", () => fail(new Error("The native capture audio pipe closed.")));
  child.stderr.on("error", () => fail(new Error("The native capture status pipe closed.")));
  child.once("close", () => {
    if (!stopped) fail(new Error("The audio input stopped."));
    clearTimeout(stopTimer); clearTimeout(killTimer);
  });
  const ready = wait("ready", 5000);
  const abort = () => { void stop(); };
  signal?.addEventListener("abort", abort, { once: true });
  child.once("close", () => signal?.removeEventListener("abort", abort));
  if (signal?.aborted) abort();
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    try {
      control += chunk;
      if (control.length > 16_384) throw new Error("Native capture status exceeded its limit.");
      let newline: number;
      while ((newline = control.indexOf("\n")) >= 0) {
        const line = control.slice(0, newline); control = control.slice(newline + 1);
        if (!line.startsWith("{")) { observed({ event: "diagnostic", message: line.slice(0, 512) }); continue; }
        const event = JSON.parse(line) as Record<string, unknown>;
        observed(event);
        if (stopped) continue;
        if (event.event === "end") throw new Error(event.reason === "channels" ? "Those input channels are unavailable. Refresh inputs and choose an available channel or stereo pair." : event.reason === "capture" && captureErrors[Number(event.captureError)] || "The audio input stopped.");
        const key = event.event === "clock" ? `clock:${event.nonce}` : String(event.event);
        const entry = waiters.get(key);
        if (!entry) throw new Error("Unexpected native capture response.");
        clearTimeout(entry.timer); waiters.delete(key); entry.resolve(event);
      }
    } catch (error) { fail(error); }
  });
  child.stdout.on("data", (chunk: Buffer) => {
    if (stopped) return;
    try {
      if (!accepting || !socket || socket.readyState !== WebSocket.OPEN) throw new Error("Native PCM arrived before its upload was ready.");
      // Node can split a header or coalesce packets. Bound the parser independently of WebSocket.
      if (pending.length + chunk.length > 262_144) throw new Error("The native capture reader cannot keep up.");
      pending = pending.length ? Buffer.concat([pending, chunk]) : chunk;
      while (pending.length >= 40) {
        const frames = pending.readUInt32LE(32), bytes = 40 + frames * channels * 4;
        if (pending.readUInt32LE(0) !== 0x31414343 || pending[4] !== channels || pending[5] !== 1 ||
          pending.readUInt16LE(6) !== 40 || pending.readUInt32LE(8) !== requested.sampleRate ||
          frames < 1 || frames > 4096 || pending.readUInt32LE(36) !== 0) throw new Error("Invalid native PCM format.");
        if (pending.length < bytes) break;
        const packet = pending.subarray(0, bytes);
        if (packet.readUInt32LE(12) !== sequence || packet.readBigUInt64LE(16) !== BigInt(position)) throw new Error("Native PCM lost its sample order.");
        if (socket.bufferedAmount + bytes > 192_000) throw new Error("The connection cannot keep up with native capture.");
        const outgoing = muted ? Buffer.from(packet) : packet;
        if (muted) outgoing.fill(0, 40); // Deliberate user mute preserves the sample clock.
        socket.send(outgoing, error => { if (error) fail(new Error("The native capture upload disconnected.")); });
        sequence++; position += frames; pending = pending.subarray(bytes);
      }
    } catch (error) { fail(error); }
  });
  try {
    const event = await ready;
    if (event.sampleRate !== requested.sampleRate || event.channels !== channels || event.format !== "f32le" ||
      event.requestedCallbackFrames !== requested.requestedCallbackFrames || event.nominalRate !== requested.sampleRate ||
      typeof event.ownerHalBufferFrames !== "number" || !Number.isInteger(event.ownerHalBufferFrames) || event.ownerHalBufferFrames < 1 ||
      typeof event.reportedInputLatencyMs !== "number" || !Number.isFinite(event.reportedInputLatencyMs) || event.reportedInputLatencyMs < 0)
      throw new Error("The native input did not prepare the requested format.");
    if (!Array.isArray(event.channelMap) || event.channelMap.length !== channels || event.channelMap.some((channel, index) => channel !== channelMap[index]))
      throw new Error("The native input did not select the requested channels. Update Couch and choose the input again.");
    const format = event as unknown as NativeCaptureFormat;
    const clock = async () => {
      const nonce = nextNonce++, reply = wait(`clock:${nonce}`);
      child.stdin.write(`clock ${nonce}\n`);
      const event = await reply;
      if (typeof event.nativeUs !== "number" || !Number.isSafeInteger(event.nativeUs) || event.nativeUs < 0) throw new Error("Invalid native capture clock.");
      return event.nativeUs;
    };
    return {
      format, stop, closed,
      setMuted(value: boolean) { muted = value; observed({ event: "mute", muted }); },
      async upload(url: string) {
        try {
          if (stopped || uploadAttempted) throw new Error("Prepare a new native capture for this upload.");
          uploadAttempted = true;
          const target = new URL(url);
          if (target.protocol !== "ws:" || !["localhost", "127.0.0.1", "[::1]"].includes(target.hostname) ||
            target.pathname !== "/api/live/upload" || target.username || target.password || target.hash)
            throw new Error("Use this computer's authorized capture upload.");
          const connection = socket = new WebSocket(url, { origin: target.origin.replace(/^ws:/, "http:") });
          connection.on("error", () => fail(new Error("The native capture upload disconnected.")));
          connection.on("close", () => fail(new Error("Couch stopped the native capture upload.")));
          await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error("The capture upload could not connect.")), 2000);
            connection.once("open", () => { clearTimeout(timer); resolve(); });
            connection.once("error", () => { clearTimeout(timer); reject(new Error("The capture upload could not connect.")); });
            connection.once("close", () => { clearTimeout(timer); reject(new Error("The capture upload closed.")); });
          });
          let best = { rttUs: Infinity, offsetUs: 0 };
          for (let i = 0; i < 5; i++) {
            const clientUs = await clock();
            const serverUs = await new Promise<number>((resolve, reject) => {
              const finish = (error?: Error, value?: number) => { clearTimeout(timer); connection.off("message", message); connection.off("close", disconnected); error ? reject(error) : resolve(value!); };
              const disconnected = () => finish(new Error("The capture clock connection closed."));
              const timer = setTimeout(() => finish(new Error("The capture clock exchange timed out.")), 2000);
              const message = (data: WebSocket.RawData) => {
                try {
                  const reply = JSON.parse(data.toString());
                  if (reply.type !== "clock" || reply.clientUs !== clientUs || !Number.isSafeInteger(reply.serverUs)) throw new Error("Invalid capture clock response.");
                  finish(undefined, reply.serverUs);
                } catch { finish(new Error("The capture clock exchange failed.")); }
              };
              connection.on("message", message); connection.once("close", disconnected);
              connection.send(JSON.stringify({ type: "clock", clientUs }));
            });
            const now = await clock(), rttUs = now - clientUs;
            if (rttUs < 0) throw new Error("The native capture clock moved backward.");
            if (rttUs < best.rttUs) best = { rttUs, offsetUs: Math.round(serverUs - (now + clientUs) / 2) };
          }
          if (stopped || best.rttUs > 100_000) throw new Error("The native capture clock could not be synchronized.");
          connection.on("message", () => fail(new Error("Couch rejected the native capture upload.")));
          connection.send(JSON.stringify({ type: "start", generation: randomUUID(), ...best }));
          const started = wait("started");
          accepting = true; child.stdin.write("start\n");
          const running = await started;
          if (typeof running.ownerHalBufferFrames !== "number" || !Number.isInteger(running.ownerHalBufferFrames) || running.ownerHalBufferFrames < 1) throw new Error("Native capture did not report its running buffer.");
          format.ownerHalBufferFrames = running.ownerHalBufferFrames;
          observed({ event: "upload-clock", ...best, uncertaintyUs: best.rttUs / 2 });
          return best;
        } catch (error) { fail(error); throw error; }
      },
    };
  } catch (error) { fail(error); await closed; throw error; }
}
