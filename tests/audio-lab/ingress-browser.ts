// Bun.build({ entrypoints:[this file], target:"browser", format:"iife" }).
// Inject the bundle into the already paired, secure-context Couch worker.
import { SendspinPlayer } from "@sendspin/sendspin-js";

const worklet = `
class LabCapture extends AudioWorkletProcessor {
  constructor(options) {
    super(); this.size = options.processorOptions.frames; this.at = 0;
    this.buffer = new ArrayBuffer(16 + this.size * 4); this.view = new DataView(this.buffer);
    this.credits = 2; this.dropped = 0; this.running = true;
    this.discontinuities = 0; this.missingSamples = 0; this.discardedSamples = 0; this.emptyInputBlocks = 0;
    this.skipUntil = 0;
    this.port.onmessage = ({ data }) => { if (data === 'ack') this.credits++; else this.running = false; };
  }
  process(inputs) {
    if (!this.running) return false;
    const input = inputs[0]?.[0];
    if (!input?.length) { this.emptyInputBlocks++; return true; }
    this.origin ??= currentFrame;
    if (this.nextFrame !== undefined && currentFrame !== this.nextFrame) {
      if (currentFrame < this.nextFrame) {
        this.port.postMessage({ error:'Capture sample clock moved backwards', expected:this.nextFrame, actual:currentFrame });
        this.running = false; return false;
      }
      this.discontinuities++; this.missingSamples += currentFrame - this.nextFrame;
      this.discardedSamples += this.at; this.at = 0;
      // Never splice across a gap or move the packet grid. Drop the incomplete
      // packet and resume at the next boundary on the original sample timeline.
      this.skipUntil = this.origin + Math.ceil((currentFrame - this.origin) / this.size) * this.size;
    }
    this.nextFrame = currentFrame + input.length;
    for (let index = 0; index < input.length; index++) {
      if (currentFrame + index < this.skipUntil) { this.discardedSamples++; continue; }
      if (!this.at) this.first = currentFrame + index;
      const value = Math.max(-1, Math.min(1, input[index]));
      const pcm = Math.round(value * (value < 0 ? 32768 : 32767));
      this.view.setInt16(16 + this.at * 4, pcm, true);
      this.view.setInt16(18 + this.at * 4, pcm, true);
      if (++this.at === this.size) {
        if (this.credits > 0) {
          this.credits--;
          this.port.postMessage({ buffer:this.buffer, first:this.first, dropped:this.dropped,
            discontinuities:this.discontinuities, missingSamples:this.missingSamples,
            discardedSamples:this.discardedSamples, emptyInputBlocks:this.emptyInputBlocks,
            quantumFrames:input.length }, [this.buffer]);
          this.buffer = new ArrayBuffer(16 + this.size * 4); this.view = new DataView(this.buffer);
        } else this.dropped++;
        this.at = 0;
      }
    }
    return true;
  }
}
registerProcessor('couch-lab-capture', LabCapture);`;

