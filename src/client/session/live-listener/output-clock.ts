import { line, type ClockFit, type ClockPoint } from "./line";

export class OutputClock {
  private points: ClockPoint[] = [];
  push(contextMs: number, epochMs: number) {
    if (!Number.isFinite(contextMs) || !Number.isFinite(epochMs)) return null;
    this.points.push([contextMs, epochMs]);
    // 500 observations at the page's 50 Hz poll: the validated 10 s offset-only median.
    if (this.points.length > 500) this.points.shift();
    return line(this.points, Infinity);
  }
}

export class OutputClockPublisher {
  private sent: number | null = null;
  private message = { type: "clock" as const, fit: { x0: 0, y0: 0, slope: 1 } };
  constructor(private port: { postMessage(message: { type: "clock"; fit: ClockFit }): void }) {}
  push(fit: ClockFit, now: number) {
    const previous = this.message.fit;
    // Compare lines at the newest context and one second ahead, not their moving origins.
    const shift = fit.y0 - (previous.y0 + previous.slope * (fit.x0 - previous.x0));
    const moved = Math.max(Math.abs(shift), Math.abs(shift + (fit.slope - previous.slope) * 1000)) >= 0.05;
    if (this.sent !== null && now - this.sent < 1000 && !(now - this.sent >= 500 && moved)) return;
    Object.assign(previous, fit);
    this.port.postMessage(this.message);
    this.sent = now;
  }
}
