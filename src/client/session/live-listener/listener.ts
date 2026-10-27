import workletUrl from "./listener-worklet.ts?worker&url";
import { OutputClock, OutputClockPublisher } from "./output-clock";
import { RenderProgress } from "./render-progress";
import type { Calibration, ListenerConnection, ListenerState, ListenerStats, WorkerCommand, WorkerEvent, WorkletStats } from "./types";
export type { ListenerState, ListenerStats } from "./types";

export interface ListenerOptions extends ListenerConnection {
  latencyHint?: AudioContextLatencyCategory | number;
  // Pass session/renderer.ts's existing waitForTap; the listener owns no UI.
  waitForTap(unlock: (() => void) | null): void;
  onState(state: ListenerState): void;
  onStats(stats: ListenerStats): void;
}
export interface LiveListener { start(): Promise<void>; stop(): void }

// One instance owns one listening lifetime. Stop also cancels a pending startup.
export function createLiveListener(options: ListenerOptions): LiveListener {
  let started = false, stopped = false;
  let context: AudioContext | undefined, node: AudioWorkletNode | undefined;
  let worker: Worker | undefined, calibrator: Worker | undefined;
  let channel: MessageChannel | undefined, timer: ReturnType<typeof setInterval> | undefined;
  let wake: WakeLockSentinel | undefined, requestingWake = false;
  let cancelCalibration: (() => void) | undefined;
  let pendingOutput: Parameters<OutputClockPublisher["push"]>[0] | null = null;
  let connection: ListenerState = { state: "preparing" };
  let previousState = "";
  const state = (value: ListenerState) => {
    const key = JSON.stringify(value);
    if (key !== previousState) { previousState = key; options.onState(value); }
  };
  const post = (message: WorkerCommand, transfer: Transferable[] = []) => worker?.postMessage(message, transfer);
  const releaseWake = () => { const lock = wake; wake = undefined; void lock?.release().catch(() => {}); };
  const acquireWake = async () => {
    if (stopped || wake || requestingWake || context?.state !== "running" || document.visibilityState !== "visible" || !navigator.wakeLock) return;
    requestingWake = true;
    try {
      const lock = await navigator.wakeLock.request("screen");
      if (stopped || context?.state !== "running" || document.visibilityState !== "visible") await lock.release();
      else { wake = lock; lock.addEventListener("release", () => { if (wake === lock) wake = undefined; }); }
    } catch { /* Wake lock is optional. Playback still works when the browser refuses it. */ }
    finally { requestingWake = false; }
  };
  const visibility = () => { if (document.visibilityState === "visible") void acquireWake(); else releaseWake(); };
  const resume = () => { void context?.resume().catch(() => {}); };
  const contextState = () => {
    if (stopped || !context) return;
    if (context.state === "running") { options.waitForTap(null); state(connection); void acquireWake(); }
    else { options.waitForTap(resume); state({ state: "needs-tap" }); releaseWake(); }
  };
  const cleanup = () => {
    stopped = true;
    clearInterval(timer); cancelCalibration?.(); cancelCalibration = undefined;
    calibrator?.terminate(); worker?.terminate(); node?.disconnect(); node?.port.close();
    channel?.port1.close(); channel?.port2.close();
    document.removeEventListener("visibilitychange", visibility);
    options.waitForTap(null); releaseWake();
    if (context) { context.onstatechange = null; void context.close().catch(() => {}); }
  };
  const fail = (reason: string) => { cleanup(); state({ state: "failed", reason }); };

  return {
    async start() {
      if (started || stopped) return;
      started = true;
      if (!globalThis.isSecureContext) { state({ state: "needs-https" }); return; }
      state(connection);
      try {
        const audioSession = (navigator as Navigator & { audioSession?: { type: string } }).audioSession;
        if (audioSession) audioSession.type = "playback";
        context = new AudioContext({ sampleRate: 48000, latencyHint: options.latencyHint ?? "interactive" });
        if (!context.audioWorklet || !context.getOutputTimestamp) throw new Error("This browser cannot play Live audio.");
        const quantum = (context as AudioContext & { renderQuantumSize?: number }).renderQuantumSize ?? 128;
        context.onstatechange = contextState;
        document.addEventListener("visibilitychange", visibility);
        resume(); contextState();
        channel = new MessageChannel();
        worker = new Worker(new URL("./listener-worker.ts", import.meta.url), { type: "module" });
        worker.onerror = () => { if (!stopped) fail("Live audio's connection worker stopped."); };
        worker.onmessage = ({ data }: MessageEvent<WorkerEvent>) => {
          if (stopped) return;
          if (data.type === "state") {
            connection = data.value;
            if (connection.state === "removed" || connection.state === "failed") { cleanup(); state(connection); }
            else contextState();
          } else {
            if (data.stats.played > 0 && connection.state !== "reconnecting") connection = { state: "playing" };
            contextState(); options.onStats(data.stats);
          }
        };
        post({ type: "start", url: options.url, protocols: options.protocols, auth: options.auth, port: channel.port1 }, [channel.port1]);
        const clock = new OutputClock(), progress = new RenderProgress();
        const publisher = new OutputClockPublisher({ postMessage: message => {
          if (node) node.port.postMessage(message);
          else pendingOutput = { ...message.fit };
        } });
        let slowSent = false;
        timer = setInterval(() => {
          if (!context || stopped) return;
          const lag = progress.push(performance.now(), context.currentTime * 1000, context.state === "running", quantum / context.sampleRate * 1000);
          if (lag !== null && node && !slowSent) { node.port.postMessage({ type: "slow" }); slowSent = true; }
          if (context.state !== "running") return;
          const { contextTime, performanceTime } = context.getOutputTimestamp();
          if (!(contextTime! > 0 && performanceTime! > 0)) return;
          const fit = clock.push(contextTime! * 1000, performance.timeOrigin + performanceTime!);
          if (fit) publisher.push(fit, performance.now());
        }, 20);
        calibrator = new Worker(new URL("./calibration-worker.ts", import.meta.url), { type: "module" });
        const calibration = new Promise<Calibration>((resolve, reject) => {
          cancelCalibration = () => reject(new Error("Stopped"));
          calibrator!.onmessage = ({ data }: MessageEvent<Calibration | { error: string }>) => {
            calibrator?.terminate(); cancelCalibration = undefined;
            if ("error" in data) reject(new Error(data.error)); else resolve(data);
          };
          calibrator!.onerror = () => reject(new Error("Live audio could not measure rendering cost."));
          calibrator!.postMessage({ sampleRate: context!.sampleRate, quantum });
        });
        const [measured] = await Promise.all([calibration, context.audioWorklet.addModule(workletUrl)]);
        if (stopped) return;
        node = new AudioWorkletNode(context, "couch-live", { numberOfInputs: 0, outputChannelCount: [2], processorOptions: { calibration: measured } });
        node.onprocessorerror = () => { if (!stopped) fail("Live audio's renderer stopped."); };
        node.port.onmessage = ({ data }: MessageEvent<WorkletStats>) => {
          if (stopped || !context) return;
          post({ type: "stats", stats: { ...data, outputLatencyMs: (context.outputLatency ?? 0) * 1000,
            baseLatencyMs: context.baseLatency * 1000, renderQuantum: data.interp.quantum } });
        };
        node.port.postMessage({ type: "port", port: channel.port2 }, [channel.port2]);
        if (pendingOutput) { node.port.postMessage({ type: "clock", fit: pendingOutput }); pendingOutput = null; }
        node.connect(context.destination);
      } catch (error) { if (!stopped) fail(error instanceof Error ? error.message : "Live audio could not start."); }
    },
    stop() { if (!stopped) { cleanup(); state({ state: "stopped" }); } },
  };
}
