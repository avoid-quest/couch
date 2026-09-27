import { createPcmDecoder, validatePcmSource } from "./pcm-decoder";
import { Socket } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import type { PlaybackCommand, PlayerState } from "../shared/protocol";

type Load = Extract<PlaybackCommand, { type: "load" }> & { duration?: number };
type Options = { host: string; port: number; bufferMs: number; drainMs: number; observe: (state: PlayerState) => void; ffmpeg?: string };
const bytesPerSecond = 48_000 * 2 * 2;
const speedValid = (speed: number) => Number.isFinite(speed) && speed >= 0.25 && speed <= 4;


export function createPcmProducer(options: Options) {
  if (!Number.isInteger(options.port) || options.port < 1 || options.port > 65535 || !Number.isFinite(options.bufferMs) || options.bufferMs < 0 || !Number.isFinite(options.drainMs) || options.drainMs < options.bufferMs + 20) throw new Error("Invalid audio group timing or address.");
  let closed = false;
  let uncertainIngestion = false;
  let generation = 0;
  let intent = 0;
  let retiring = Promise.resolve();
  let closing: Promise<void> | null = null;
  let load: Load | null = null;
  let position = 0;
  let speed = 1;
  let status: PlayerState["status"] = "idle";
  let failure: string | null = null;
  let run: ReturnType<typeof decode> | null = null;
  let frames: { at: number; start: number; seconds: number }[] = [];
  let submitted = 0;
  const now = () => performance.now();
  const seekable = () => !!load?.duration && load.duration > 0 && !load.radio;
  const clock = () => {
    const timestamp = now();
    while (frames.length) {
      const frame = frames[0]!;
      const fraction = Math.min(1, Math.max(0, (timestamp - frame.at - options.bufferMs) / (frame.seconds / speed * 1000)));
      position = frame.start + frame.seconds * fraction;
      if (fraction < 1) break;
      frames.shift();
    }
    if (load?.duration) position = Math.min(position, load.duration);
    return position;
  };
  const emit = () => {
    const estimatedPosition = clock();
    const buffering = status === "playing" && !frames.length;
    options.observe({ playbackId: load?.playbackId ?? null, status: buffering ? "loading" : status, buffering, position: estimatedPosition, duration: load?.duration ?? null, volume: 100,
    seekable: seekable(), speed, error: failure, positionEstimated: true, audioTracksKnown: false,
    tracks: load ? [{ id: "group-audio", index: 0, kind: "audio", label: "Audio", language: "", selected: true }] : [] } as PlayerState);
  };
  const current = (attempt: number) => !closed && generation === attempt;
  async function bounded<T>(promise: Promise<T>, cancellation: AbortSignal, message: string, timeoutMs = 10_000): Promise<T> {
    const timer = new AbortController();
    try { return await Promise.race([promise, delay(timeoutMs, undefined, { signal: AbortSignal.any([timer.signal, cancellation]) }).then(() => { throw new Error(message); })]); }
    finally { timer.abort(); }
  }
  function decode(command: Load, start: number, rate: number) {
    const cancellation = new AbortController();
    const decoder = createPcmDecoder(command, { position: start, speed: rate, ffmpeg: options.ffmpeg, signal: cancellation.signal });
    return { decoder, cancellation, socket: null as Socket | null, first: new Uint8Array(0) as Uint8Array, loop: null as Promise<void> | null, reportTimer: undefined as ReturnType<typeof setInterval> | undefined, wrote: false };
  }
  const block = (worker: NonNullable<typeof run>) => worker.decoder.read();
  async function release(worker: NonNullable<typeof run>) {
    worker.cancellation.abort();
    if (worker.reportTimer) clearInterval(worker.reportTimer);
    worker.socket?.destroy();
    await worker.decoder.close();
  }
  function retire() {
    generation++;
    const previous = run;
    run = null;
    retiring = retiring.then(async () => {
      if (previous) {
        await release(previous);
        await previous.loop;
        if (previous.wrote) await delay(options.drainMs);
      }
      clock();
      frames = [];
      submitted = position;
    });
    return retiring;
  }
  async function fail(worker: NonNullable<typeof run>, attempt: number, message: string) {
    if (!current(attempt)) return;
    status = "error"; failure = message; emit();
    await release(worker);
    if (worker.wrote) await delay(options.drainMs);
    if (!current(attempt)) return;
    clock(); frames = []; run = null; status = "error"; failure = message; emit();
  }
  async function pump(worker: NonNullable<typeof run>, attempt: number, first: Uint8Array) {
    let writing = false;
    let ending = false;
    try {
      const socket = new Socket();
      worker.socket = socket;
      socket.on("error", () => {
        if (worker.wrote && current(attempt) && !worker.cancellation.signal.aborted) {
          uncertainIngestion = true;
          worker.cancellation.abort();
        }
      });
      socket.on("close", () => {
        if (!ending && worker.wrote && current(attempt) && !worker.cancellation.signal.aborted) {
          uncertainIngestion = true;
          worker.cancellation.abort();
        }
      });
      socket.setNoDelay(true);
      await bounded(new Promise<void>((resolve, reject) => { socket.once("error", reject); socket.once("connect", resolve); socket.connect(options.port, options.host); }), worker.cancellation.signal, "The audio group did not accept its stream.");
      worker.reportTimer = setInterval(() => { if (current(attempt) && worker.wrote && status === "playing") emit(); }, 200);
      let pcm = first;
      while (current(attempt) && !worker.cancellation.signal.aborted) {
        if (!pcm.length) {
          ending = true;
          socket.end();
          await delay(options.drainMs, undefined, { signal: worker.cancellation.signal });
          if (!current(attempt)) return;
          clock(); frames = []; status = "ended"; emit();
          await release(worker);
          if (current(attempt)) run = null;
          return;
        }
        writing = true;
        await bounded(new Promise<void>((resolve, reject) => socket.write(pcm, error => error ? reject(new Error("The audio group disconnected.")) : resolve())), worker.cancellation.signal, "The audio group stopped accepting audio.", 100);
        writing = false;
        if (!current(attempt)) return;
        const firstWrite = !worker.wrote;
        worker.wrote = true;
        const seconds = pcm.length / bytesPerSecond * speed;
        frames.push({ at: now(), start: submitted, seconds });
        submitted += seconds;
        status = "playing";
        if (firstWrite) emit();
        // Never catch up after a stalled write/read: each block owns a fresh time slot.
        await delay(pcm.length / bytesPerSecond * 1000, undefined, { signal: worker.cancellation.signal });
        pcm = await block(worker);
      }
    } catch (error) {
      if (writing && current(attempt) && !worker.cancellation.signal.aborted) uncertainIngestion = true;
      const known = new Set(["The decoder returned incomplete audio frames.", "The audio decoder failed.", "The audio source stopped responding.", "The decoder did not finish.", "The audio group did not accept its stream."]);
      await fail(worker, attempt, uncertainIngestion ? "Audio ingestion stopped unexpectedly. Reconnect the audio group before moving playback." : error instanceof Error && known.has(error.message) ? error.message : "The audio group or decoder stopped responding. Try playback again.");
    }
  }
  async function start(paused: boolean) {
    const attempt = ++generation;
    status = "loading"; failure = null; emit();
    let worker: NonNullable<typeof run>;
    try {
      worker = decode(load!, position, speed);
      run = worker;
      const first = await block(worker);
      if (!current(attempt)) return;
      if (!first.length) throw new Error("The source has no decodable audio.");
      if (paused) {
        // Retain only this first block and pipe backpressure; no ingestion connection.
        worker.first = first;
        status = "paused"; emit();
      } else worker.loop = pump(worker, attempt, first);
    } catch {
      if (run && current(attempt)) await fail(run, attempt, "Could not decode this audio source.");
      else if (current(attempt)) { status = "error"; failure = "Could not start the audio decoder."; emit(); }
    }
  }
  const cancel = () => {
    intent++; generation++;
    run?.cancellation.abort();
    if (run?.reportTimer) clearInterval(run.reportTimer);
    run?.socket?.destroy();
  };
  return {
    cancel,
    async send(command: PlaybackCommand) {
      const operation = intent;
      if (closed) throw new Error("The audio group is closed.");
      if (uncertainIngestion) throw new Error("Audio ingestion is uncertain. Reconnect the audio group first.");
      if ("playbackId" in command && command.type !== "load" && command.playbackId !== load?.playbackId) throw new Error("The audio playback changed.");
      if (command.type === "load") {
        const next = command as Load;
        validatePcmSource(next);
        const rate = next.preferences?.speed ?? 1;
        if (!speedValid(rate) || next.startPosition !== undefined && (!Number.isFinite(next.startPosition) || next.startPosition < 0) || next.duration !== undefined && (!Number.isFinite(next.duration) || next.duration < 0)) throw new Error("Invalid audio playback timing.");
        await retire();
        if (closed || operation !== intent) return;
        load = next; position = next.startPosition ?? 0; submitted = position; speed = rate;
        await start(!!next.paused);
      } else if (command.type === "stop") {
        await retire(); if (closed || operation !== intent) return; if (uncertainIngestion) throw new Error("Audio ingestion is uncertain. Reconnect the audio group first."); load = null; position = 0; status = "idle"; failure = null; if (!closed) emit();
      } else if (command.type === "pause") {
        if (command.paused) { await retire(); if (closed || operation !== intent) return; if (uncertainIngestion) throw new Error("Audio ingestion is uncertain. Reconnect the audio group first."); if (!closed) { status = "paused"; emit(); } }
        else if (status !== "playing") { await retire(); if (!closed && operation === intent) await start(false); }
      } else if (command.type === "seek" || command.type === "speed") {
        if (command.type === "seek" && (!seekable() || !Number.isFinite(command.position) || command.position < 0 || command.position > load!.duration!)) throw new Error("This audio source cannot seek there.");
        if (command.type === "speed" && !speedValid(command.speed)) throw new Error("Invalid playback speed.");
        const paused = status === "paused";
        await retire();
        if (closed || operation !== intent) return;
        if (command.type === "seek") position = command.position;
        else speed = command.speed;
        submitted = position;
        await start(paused);
      } else if (command.type === "track" && command.kind === "audio" && command.index === 0) emit();
      else throw new Error("The audio group does not support this playback command.");
    },
    close() { if (closing) return closing; closed = true; cancel(); closing = retire().then(() => { load = null; }); return closing; },
  };
}
