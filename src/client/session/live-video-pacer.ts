type Processor = new (options: { track: MediaStreamTrack; maxBufferSize: number }) => {
  readable: ReadableStream<VideoFrame>;
};
type Generator = new (options: {
  kind: "video";
}) => MediaStreamTrack & { writable: WritableStream<VideoFrame> };
export type VideoPacingStats = {
  received: number;
  pushed: number;
  dropped: number;
  queued: number;
};
const snapshots = new WeakMap<MediaStreamTrack, () => Promise<VideoPacingStats>>();
export const liveVideoPacingStats = (track: MediaStreamTrack) => snapshots.get(track)?.();

/** Preserve WebRTC's decoded frames and A/V clock; replace only compositor pacing. */
export function paceLiveVideo(track: MediaStreamTrack, failed: () => void, signal?: AbortSignal) {
  const { MediaStreamTrackProcessor: Processor, MediaStreamTrackGenerator: Generator } =
    globalThis as unknown as {
      MediaStreamTrackProcessor?: Processor;
      MediaStreamTrackGenerator?: Generator;
    };
  if (!Processor || !Generator || typeof Worker === "undefined") return;
  return (async () => {
    const source = track.clone();
    let generated: InstanceType<Generator> | undefined,
      worker: Worker | undefined,
      closed = false,
      ready = false,
      next = 0;
    let settle: (value: boolean) => void;
    const pending = new Map<
      number,
      { resolve: (value: VideoPacingStats) => void; reject: (reason: Error) => void }
    >();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const close = () => {
      if (closed) return;
      closed = true;
      signal?.removeEventListener("abort", close);
      clearTimeout(timer);
      source.stop();
      generated?.stop();
      snapshots.delete(generated!);
      settle?.(false);
      for (const request of pending.values()) request.reject(new Error("Video pacing stopped"));
      pending.clear();
      // Give the worker a bounded chance to close queued VideoFrames and its streams.
      worker?.postMessage({ stop: true });
      const owned = worker;
      if (owned) setTimeout(() => owned.terminate(), 100);
    };
    signal?.addEventListener("abort", close, { once: true });
    if (signal?.aborted) {
      close();
      return;
    }
    try {
      generated = new Generator({ kind: "video" });
      const readable = new Processor({ track: source, maxBufferSize: 3 }).readable;
      worker = new Worker(new URL("./live-video-pacer-worker.ts", import.meta.url), {
        type: "module",
      });
      const prepared = new Promise<boolean>((resolve) => {
        settle = resolve;
      });
      timer = setTimeout(() => settle(false), 1000);
      const fail = () => {
        const active = ready && !closed;
        close();
        if (active) failed();
      };
      worker.onmessage = (event) => {
        if (event.data.ready) settle(true);
        else if (event.data.stopped) worker?.terminate();
        else if (event.data.error) fail();
        else if (event.data.snapshot !== undefined) {
          pending.get(event.data.snapshot)?.resolve(event.data);
          pending.delete(event.data.snapshot);
        }
      };
      worker.onerror = fail;
      worker.postMessage({ readable, writable: generated.writable }, [
        readable,
        generated.writable,
      ]);
      const supported = await prepared;
      clearTimeout(timer);
      if (!supported || closed) {
        close();
        return;
      }
      ready = true;
      snapshots.set(
        generated,
        () =>
          new Promise((resolve, reject) => {
            pending.set(++next, { resolve, reject });
            worker!.postMessage({ snapshot: next });
          }),
      );
      return { track: generated, close };
    } catch {
      close();
      return;
    }
  })();
}