async function publish(options: { origin: string; token?: string; packetMs: 10 | 20; deviceId?: string }) {
  const token = options.token ?? localStorage.getItem("couch.remote-token");
  if (!token || ![10, 20].includes(options.packetMs)) throw new Error("Paired publisher token and 10/20 ms packets required");
  const url = new URL("/__lab/pcm", options.origin); url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  const socket = new WebSocket(url);
  let context: AudioContext | undefined, stream: MediaStream | undefined, node: AudioWorkletNode | undefined;
  let stopped = false, durationTimer: ReturnType<typeof setTimeout> | undefined;
  let clockTimer: ReturnType<typeof setInterval> | undefined;
  const stats = { sentFrames: 0, droppedAtWorklet: 0, droppedAtSocket: 0, maxSocketBytes: 0,
    sourceClock: "AudioContext sample counter, fixed measured render-clock phase envelope, min-RTT server clock map",
    sourceClockBound: "Observed acquisition envelope, rechecked before send; not a hardware capture-time guarantee",
    inputPipelineUncertaintyUs: null, // No input-hardware timestamp API. Common-graph PCM measures this path.
    clockRttUs: 0, mappingUncertaintyUs: 0, sourceOriginUs: 0, firstSample: 0, sourceClockResidualMaxUs: 0,
    clockAcquisition: { status: "waiting", durationMs: 1000, intervalMs: 5, minimumSamples: 100, samples: 0,
      measuredDurationMs: 0, observedRangeUs: 0, requiredUncertaintyUs: 0 },
    discardedDuringClockAcquisition: 0, publishedSampleStarts: [] as number[],
    sampleStarts: [] as number[], sourceDiscontinuities: 0, missingInputSamples: 0,
    discardedAtDiscontinuitySamples: 0, emptyInputBlocks: 0, graphQuantumFrames: 0,
    error: null as string | null, stopped: false };
  async function stop() {
    if (stopped) return; stopped = stats.stopped = true;
    clearTimeout(durationTimer); clearInterval(clockTimer);
    node?.port.postMessage("stop"); node?.disconnect();
    stream?.getTracks().forEach(track => track.stop());
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "stop" }));
    socket.close();
    await context?.close();
  }
  socket.addEventListener("close", event => {
    if (!stopped) stats.error = `Source socket closed: ${event.code} ${event.reason}`;
    void stop();
  });
  const waitMessage = (type: string) => new Promise<any>((resolve, reject) => {
    const timer = setTimeout(() => done(new Error(`Ingress ${type} timeout`)), 5000);
    function done(error?: Error, value?: unknown) {
      clearTimeout(timer); socket.removeEventListener("message", onMessage); socket.removeEventListener("close", onClose);
      if (error) reject(error); else resolve(value);
    }
    function onMessage(event: MessageEvent) { const value = JSON.parse(event.data); if (value.type === type) done(undefined, value); }
    function onClose() { done(new Error(`Ingress closed during ${type}`)); }
    socket.addEventListener("message", onMessage); socket.addEventListener("close", onClose);
  });
  try {
    const ready = waitMessage("ready");
    socket.addEventListener("open", () => socket.send(JSON.stringify({ type: "auth", token })), { once: true });
    const hello = await ready;
    if (hello.packetMs !== options.packetMs) throw new Error("Packet duration differs from server");
    let best = { rttUs: Infinity, offsetUs: 0 };
    for (let index = 0; index < 8; index++) {
      const reply = waitMessage("sync"), sentUs = performance.now() * 1000;
      socket.send(JSON.stringify({ type: "sync", sentUs }));
      const sync = await reply, receivedUs = performance.now() * 1000;
      const rttUs = receivedUs - sentUs - (sync.sentServerUs - sync.receivedUs);
      if (rttUs >= 0 && rttUs < best.rttUs) best = { rttUs, offsetUs: (sync.receivedUs - sentUs + sync.sentServerUs - receivedUs) / 2 };
    }
    stats.clockRttUs = best.rttUs;
    stream = await navigator.mediaDevices.getUserMedia({ video: false, audio: {
      ...(options.deviceId ? { deviceId: { exact: options.deviceId } } : {}),
      sampleRate: 48_000, channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: false,
      latency: 0,
    } as MediaTrackConstraints });
    if (stopped) { stream.getTracks().forEach(track => track.stop()); throw new Error("Publisher closed while requesting capture"); }
    context = new AudioContext({ sampleRate: 48_000, latencyHint: "interactive" });
    await context.resume();
    if (context.sampleRate !== 48_000) throw new Error("Experiment requires 48 kHz AudioContext");
    const blob = URL.createObjectURL(new Blob([worklet], { type: "text/javascript" }));
    try { await context.audioWorklet.addModule(blob); } finally { URL.revokeObjectURL(blob); }
    node = new AudioWorkletNode(context, "couch-lab-capture", { processorOptions: { frames: options.packetMs * 48 } });
    let started = false, audioToServerUs = 0;
    let acquisitionAtUs = 0, minOffsetUs = Infinity, maxOffsetUs = -Infinity, quantumUs = 0;
    function readClock() {
      const before = performance.now() * 1000, audioTime = context!.currentTime, after = performance.now() * 1000;
      return { before, after, offsetUs: (before + after) / 2 + best.offsetUs - audioTime * 1e6 };
    }
    function acquireClock() {
      const { before, after, offsetUs } = readClock(), acquisition = stats.clockAcquisition;
      minOffsetUs = Math.min(minOffsetUs, offsetUs - (after - before) / 2);
      maxOffsetUs = Math.max(maxOffsetUs, offsetUs + (after - before) / 2);
      acquisition.samples++; acquisition.measuredDurationMs = (after - acquisitionAtUs) / 1000;
      acquisition.observedRangeUs = maxOffsetUs - minOffsetUs;
      acquisition.requiredUncertaintyUs = acquisition.observedRangeUs / 2 + best.rttUs / 2 + quantumUs;
      if (acquisition.measuredDurationMs < acquisition.durationMs) return;
      clearInterval(clockTimer);
      if (acquisition.samples < acquisition.minimumSamples || !Number.isFinite(acquisition.requiredUncertaintyUs) || acquisition.requiredUncertaintyUs > 10_000) {
        acquisition.status = "unsupported";
        stats.error = acquisition.samples < acquisition.minimumSamples ? "Source clock acquisition has too few samples"
          : `Source render clock cannot support 10 ms mapping: observed range ${Math.round(acquisition.observedRangeUs)} us, required uncertainty ${Math.round(acquisition.requiredUncertaintyUs)} us`;
        void stop(); return;
      }
      // This is an observed render-clock envelope, not an input timestamp API.
      // getOutputTimestamp maps output-device playout, a different time domain;
      // subtracting outputLatency would not establish capture/render time.
      audioToServerUs = (minOffsetUs + maxOffsetUs) / 2;
      stats.mappingUncertaintyUs = acquisition.requiredUncertaintyUs;
      stats.sourceClockResidualMaxUs = acquisition.observedRangeUs / 2;
      acquisition.status = "qualified";
    }
    node.port.onmessage = ({ data }: MessageEvent<{ buffer: ArrayBuffer; first: number; dropped: number;
      discontinuities: number; missingSamples: number; discardedSamples: number; emptyInputBlocks: number;
      quantumFrames: number; error?: string; expected?: number; actual?: number }>) => {
      if (data.error) { stats.error = `${data.error}: expected ${data.expected}, got ${data.actual}`; void stop(); return; }
      node!.port.postMessage("ack");
      if (stopped || socket.readyState !== WebSocket.OPEN) return;
      stats.droppedAtWorklet = data.dropped;
      if (stats.sampleStarts.length < 16) stats.sampleStarts.push(data.first);
      stats.sourceDiscontinuities = data.discontinuities; stats.missingInputSamples = data.missingSamples;
      stats.discardedAtDiscontinuitySamples = data.discardedSamples; stats.emptyInputBlocks = data.emptyInputBlocks;
      stats.graphQuantumFrames = data.quantumFrames;
      if (stats.clockAcquisition.status !== "qualified") {
        quantumUs = Math.max(quantumUs, data.quantumFrames / 48_000 * 1e6);
        stats.discardedDuringClockAcquisition++;
        if (stats.clockAcquisition.status === "waiting") {
          stats.clockAcquisition.status = "acquiring"; acquisitionAtUs = performance.now() * 1000;
          acquireClock(); clockTimer = setInterval(acquireClock, stats.clockAcquisition.intervalMs);
        }
        return;
      }
      stats.maxSocketBytes = Math.max(stats.maxSocketBytes, socket.bufferedAmount);
      // At most two packets may wait in either JS handoff. Never preserve a
      // backlog to replay when the main thread or source link catches up.
      if (socket.bufferedAmount > data.buffer.byteLength * 2) {
        stats.droppedAtSocket++; stats.error = "Publisher socket byte budget"; void stop(); return;
      }
      const clock = readClock(), residual = Math.abs(clock.offsetUs - audioToServerUs) + (clock.after - clock.before) / 2;
      stats.sourceClockResidualMaxUs = Math.max(stats.sourceClockResidualMaxUs, residual);
      if (residual > stats.mappingUncertaintyUs || data.quantumFrames / 48_000 * 1e6 > quantumUs) {
        stats.clockAcquisition.status = "invalidated";
        stats.error = "Source render clock exceeded the acquired mapping bound"; void stop(); return;
      }
      if (!started) {
        started = true; stats.firstSample = data.first;
        stats.sourceOriginUs = data.first / 48_000 * 1e6 + audioToServerUs;
        socket.send(JSON.stringify({ type: "start", firstSample: data.first, originUs: stats.sourceOriginUs, uncertaintyUs: stats.mappingUncertaintyUs }));
      }
      const view = new DataView(data.buffer);
      view.setUint32(0, 0x314d4350, true); view.setUint32(4, hello.generation, true); view.setFloat64(8, data.first, true);
      socket.send(data.buffer); stats.sentFrames++;
      if (stats.publishedSampleStarts.length < 16) stats.publishedSampleStarts.push(data.first);
    };
    context.createMediaStreamSource(stream).connect(node);
    // The node's silent output keeps capture processing live without feedback.
    node.connect(context.destination);
    stream.getAudioTracks()[0]!.addEventListener("ended", () => { void stop(); });
    durationTimer = setTimeout(() => { stats.error = "Bounded experiment duration ended"; void stop(); }, 130_000);
    return { stop, snapshot: () => ({ ...stats, trackSettings: stream!.getAudioTracks()[0]!.getSettings(),
      contextSampleRate: context!.sampleRate, baseLatency: context!.baseLatency, outputLatency: context!.outputLatency,
      packetMs: options.packetMs, channels: "mono duplicated to stereo", codec: "pcm-s16le" }) };
  } catch (error) { await stop(); throw error; }
}

