import type { ClockFit } from "./line";
import type { Calibration, Interpolation, LeadCommand, ProcessorMessage, Recycle, RenderStats, Stretch, WorkletStats } from "./types";

// 64-tap Kaiser-windowed sinc, 512 phases; flat to approximately 19 kHz at 48 kHz.
const TAPS = 32,
  PHASES = 512,
  CUTOFF = 0.92,
  BETA = 8.6;
const i0 = (x: number) => {
  let sum = 1,
    term = 1;
  for (let k = 1; k < 30; k++) {
    term *= (x / (2 * k)) ** 2;
    sum += term;
  }
  return sum;
};
const WINDOW = i0(BETA);
const KERNEL = new Float32Array((PHASES + 1) * 2 * TAPS);
for (let p = 0; p <= PHASES; p++) {
  let total = 0;
  const row = p * 2 * TAPS;
  for (let j = 0; j < 2 * TAPS; j++) {
    const x = j - (TAPS - 1) - p / PHASES,
      w = Math.abs(x) < TAPS ? i0(BETA * Math.sqrt(1 - (x / TAPS) ** 2)) / WINDOW : 0;
    KERNEL[row + j] = (x === 0 ? CUTOFF : Math.sin(Math.PI * CUTOFF * x) / (Math.PI * x)) * w;
    total += KERNEL[row + j]!;
  }
  for (let j = 0; j < 2 * TAPS; j++) KERNEL[row + j] = KERNEL[row + j]! / total;
}

interface Splice {
  shift: number;
  at: number;
  length: number;
  source: number;
  jump: boolean;
  synthetic: boolean;
}
export interface ProcessorSink {
  report(stats: WorkletStats): void;
  recycle(message: Recycle, transfer: Transferable[]): void;
}

// Browser-independent DSP, shared by the worklet, calibration Worker and deterministic tests.
// All audio storage is allocated here, before rendering starts.
export class LiveProcessor {
  readonly N = 1 << 16;
  ring = new Float32Array(this.N * 2);
  stamps = new Float64Array(this.N).fill(NaN);
  meta = new Float64Array(16);
  frame = 0;
  read: number | null = null;
  nu = 1;
  integral = 0;
  synced = 0;
  settling = true;
  b = 0;
  catchRate = 0;
  driftRate = 1;
  recoveryStart: number | null = null;
  splice: Splice | null = null;
  spliceState: Splice = { shift: 0, at: 0, length: 0, source: 0, jump: false, synthetic: false };
  nextStretch = 0;
  readonly pitchLimit = 0.02;
  readonly stretchRate = 0.2;
  readonly recoverySeconds = 8;
  readonly catchupSettle = 0.25;
  readonly rateSlew: number;
  readonly stretchWindow: number;
  readonly jumpWindow: number;
  readonly stretchMin: number;
  readonly stretchMax: number;
  readonly minPeriod: number;
  readonly maxPeriod: number;
  readonly match: number;
  readonly overlap: number;
  readonly merge: number;
  readonly H: number;
  readonly history: Float32Array;
  readonly seed: Float32Array;
  readonly fast: { kp: number; ki: number };
  readonly slow: { kp: number; ki: number };
  readonly searchStep = 8;
  historyAt = 0;
  historyCount = 0;
  gap = 0;
  age = 0;
  merging = 0;
  period = 0;
  lastL = 0;
  lastR = 0;
  fillL = 0;
  fillR = 0;
  meanL = 0;
  meanR = 0;
  bridgeL = 0;
  bridgeR = 0;
  fadeFrames = 0;
  hermite = true;
  interp: Interpolation = { mode: "hermite", reason: "calibration", quantum: 0 };
  stretch: Stretch = { mode: "rate", reason: "calibration" };
  leads: LeadCommand[] = [];
  leadTarget = 0;
  lastReport = 0;
  audioMessages = 0;
  audioFrames = 0;
  stats: RenderStats = {
    missing: 0,
    resyncs: 0,
    played: 0,
    errMin: Infinity,
    errMax: -Infinity,
    ratePpm: 0,
    marginMinMs: Infinity,
    concealed: 0,
    concealEvents: 0,
    concealLongest: 0,
    frame: 0,
    debtMs: 0,
    debtMinMs: Infinity,
    debtMaxMs: -Infinity,
    holdMs: 0,
    stretchMs: 0,
    rateCatchUpMs: 0,
    crossfadeJumps: 0,
    spliceAttempts: 0,
    spliceRejected: 0,
    splices: 0,
    clockShiftMs: 0,
    leadShiftMs: 0,
    holdDebtMs: 0,
    driftCorrectionMs: 0,
    crossfadeMs: 0,
    deadlineMarginMinMs: Infinity,
    needMs: 0,
    unavoidableDebtMs: 0,
    recoverableDebtMs: 0,
    audioMessages: 0,
    audioFrames: 0,
  };
  readonly report: WorkletStats;
  private recycle: Recycle = { type: "recycle", data: null! };
  private recycleTransfer: Transferable[] = [null!];

