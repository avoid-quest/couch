import { line, type ClockFit, type ClockPoint } from "./line";

export class CaptureClock {
  private anchors: ClockPoint[] = [];
  private received = 0;
  push(captureUs: number, position: number): ClockFit | null {
    this.anchors.push([captureUs, position]);
    // Keep a time span: 2,000 samples at 400 packets/s never span the 5 s drift gate.
    while (captureUs - this.anchors[0]![0] > 10e6) this.anchors.shift();
    return ++this.received < 25 || this.received % 25 === 0 ? line(this.anchors, 5e6, 0.048) : null;
  }
}
export class ServerClock {
  private pings: { mid: number; server: number; rtt: number }[] = [];
  fit: ClockFit = { x0: 0, y0: 0, slope: 1 };
  ready = false;
  get rttMinMs() { return this.pings.length ? Math.min(...this.pings.map(p => p.rtt)) : null; }
  push(sentMs: number, serverUs: number, backMs: number) {
    if (![sentMs, serverUs, backMs].every(Number.isFinite) || backMs < sentMs || backMs - sentMs > 10_000) return null;
    this.pings.push({ mid: (sentMs + backMs) / 2, server: serverUs / 1000, rtt: backMs - sentMs });
    if (this.pings.length > 200) this.pings.shift();
    const cut = this.pings.map(p => p.rtt).sort((a, b) => a - b)[Math.floor(this.pings.length / 3)]!;
    this.fit = line(this.pings.filter(p => p.rtt <= cut).map(p => [p.mid, p.server]), 5000);
    this.ready = this.pings.length >= 3;
    return this.fit;
  }
  now(epochMs: number) { return this.fit.y0 + this.fit.slope * (epochMs - this.fit.x0); }
}
