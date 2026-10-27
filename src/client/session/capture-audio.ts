import type { AudioCaptureFormat } from "../../shared/capture";

/** Chromium exposes audio AudioData here; other implementations may expose video only. */
type CaptureFrame = { timestamp: number; sampleRate: number; numberOfChannels: number; numberOfFrames: number; close(): void };
type Processor = { readable: ReadableStream<CaptureFrame> };
type ProcessorConstructor = new (options: { track: MediaStreamTrack; maxBufferSize: number }) => Processor;
const processor = () => (globalThis as unknown as { MediaStreamTrackProcessor?: ProcessorConstructor }).MediaStreamTrackProcessor;
export const canCaptureAudio = () => !!processor() && typeof Worker !== "undefined";

/** Probe real audio frames before advertising PCM. Never infer audio support from the API symbol. */
export async function prepareCaptureAudio(track: MediaStreamTrack, live: boolean, expectedSampleRate?: number, observed?: (format: AudioCaptureFormat) => void) {
  const Processor = processor();
  if (!Processor) throw new Error("This browser cannot provide timestamped audio capture.");
  const source = new Processor({ track, maxBufferSize: 4 });
  const reader = source.readable.getReader();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const first = await Promise.race([reader.read(), new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error("The audio input did not provide timestamped frames.")), 3000); })]);
    if (!first.value) throw new Error("The audio input ended before capture started.");
    const frame = first.value;
    try {
      if (![1, 2].includes(frame.numberOfChannels) || ![44_100, 48_000, 96_000].includes(frame.sampleRate)) throw new Error("This audio input's format is not supported for scheduled capture.");
      if (expectedSampleRate !== undefined && frame.sampleRate !== expectedSampleRate) throw new Error(`The audio input delivered ${frame.sampleRate} Hz instead of ${expectedSampleRate} Hz. Choose Automatic or another input.`);
      if (live && frame.numberOfChannels !== 2) throw new Error("Live audio needs a real stereo input. Choose a stereo audio interface or use ordinary sharing.");
      const age = performance.now() * 1000 - frame.timestamp;
      if (!Number.isFinite(frame.timestamp) || age < -50_000 || age > 2_000_000) throw new Error("This browser does not expose the capture clock needed for scheduled audio.");
      observed?.({ sampleRate: frame.sampleRate, channels: frame.numberOfChannels, firstBlockFrames: frame.numberOfFrames });
    } finally { frame.close(); }
    reader.releaseLock();
    return source.readable;
  } catch (error) { await reader.cancel().catch(() => {}); reader.releaseLock(); throw error; }
  finally { clearTimeout(timeout); }
}

export function uploadCaptureAudio(readable: ReadableStream<CaptureFrame>, url: string, failed: (error: Error) => void) {
  const worker = new Worker(new URL("./capture-audio-worker.ts", import.meta.url), { type: "module" });
  const reader = readable.getReader();
  let stopped = false, queued = 0;
  const stop = () => {
    if (stopped) return;
    stopped = true; void reader.cancel().catch(() => {}).finally(() => reader.releaseLock()); worker.terminate();
  };
  const fail = (error: Error) => { if (!stopped) { stop(); failed(error); } };
  worker.onmessage = event => {
    if (event.data.error) fail(new Error(event.data.error));
    if (event.data.consumed) queued = Math.max(0, queued - 1);
    if (event.data.ready) void (async () => {
      try {
        while (!stopped) {
          const result = await reader.read();
          if (!result.value) { if (!stopped) fail(new Error("The audio input ended.")); break; }
          const frame = result.value;
          if (stopped) { frame.close(); break; }
          if (++queued > 8) { frame.close(); throw new Error("The capture worker cannot keep up with this input."); }
          // AudioData keeps this source realm's timestamps when ownership transfers.
          // Native ReadableStream transfer can change the producer's origin instead.
          // No sample copy or arrival timestamp here.
          try { worker.postMessage({ frame, timeOrigin: performance.timeOrigin }, [frame as unknown as Transferable]); }
          catch (error) { frame.close(); throw error; }
        }
      } catch (error) { fail(error instanceof Error ? error : new Error("Audio capture failed.")); }
      finally { reader.releaseLock(); }
    })();
  };
  worker.onerror = () => fail(new Error("The audio capture worker stopped."));
  worker.postMessage({ url });
  return stop;
}