  constructor(
    readonly sampleRate: number,
    readonly calibration: Calibration | null,
    private sink: ProcessorSink,
  ) {
    const frames = (ms: number) => Math.max(1, Math.round((ms * sampleRate) / 1000));
    this.rateSlew = 0.04 / sampleRate;
    this.stretchWindow = this.stretchMax = frames(12);
    this.jumpWindow = frames(20);
    this.stretchMin = frames(2);
    this.minPeriod = frames(2);
    this.maxPeriod = frames(15);
    this.match = frames(4);
    this.overlap = frames(1);
    this.merge = frames(8);
    this.H = 2 * this.maxPeriod + this.match + this.overlap;
    this.history = new Float32Array(this.H * 2);
    this.seed = new Float32Array(this.H * 2);
    const gains = (wn: number) => ({ kp: (2 * wn) / sampleRate, ki: (wn * wn) / sampleRate });
    this.fast = gains(0.32);
    this.slow = gains(0.1);
    this.report = { ...this.stats, interp: this.interp, stretch: this.stretch, leadMs: 0 };
    this.applyCalibration(calibration?.quantum ?? 128);
  }

  message(data: ProcessorMessage) {
    switch (data.type) {
      case "reset": {
        const outputReady = this.meta[11]!;
        this.stamps.fill(NaN);
        this.meta.fill(0, 0, 3);
        this.meta.fill(0, 6);
        this.meta[11] = outputReady;
        this.read = null;
        this.nu = 1;
        this.integral = this.synced = 0;
        this.settling = true;
        this.history.fill(0);
        this.seed.fill(0);
        this.historyAt = this.historyCount = this.gap = this.age = this.merging = this.period = 0;
        this.lastL = this.lastR = this.fillL = this.fillR = 0;
        this.leads.length = 0;
        this.leadTarget = 0;
        this.b = this.catchRate = this.nextStretch = 0;
        this.driftRate = 1;
        this.splice = null;
        this.recoveryStart = null;
        this.audioMessages = this.audioFrames = 0;
        this.lastReport = this.frame;
        this.reset();
        break;
      }
      case "clock":
        this.clock(3, data.fit);
        break;
      case "audio": {
        // Fits and readiness arrive in the same ordered envelope as their samples.
        if (data.capture) this.clock(0, data.capture);
        if (data.server) this.clock(6, data.server);
        this.meta[10] = Number(data.ready);
        this.audioMessages++;
        this.audioFrames += data.frames;
        for (let i = 0; i < data.frames; i++) {
          const p = data.position + i,
            at = ((p % this.N) + this.N) % this.N;
          this.ring[at * 2] = data.data[i * 2]!;
          this.ring[at * 2 + 1] = data.data[i * 2 + 1]!;
          this.stamps[at] = p;
        }
        this.meta[12] = Math.max(this.meta[12]!, data.position + data.frames);
        this.recycle.data = data.data;
        this.recycleTransfer[0] = data.data.buffer;
        this.sink.recycle(this.recycle, this.recycleTransfer);
        this.recycle.data = null!;
        this.recycleTransfer[0] = null!;
        break;
      }
      case "lead":
        if (data.atServerUs === undefined) {
          this.leads.length = 0;
          this.leadTarget = data.leadMs;
          if (this.read === null) this.setLead(data.leadMs);
        } else {
          this.leads.push(data);
          this.leads.sort((a, b) => a.atServerUs! - b.atServerUs!);
        }
        break;
      case "slow":
        this.hermite = true;
        this.interp.mode = "hermite";
        this.interp.reason = this.stretch.reason = "falling behind";
        this.stretch.mode = "rate";
        break;
    }
  }