async function receive(options: { origin: string; requiredLeadTimeMs?: number; minBufferMs?: number; outputCompensation?: boolean }) {
  const player = new SendspinPlayer({ baseUrl: options.origin, clientName: "Couch PCM lab receiver", productName: "Couch test-only experiment",
    suite: "aesgcm", storage: localStorage, codecs: ["pcm"], syncDelay: 0,
    requiredLeadTimeMs: options.requiredLeadTimeMs ?? 10, minBufferMs: options.minBufferMs ?? 10,
    useOutputLatencyCompensation: options.outputCompensation ?? true, reconnect: { maxAttempts: 0 } });
  try { await player.unlock(); await player.connect(); }
  catch (error) { player.disconnect("user_request"); throw error; }
  return { stop: () => player.disconnect("user_request"), snapshot: () => ({ id: player.clientId, connected: player.isConnected,
    playing: player.isPlaying, format: player.currentFormat, timeSync: player.timeSyncInfo, sync: player.syncInfo,
    requiredLeadTimeMs: options.requiredLeadTimeMs ?? 10, minBufferMs: options.minBufferMs ?? 10,
    outputCompensation: options.outputCompensation ?? true, sdk: "@sendspin/sendspin-js@5.0.0" }) };
}

Object.assign(window, { __ingressLab: { publish, receive } });
