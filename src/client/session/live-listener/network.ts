import { OpusDecoder } from "opus-decoder";
import { CaptureClock, ServerClock } from "./network-clock";
import { AudioBatches, type AudioPort } from "./transport";
import type { LeadCommand, ListenerConnection, NetworkStats, WorkerCommand, WorkerEvent } from "./types";

interface Socket {
  binaryType: string; readyState: number;
  onopen: ((event: Event) => void) | null;
  onmessage: ((event: MessageEvent<string | ArrayBuffer>) => void) | null;
  onerror: ((event: Event) => void) | null;
  onclose: ((event: CloseEvent) => void) | null;
  send(data: string): void;
  close(): void;
}
type Decoder = Pick<OpusDecoder<48000>, "ready" | "free" | "decodeFrame">;
export interface NetworkRuntime {
  now(): number;
  socket(url: string, protocols?: string[]): Socket;
  decoder(): Decoder;
  interval(callback: () => void, ms: number): () => void;
  timeout(callback: () => void, ms: number): () => void;
}
const browserRuntime: NetworkRuntime = {
  now: () => performance.timeOrigin + performance.now(),
  socket: (url, protocols) => new WebSocket(url, protocols),
  decoder: () => new OpusDecoder({ sampleRate: 48000, channels: 2 }),
  interval: (fn, ms) => { const id = setInterval(fn, ms); return () => clearInterval(id); },
  timeout: (fn, ms) => { const id = setTimeout(fn, ms); return () => clearTimeout(id); },
};

// Network and decoding run only in the Worker. The wire boundary stays here until Core wiring lands.
export class ListenerNetwork {
  readonly batches: AudioBatches;
  private socket: Socket | null = null;
  private decoder: Decoder | null = null;
  private opening = false;
  private generation = 0;
  private session: string | undefined;
  private epoch: string | number | undefined;
  private codec = 0;
  private retry = 0;
  private stopped = false;
  private cancelRetry: (() => void) | undefined;
  private timers: (() => void)[] = [];
  private capture = new CaptureClock();
  private server = new ServerClock();
  private captureRatePpm = 0;
  private pending: { position: number; frames: number; data: Uint8Array }[] = [];
  private leads: LeadCommand[] = [];
  private leadMs = 0;
  private arrivals: number[] = [];
  private gapMax = 0;
  private lastArrival: number | null = null;

