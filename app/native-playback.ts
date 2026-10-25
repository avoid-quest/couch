import type { ChildProcessWithoutNullStreams } from "node:child_process";

export type NativePlaybackFormat = { sampleRate: 48000; channels: 2; bitDepth: 16; maxQueueUs: number; requestedMs: number };

/** One owned native output. The helper receives PCM/deadlines, never credentials. */
export async function prepareNativePlayback(child: ChildProcessWithoutNullStreams,
  failed: (error: Error) => void, observed: (event: Record<string, unknown>) => void = () => {}, signal?: AbortSignal) {
  let stopped = false, prepared = false, sequence = 0, receivedFrames = 0, writtenSequence = 0, writtenFrames = 0;
  let pending = "", resampler = "", diagnosticTail = "";
  const pendingFrames: number[] = [];
  let terminateTimer: ReturnType<typeof setTimeout> | undefined, killTimer: ReturnType<typeof setTimeout> | undefined;
  let resolveReady!: (format: NativePlaybackFormat) => void, rejectReady!: (error: Error) => void;
  const ready = new Promise<NativePlaybackFormat>((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  const closed = new Promise<void>(resolve => child.once("close", () => resolve()));
  const command = (op: number, value = 0) => {
    const packet = Buffer.alloc(16);
    packet.writeBigInt64LE(BigInt(value)); packet.writeUInt32LE(op, 12);
    return packet;
  };
  const stop = () => {
    if (!stopped) {
      stopped = true; clearTimeout(readyTimer);
      rejectReady(new Error("Native playback stopped."));
      child.stdin.end(command(0));
      terminateTimer = setTimeout(() => {
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
    const error = reason instanceof Error ? reason : new Error("Native playback failed.");
    void stop(); failed(error);
  };
  const readyTimer = setTimeout(() => fail(new Error("The native output did not prepare.")), 5000);
  const abort = () => { void stop(); };
  child.on("error", () => fail(new Error("The native playback helper could not run.")));
  child.stdin.on("error", () => fail(new Error("The native playback pipe closed.")));
  child.stdout.on("error", () => fail(new Error("The native playback status pipe closed.")));
  child.stderr.on("error", () => fail(new Error("The native playback diagnostic pipe closed.")));
  child.stderr.on("data", (chunk: Buffer) => { diagnosticTail = (diagnosticTail + chunk.toString()).slice(-4096); });
  child.once("close", (code, cause) => {
    if (!stopped) fail(new Error(`Native playback ended (${cause ?? code ?? "unknown"}).`));
    clearTimeout(readyTimer); clearTimeout(terminateTimer); clearTimeout(killTimer);
    signal?.removeEventListener("abort", abort);
    observed({ event: "closed", code, cause, receivedPackets: sequence, receivedFrames, writtenPackets: writtenSequence, writtenFrames, diagnosticTail });
  });
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    try {
      pending += chunk;
      if (pending.length > 131072) throw new Error("Native playback status exceeded its limit.");
      let newline: number;
      while ((newline = pending.indexOf("\n")) >= 0) {
        const line = pending.slice(0, newline); pending = pending.slice(newline + 1);
        const event = JSON.parse(line) as Record<string, unknown>;
        if (!event || typeof event !== "object" || typeof event.event !== "string") throw new Error("Invalid native playback status.");
        observed(event);
        if (event.event === "write") {
          if (event.sequence !== writtenSequence || event.frames !== pendingFrames.shift()) throw new Error("Native playback lost PCM order.");
          writtenSequence++; writtenFrames += Number(event.frames);
          continue;
        }
        if (stopped) continue;
        if (event.event === "rate") {
          if (typeof event.method !== "string" || !event.method.startsWith("speex-") || !Number.isInteger(event.actualRate)
            || Number(event.actualRate) < 47976 || Number(event.actualRate) > 48024) throw new Error("The native output has no supported filtered clock correction.");
          resampler = event.method;
        } else if (event.event === "ready") {
          if (prepared || !resampler || event.sampleRate !== 48000 || event.channels !== 2 || event.bitDepth !== 16
            || typeof event.maxQueueUs !== "number" || !Number.isFinite(event.maxQueueUs) || event.maxQueueUs <= 0 || event.maxQueueUs > 250000
            || typeof event.requestedMs !== "number" || !Number.isInteger(event.requestedMs) || event.requestedMs < 5 || event.requestedMs > 250)
            throw new Error("The native output did not prepare the requested format.");
          prepared = true; clearTimeout(readyTimer); resolveReady(event as NativePlaybackFormat);
        } else if (event.event === "stopped") throw new Error(`Native playback stopped (${String(event.exit)}).`);
      }
      if (pending.length > 16384) throw new Error("Native playback status line exceeded its limit.");
    } catch (error) { fail(error); }
  });
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) abort();
  try {
    const format = await ready;
    if (stopped) throw new Error("Native playback was canceled.");
    const send = (packet: Buffer) => {
      if (stopped) throw new Error("Native playback stopped.");
      if (child.stdin.writableLength + packet.length > 131072) throw new Error("The native output cannot keep up.");
      child.stdin.write(packet);
    };
    return {
      format, stop, closed,
      write(pcm: Buffer, playTimeUs: number) {
        try {
          const frames = pcm.length / 4;
          if (!Number.isInteger(frames) || frames < 1 || frames > 2048 || !Number.isFinite(playTimeUs)) throw new Error("Invalid native playback PCM.");
          // The SDK's performance.now epoch is mapped to Linux monotonic, not arrival time.
          const before = performance.now() * 1000, native = Number(process.hrtime.bigint() / 1000n), after = performance.now() * 1000;
          const target = Math.round(playTimeUs + native - (before + after) / 2);
          if (after - before > 1000 || !Number.isSafeInteger(target) || target <= 0) throw new Error("The native output clock could not be mapped.");
          const packet = Buffer.allocUnsafe(16 + pcm.length);
          packet.writeBigInt64LE(BigInt(target)); packet.writeUInt32LE(frames, 8); packet.writeUInt32LE(sequence, 12); pcm.copy(packet, 16);
          send(packet); sequence++; receivedFrames += frames; pendingFrames.push(frames);
        } catch (error) { fail(error); throw error; }
      },
      setVolume(volume: number) {
        if (!Number.isInteger(volume) || volume < 0 || volume > 100) throw new Error("Choose a volume from 0 to 100.");
        try { send(command(1, volume)); } catch (error) { fail(error); throw error; }
      },
      setMuted(muted: boolean) {
        if (typeof muted !== "boolean") throw new Error("Invalid output mute.");
        try { send(command(2, muted ? 1 : 0)); } catch (error) { fail(error); throw error; }
      },
    };
  } catch (error) { await stop(); throw error; }
}