  clock(at: 0 | 3 | 6, fit: ClockFit) {
    const before = this.read === null ? null : this.target(this.frame);
    this.meta[at] = fit.x0;
    this.meta[at + 1] = fit.y0;
    this.meta[at + 2] = fit.slope;
    if (before !== null) {
      const shift = this.target(this.frame) - before;
      this.stats.clockShiftMs += (shift / this.sampleRate) * 1000;
      if (Math.abs(shift) > this.sampleRate * 0.001) this.b += shift;
    }
    if (at === 3) this.meta[11] = 1;
  }

  applyCalibration(n: number) {
    const c = this.calibration,
      budget = (n / this.sampleRate) * 1000;
    if (this.interp.reason !== "falling behind") this.hermite = !c || !((c.interp.costMs.sinc * n) / c.quantum < budget / 2);
    this.interp.mode = this.hermite ? "hermite" : "sinc";
    this.interp.quantum = n;
    if (this.stretch.reason !== "falling behind") {
      const render = c ? (c.interp.costMs[this.interp.mode] * n) / c.quantum : Infinity;
      this.stretch.mode = c && c.stretch.costMs + 2 * render < budget / 2 ? "wsola" : "rate";
    }
  }

  reset() {
    const s = this.stats;
    for (const key of Object.keys(s) as (keyof RenderStats)[]) s[key] = 0;
    s.errMin = s.marginMinMs = s.debtMinMs = s.deadlineMarginMinMs = Infinity;
    s.errMax = s.debtMaxMs = -Infinity;
  }
  setLead(lead: number) {
    if (this.read !== null) {
      const shift = -(lead - this.meta[9]!) * 1000 * this.meta[2]!;
      this.stats.leadShiftMs += (shift / this.sampleRate) * 1000;
      this.b += shift;
    }
    this.meta[9] = lead;
  }
  target(frame: number) {
    const m = this.meta,
      contextMs = (frame / this.sampleRate) * 1000;
    const epoch = m[4]! + m[5]! * (contextMs - m[3]!),
      server = m[7]! + m[8]! * (epoch - m[6]!);
    return m[1]! + m[2]! * ((server - m[9]!) * 1000 - m[0]!);
  }
  process(left: Float32Array, right: Float32Array, frame: number) {
    this.frame = frame;
    const n = left.length,
      m = this.meta;
    if (this.interp.quantum !== n) this.applyCalibration(n);
    if (!m[10]! || !m[11]! || !m[2]!) return;
    const epoch = m[4]! + m[5]! * ((frame / this.sampleRate) * 1000 - m[3]!);
    const serverUs = (m[7]! + m[8]! * (epoch - m[6]!)) * 1000;
    while (this.leads.length && this.leads[0]!.atServerUs! <= serverUs) this.leadTarget = this.leads.shift()!.leadMs;
    // Operator lead changes move at 2 ms/s; recovery retains its separate fast budget.
    const step = (2 * n) / this.sampleRate;
    this.setLead(m[9]! + Math.max(-step, Math.min(step, this.leadTarget - m[9]!)));
    this.processElastic(left, right, this.target(frame));
  }
  sinc(p: number, c: number, checked: boolean) {
    const i = Math.floor(p),
      N = this.N,
      r = this.ring,
      row = Math.round((p - i) * PHASES) * 2 * TAPS;
    let sum = 0;
    for (let j = 0; j < 2 * TAPS; j++) {
      const k = i - (TAPS - 1) + j,
        at = ((k % N) + N) % N;
      if (!checked && !this.has(k, at)) return null;
      sum += r[at * 2 + c]! * KERNEL[row + j]!;
    }
    return sum;
  }
  has(k: number, at: number) {
    return this.stamps[at]! === k;
  }
  present(from: number, to: number) {
    const N = this.N;
    for (let k = from; k <= to; k++) if (!this.has(k, ((k % N) + N) % N)) return false;
    return true;
  }
  sample(p: number, c: number) {
    const i = Math.floor(p),
      f = p - i,
      N = this.N,
      r = this.ring;
    for (let k = i - 1; k <= i + 2; k++) if (!this.has(k, ((k % N) + N) % N)) return null;
    const y0 = r[((((i - 1) % N) + N) % N) * 2 + c]!,
      y1 = r[(((i % N) + N) % N) * 2 + c]!,
      y2 = r[((((i + 1) % N) + N) % N) * 2 + c]!,
      y3 = r[((((i + 2) % N) + N) % N) * 2 + c]!;
    // 4-point Hermite interpolation.
    return y1 + 0.5 * f * (y2 - y0 + f * (2 * y0 - 5 * y1 + 4 * y2 - y3 + f * (3 * (y1 - y2) + y3 - y0)));
  }
  matchPeriod(lag: number, stride: number) {
    let aa = 0,
      bb = 0,
      ab = 0,
      al = 0,
      ar = 0,
      bl = 0,
      br = 0,
      n = 0;
    for (let i = this.H - this.match; i < this.H; i += stride) {
      const a = i * 2,
        b = (i - lag) * 2,
        l = this.seed[a]!,
        r = this.seed[a + 1]!,
        x = this.seed[b]!,
        y = this.seed[b + 1]!;
      aa += l * l + r * r;
      bb += x * x + y * y;
      ab += l * x + r * y;
      al += l;
      ar += r;
      bl += x;
      br += y;
      n++;
    }
    return (2 * (ab - (al * bl + ar * br) / n)) / Math.max(1e-20, aa + bb - (al * al + ar * ar + bl * bl + br * br) / n);
  }
  expand() {
    const h = this.H,
      count = this.historyCount;
    for (let i = 0; i < h; i++) {
      const at = (this.historyAt + i) % h;
      this.seed[i * 2] = this.history[at * 2]!;
      this.seed[i * 2 + 1] = this.history[at * 2 + 1]!;
    }
    this.age = this.merging = this.period = 0;
    this.meanL = this.meanR = 0;
    let best = -Infinity;
    const max = Math.min(this.maxPeriod, count - this.match, Math.floor((count - this.overlap) / 2)),
      step = this.searchStep;
    for (let lag = this.minPeriod; lag <= max; lag += step) {
      const score = this.matchPeriod(lag, step);
      if (score > best) {
        best = score;
        this.period = lag;
      }
    }
    if (this.period) {
      const coarse = this.period;
      best = -Infinity;
      for (let lag = Math.max(this.minPeriod, coarse - step + 1); lag <= Math.min(max, coarse + step - 1); lag++) {
        const score = this.matchPeriod(lag, 1);
        if (score > best) {
          best = score;
          this.period = lag;
        }
      }
      for (let i = h - this.period; i < h; i++) {
        this.meanL += this.seed[i * 2]! / this.period;
        this.meanR += this.seed[i * 2 + 1]! / this.period;
      }
    }
    // Remove the period mean so a constant input cannot become a DC loop.
    // Elastic holds decay by 8.69 dB per 80 ms; taper below -81 dB to avoid an endless buzz.
    this.fadeFrames = this.sampleRate * 0.8;
    const prev = (h - this.period - 1) * 2;
    this.bridgeL = this.lastL - (this.period ? this.seed[prev]! - this.meanL : 0);
    this.bridgeR = this.lastR - (this.period ? this.seed[prev + 1]! - this.meanR : 0);
    this.historyCount = 0;
  }
  fill() {
    const t = this.age++,
      p = this.period,
      h = this.H;
    let l = 0,
      r = 0;
    if (p && t < this.fadeFrames) {
      const phase = t % p,
        at = (h - p + phase) * 2,
        overlap = Math.min(this.overlap, p),
        w = Math.max(0, (phase - (p - overlap)) / overlap);
      // Match a period, then overlap its tail with the preceding cycle; no raw block seam.
      l = this.seed[at]! * (1 - w) + this.seed[at - p * 2]! * w - this.meanL;
      r = this.seed[at + 1]! * (1 - w) + this.seed[at - p * 2 + 1]! * w - this.meanR;
    }
    const bridge = Math.max(0, 1 - t / this.overlap),
      gain = Math.exp(-t / (this.sampleRate * 0.08)) * Math.max(0, Math.min(1, (this.fadeFrames - t) / (this.sampleRate * 0.05)));
    this.fillL = l * gain + this.bridgeL * bridge;
    this.fillR = r * gain + this.bridgeR * bridge;
  }
  spliceScore(p: number, shift: number, stride: number, w = this.stretchWindow) {
    let aa = 0,
      bb = 0,
      ab = 0,
      a0 = 0,
      a1 = 0,
      b0 = 0,
      b1 = 0;
    const r = this.ring,
      N = this.N;
    for (let i = 0; i < w; i += stride) {
      const a = ((((p + i) % N) + N) % N) * 2,
        b = ((((p + i + shift) % N) + N) % N) * 2;
      const l = r[a]!,
        h = r[a + 1]!,
        x = r[b]!,
        y = r[b + 1]!,
        ea = l * l + h * h,
        eb = x * x + y * y;
      aa += ea;
      bb += eb;
      ab += l * x + h * y;
      if (i < w / 2) {
        a0 += ea;
        b0 += eb;
      } else {
        a1 += ea;
        b1 += eb;
      }
    }
    if (Math.max(a0, a1) > 2 * Math.min(a0, a1) + 1e-10 || Math.max(b0, b1) > 2 * Math.min(b0, b1) + 1e-10) return -1;
    return aa + bb < 1e-12 ? 1 : (2 * ab) / (aa + bb);
  }
  findSplice(p: number, debt: number) {
    const sign = Math.sign(debt),
      max = Math.min(this.stretchMax, Math.floor(Math.abs(debt))),
      step = 8;
    let best = -1,
      lag = 0;
    for (let k = this.stretchMin; k <= max; k += step) {
      const score = this.spliceScore(p, sign * k, step);
      if (score > best) {
        best = score;
        lag = k;
      }
    }
    const coarse = lag;
    best = -1;
    for (let k = Math.max(this.stretchMin, coarse - step); k <= Math.min(max, coarse + step); k++) {
      const score = this.spliceScore(p, sign * k, 1);
      if (score > best) {
        best = score;
        lag = k;
      }
    }
    // 0.98 means normalized squared difference <=2%; reject noise/unstable attacks.
    if (best < 0.98) return 0;
    const lo = this.spliceScore(p, sign * (lag - 1), 1),
      hi = this.spliceScore(p, sign * (lag + 1), 1),
      curvature = lo - 2 * best + hi;
    const fraction = curvature < -1e-9 ? Math.max(-0.5, Math.min(0.5, (0.5 * (lo - hi)) / curvature)) : 0;
    return sign * Math.min(max, Math.max(this.stretchMin, lag + fraction));
  }
  beginSplice(shift: number, jump: boolean, synthetic = false) {
    const t = this.spliceState;
    t.shift = shift;
    t.at = 0;
    t.length = jump
      ? Math.max(this.jumpWindow, Math.ceil(-shift / Math.min(0.99, this.nu * (1 - this.pitchLimit) - 0.001)))
      : Math.max(Math.round(this.sampleRate * 0.004), Math.ceil(-shift / Math.min(0.99, this.nu * (1 - this.pitchLimit) - 0.001)));
    t.source = this.read!;
    t.jump = jump;
    t.synthetic = synthetic;
    this.splice = t;
    if (synthetic && !this.gap) this.expand();
    if (jump) {
      this.stats.crossfadeJumps++;
      this.nextStretch = this.frame + this.jumpWindow;
    } else {
      this.stats.splices++;
      this.nextStretch = this.frame + Math.ceil(Math.abs(shift) / this.stretchRate);
    }
  }
  span(p: number, len: number) {
    const support = this.hermite ? 2 : TAPS + 1;
    return this.present(Math.floor(p) - support, Math.ceil(p + len * (1 + this.pitchLimit + 0.003)) + support);
  }
  elasticSample(p: number, c: number) {
    return (this.hermite ? this.sample(p, c) : this.sinc(p, c, true))!;
  }
  processElastic(left: Float32Array, right: Float32Array, target: number) {
    const n = left.length,
      s = this.stats,
      support = this.hermite ? 2 : TAPS + 1;
    const slope = (this.meta[2]! * 1e6 * this.meta[8]! * this.meta[5]!) / this.sampleRate;
    if (this.read === null) {
      // Joining must wait for real interpolation support, not hold a cursor before the stream began.
      if (!this.span(target, n)) return;
      this.read = target;
      this.nu = this.driftRate = slope;
      this.synced = this.frame;
    }
    this.nu += ((slope - this.nu) * n) / (10 * this.sampleRate);
    const settling = this.frame - this.synced < 20 * this.sampleRate;
    if (!settling && this.settling) this.integral *= this.fast.ki / this.slow.ki;
    this.settling = settling;
    const e = target - this.read - this.b,
      g = settling ? this.fast : this.slow,
      demand = g.kp * e + g.ki * this.integral;
    // Conditional integration: intentional holds/splices/rate recovery never enter e.
    // Freeze during starvation or saturation, but keep observing residual clock error during recovery.
    if (!this.gap && Math.abs(demand) < 0.00025) this.integral += (e * n) / this.sampleRate;
    const drift = this.nu + Math.max(-0.00025, Math.min(0.00025, g.kp * e + g.ki * this.integral));
    const read = this.read;
    s.debtMinMs = Math.min(s.debtMinMs, ((target - read) / this.sampleRate) * 1000);
    s.debtMaxMs = Math.max(s.debtMaxMs, ((target - read) / this.sampleRate) * 1000);
    let margin;
    // Feasible phase = extra consumption * acceptable recovery time; age also bounds rejected splices.
    // Recover only toward audio that can actually be played. Leave one millisecond beyond the render quantum of
    // runway so a chronically late route is a stable late listener, not repeated starvation.
    const feasible = Math.min(
      target,
      this.meta[12]! - support - Math.ceil(n * slope * (1 + this.pitchLimit)) - Math.ceil(this.sampleRate * 0.001) - 1,
    );
    const unavailable = Math.max(0, target - feasible),
      recoveryDebt = this.b - unavailable;
    s.unavoidableDebtMs = (unavailable / this.sampleRate) * 1000;
    s.recoverableDebtMs = (recoveryDebt / this.sampleRate) * 1000;
    const capacity = (this.stretch.mode === "wsola" ? this.stretchRate : 0) + this.pitchLimit;
    const rampLoss = (this.pitchLimit * this.pitchLimit) / (2 * this.rateSlew * this.sampleRate);
    const bound = Math.max(0, capacity * this.recoverySeconds - rampLoss) * this.sampleRate;
    if (Math.abs(recoveryDebt) > this.sampleRate * 0.001) this.recoveryStart ??= this.frame;
    else this.recoveryStart = null;
    const expired = this.recoveryStart !== null && this.frame - this.recoveryStart > this.recoverySeconds * this.sampleRate;
    if (!this.splice && (Math.abs(recoveryDebt) > bound || expired) && this.span(feasible, n)) {
      this.beginSplice(feasible - this.read, true, !!(this.gap || this.merging) || !this.span(this.read, n));
    } else if (
      !this.splice &&
      !this.gap &&
      !this.merging &&
      this.stretch.mode === "wsola" &&
      Math.abs(recoveryDebt) > this.stretchMin &&
      this.frame >= this.nextStretch
    ) {
      s.spliceAttempts++;
      this.nextStretch = this.frame + Math.round(this.sampleRate * 0.02); // Rejected matches retry at most 50 Hz.
      const shift = Math.sign(recoveryDebt) * Math.min(this.stretchMax, Math.floor(Math.abs(recoveryDebt)));
      // Match the preceding stationary window, then overlap ahead. This avoids adding a full
      // 12 ms lookahead to the lag; negative actions have enough overlap to keep r monotonic.
      const windowStart = Math.floor(this.read) - this.stretchWindow;
      if (this.span(windowStart + Math.min(0, shift), this.stretchWindow + Math.abs(shift))) {
        const found = this.findSplice(windowStart, recoveryDebt),
          length = Math.max(this.sampleRate * 0.004, -found / Math.min(0.99, this.nu * (1 - this.pitchLimit) - 0.001));
        if (
          found &&
          this.span(Math.min(this.read, this.read + found), length + Math.abs(found)) &&
          this.spliceScore(Math.floor(this.read), Math.round(found), 1, Math.ceil(length)) >= 0.98
        )
          this.beginSplice(found, false);
      }
      if (!this.splice) s.spliceRejected++;
    }
    const available = !this.splice && this.span(this.read, n * 1.003),
      spliceAvailable =
        this.splice && this.span(this.splice.source + this.splice.shift, n) && (this.splice.synthetic || this.span(this.splice.source, n));
    for (let i = 0; i < n; i++) {
      const wanted = this.gap
        ? 0
        : Math.max(-this.pitchLimit, Math.min(this.pitchLimit, (this.b - unavailable) / (this.sampleRate * this.catchupSettle)));
      this.catchRate += Math.max(-this.rateSlew, Math.min(this.rateSlew, wanted - this.catchRate));
      const desired = Math.max(slope * (1 - this.pitchLimit), Math.min(slope * (1 + this.pitchLimit), drift + this.catchRate));
      this.driftRate += Math.max(-this.rateSlew, Math.min(this.rateSlew, desired - this.driftRate));
      const rate = this.driftRate,
        extra = rate - drift,
        t = this.splice;
      let l: number | null = null,
        r: number | null = null,
        advance = rate,
        removed = 0;
      if (t && (spliceAvailable || (this.span(t.source + t.shift, 0) && (t.synthetic || this.span(t.source, 0))))) {
        const pos = t.source,
          dest = pos + t.shift,
          w = t.at / (t.length - 1),
          mix = w * w * (3 - 2 * w);
        // Validate each quantum too: a last-resort fade can span later packet arrivals.
        if (t.synthetic) {
          this.fill();
          l = this.fillL;
          r = this.fillR;
        } else {
          l = this.elasticSample(pos, 0);
          r = this.elasticSample(pos, 1);
        }
        const a = this.elasticSample(dest, 0),
          b = this.elasticSample(dest, 1);
        l = l * (1 - mix) + a * mix;
        r = r * (1 - mix) + b * mix;
        removed = t.shift / t.length;
        advance += removed;
        t.source += rate;
        if (++t.at === t.length) {
          this.splice = null;
          if (t.jump) {
            this.recoveryStart = null;
            this.gap = 0;
            this.merging = 0;
          }
        }
      } else if (!t && (available || this.span(this.read, 0))) {
        l = this.elasticSample(this.read, 0);
        r = this.elasticSample(this.read, 1);
      }
      if (r === null) {
        if (!this.gap) {
          this.expand();
          s.concealEvents++;
        }
        this.gap++;
        s.missing++;
        s.concealed++;
        s.holdMs += 1000 / this.sampleRate;
        s.holdDebtMs += (slope / this.sampleRate) * 1000;
        s.concealLongest = Math.max(s.concealLongest, this.gap);
        this.fill();
        left[i] = this.lastL = this.fillL;
        right[i] = this.lastR = this.fillR;
        this.b += drift; // Hold r; do not label a period with no arrivals as clock drift.
      } else {
        left[i] = l!;
        right[i] = r;
        const at = this.historyAt * 2;
        this.history[at] = left[i]!;
        this.history[at + 1] = right[i]!;
        this.historyAt = (this.historyAt + 1) % this.H;
        this.historyCount = Math.min(this.H, this.historyCount + 1);
        if (this.gap && !t) {
          this.gap = 0;
          this.merging = this.merge;
        }
        if (this.merging && !t) {
          this.fill();
          const w = this.merging-- / this.merge;
          left[i] = this.fillL * w + left[i]! * (1 - w);
          right[i] = this.fillR * w + right[i]! * (1 - w);
        }
        this.lastL = left[i]!;
        this.lastR = right[i]!;
        this.read += advance;
        this.b -= extra + removed;
        s.driftCorrectionMs += ((drift - slope) / this.sampleRate) * 1000;
        s.rateCatchUpMs += (extra / this.sampleRate) * 1000;
        if (t && t.jump) s.crossfadeMs += (removed / this.sampleRate) * 1000;
        if (t && !t.jump) s.stretchMs += (removed / this.sampleRate) * 1000;
        s.played++;
      }
      const debt = ((target + (i + 1) * slope - this.read) / this.sampleRate) * 1000;
      s.debtMs = debt;
      s.debtMinMs = Math.min(s.debtMinMs, debt);
      s.debtMaxMs = Math.max(s.debtMaxMs, debt);
    }
    // Pair this quantum's margin and debt at the same endpoint, including holds and splice consumption.
    margin = this.meta[12]! - this.read - support;
    s.marginMinMs = Math.min(s.marginMinMs, (margin / this.sampleRate) * 1000);
    s.deadlineMarginMinMs = Math.min(s.deadlineMarginMinMs, (margin / this.sampleRate) * 1000 - s.debtMs);
    s.needMs = Math.max(s.needMs, this.meta[9]! - (margin / this.sampleRate) * 1000 + s.debtMs);
    s.errMin = Math.min(s.errMin, target - read);
    s.errMax = Math.max(s.errMax, target - read);
    s.ratePpm = (this.driftRate - 1) * 1e6;
    if (this.frame - this.lastReport >= this.sampleRate) {
      s.audioMessages = this.audioMessages;
      s.audioFrames = this.audioFrames;
      this.audioMessages = this.audioFrames = 0;
      s.frame = this.frame;
      Object.assign(this.report, s);
      this.report.interp = this.interp;
      this.report.stretch = this.stretch;
      this.report.leadMs = this.meta[9]!;
      this.sink.report(this.report);
      this.reset();
      this.lastReport = this.frame;
    }
    return true;
  }
}