  constructor(private connection: ListenerConnection, private port: AudioPort,
    private emit: (event: WorkerEvent) => void, private runtime = browserRuntime) {
    this.batches = new AudioBatches(port);
  }
  start() {
    this.connect();
    if (this.stopped) return;
    this.timers.push(this.runtime.interval(() => this.batches.flush(), 8), this.runtime.interval(() => this.ping(), 50));
  }
  stop() {
    this.stopped = true; this.generation++;
    this.cancelRetry?.(); this.cancelRetry = undefined;
    for (const cancel of this.timers) cancel();
    this.timers.length = 0;
    const socket = this.socket; this.socket = null; socket?.close();
    this.decoder?.free(); this.decoder = null; this.pending.length = 0;
  }
  stats(stats: Extract<WorkerCommand, { type: "stats" }>["stats"]) {
    const report = { ...stats, ...this.summary() };
    this.send({ type: "stats", ...report });
    this.emit({ type: "stats", stats: report });
  }
  private send(data: object) { if (this.socket?.readyState === 1) this.socket.send(JSON.stringify(data)); }
  private ping() { this.send({ type: "ping", t: this.runtime.now() }); }
  private fail(reason: string) { this.stop(); this.emit({ type: "state", value: { state: "failed", reason } }); }
  private connect() {
    if (this.stopped) return;
    let ws: Socket;
    try { ws = this.runtime.socket(this.connection.url, this.connection.protocols); }
    catch { this.fail("Live audio could not open its connection."); return; }
    this.socket = ws; ws.binaryType = "arraybuffer";
    ws.onopen = () => {
      if (this.socket !== ws) return;
      if (this.connection.auth) this.send(this.connection.auth);
      this.ping();
    };
    ws.onmessage = event => {
      if (this.socket !== ws) return;
      try {
        if (typeof event.data === "string") this.text(JSON.parse(event.data));
        else this.audio(event.data);
      } catch { this.fail("Live audio received an invalid stream."); }
    };
    ws.onerror = () => ws.close();
    ws.onclose = event => {
      if (this.socket !== ws) return;
      this.socket = null;
      if (event.code === 4001) {
        this.stop(); this.emit({ type: "state", value: { state: "removed", reason: event.reason || "Removed by the host" } }); return;
      }
      if (event.code === 4003 || event.code === 1008) { this.fail(event.reason || "Live audio is no longer authorized."); return; }
      this.emit({ type: "state", value: { state: "reconnecting" } });
      this.cancelRetry = this.runtime.timeout(() => this.connect(), Math.min(5000, 250 * 2 ** Math.min(this.retry++, 5)));
    };
  }
  private text(value: unknown) {
    if (!value || typeof value !== "object") return;
    const message = value as Record<string, unknown>;
    if (message.type === "hello") {
      if (typeof message.session !== "string" || !Number.isFinite(message.leadMs) || (message.codec !== 1 && message.codec !== 2)) throw new Error("Invalid hello");
      const epoch = typeof message.epoch === "string" || typeof message.epoch === "number" ? message.epoch : undefined;
      if (this.session !== message.session || this.epoch !== epoch || this.codec !== message.codec) {
        this.session = message.session; this.epoch = epoch; this.codec = message.codec; this.generation++;
        this.batches.reset(); this.capture = new CaptureClock(); this.server = new ServerClock();
        this.captureRatePpm = 0; this.arrivals.length = this.pending.length = this.leads.length = 0;
        this.gapMax = 0; this.lastArrival = null;
        this.decoder?.free(); this.decoder = null; this.opening = false;
      }
      this.leadMs = message.leadMs as number; this.leads.length = 0;
      this.port.postMessage({ type: "lead", leadMs: this.leadMs });
      if (this.codec === 2 && !this.decoder && !this.opening) void this.openDecoder();
      this.retry = 0;
      this.emit({ type: "state", value: { state: "preparing" } });
    } else if (message.type === "lead" && Number.isFinite(message.leadMs) && Number.isFinite(message.atServerUs)) {
      const lead: LeadCommand = { type: "lead", leadMs: message.leadMs as number, atServerUs: message.atServerUs as number };
      this.leads.push(lead); this.leads.sort((a, b) => a.atServerUs! - b.atServerUs!);
      this.port.postMessage(lead);
    } else if (message.type === "pong" && typeof message.t === "number" && typeof message.s === "number") {
      const ready = this.server.ready, fit = this.server.push(message.t, message.s, this.runtime.now());
      if (!fit) return;
      this.batches.server = fit; this.batches.ready = this.server.ready;
      if (!ready && this.server.ready) this.batches.flush();
    }
  }
  private audio(buffer: ArrayBuffer) {
    if (!this.session || buffer.byteLength < 24) throw new Error("Missing header");
    const view = new DataView(buffer), codec = view.getUint8(0), channels = view.getUint8(1);
    const frames = view.getUint16(2, true), position = view.getFloat64(8, true), captureUs = view.getFloat64(16, true);
    if (codec !== this.codec || channels !== 2 || !frames || frames > 5760 || !Number.isSafeInteger(position) || !Number.isFinite(captureUs)) throw new Error("Invalid packet");
    if (codec === 1 && buffer.byteLength !== 24 + frames * 4) throw new Error("Invalid PCM length");
    const now = this.runtime.now(), server = this.server.now(now);
    while (this.leads.length && this.leads[0]!.atServerUs! <= server * 1000) this.leadMs = this.leads.shift()!.leadMs;
    if (this.server.ready) {
      this.arrivals.push(captureUs / 1000 + this.leadMs - server);
      if (this.arrivals.length > 4096) this.arrivals.shift();
    }
    this.gapMax = Math.max(this.gapMax, now - (this.lastArrival ?? now)); this.lastArrival = now;
    const fit = this.capture.push(captureUs, position);
    if (fit) { this.batches.capture = fit; this.captureRatePpm = (fit.slope * 1e6 / 48000 - 1) * 1e6; }
    if (codec === 1) this.batches.write(position, frames, (i, c) => view.getInt16(24 + (i * 2 + c) * 2, true) / 32768);
    else if (this.decoder) this.decode(position, frames, new Uint8Array(buffer, 24));
    else {
      this.pending.push({ position, frames, data: new Uint8Array(buffer, 24) });
      if (this.pending.length > 400) this.pending.shift();
    }
  }
  private decode(position: number, frames: number, data: Uint8Array) {
    const decoded = this.decoder!.decodeFrame(data);
    if (decoded.errors.length || decoded.samplesDecoded !== frames || decoded.channelData.length !== 2) throw new Error("Invalid Opus frame");
    this.batches.write(position, frames, (i, c) => decoded.channelData[c]![i]!);
  }
  private async openDecoder() {
    const generation = this.generation;
    this.opening = true;
    let next: Decoder | undefined, ready = false;
    try {
      next = this.runtime.decoder(); await next.ready; ready = true;
      if (generation !== this.generation) { next.free(); return; }
      this.decoder = next; this.opening = false;
      for (const { position, frames, data } of this.pending.splice(0)) this.decode(position, frames, data);
    } catch {
      if (ready && next !== this.decoder) next?.free();
      if (generation === this.generation) this.fail("Live audio could not decode Opus.");
    }
  }
  private summary(): NetworkStats {
    const a = this.arrivals.splice(0).sort((x, y) => x - y);
    const q = (f: number) => a.length ? a[Math.min(a.length - 1, Math.floor(f * a.length))]! : null;
    const gap = this.gapMax; this.gapMax = 0;
    return { arrivalGapMaxMs: gap, packets: a.length, headroomMinMs: q(0), headroomP01Ms: q(0.01), headroomP50Ms: q(0.5),
      rttMinMs: this.server.rttMinMs, serverSlopePpm: (this.server.fit.slope - 1) * 1e6, captureRatePpm: this.captureRatePpm };
  }
}
