// A suspension or a background poll gap is not evidence that rendering is too expensive.
export class RenderProgress {
  private last: number | undefined;
  private start: [number, number] | null = null;
  private bad = 0;
  push(wallMs: number, contextMs: number, running: boolean, quantumMs: number) {
    if (!running || (this.last !== undefined && wallMs - this.last > 1500)) { this.start = null; this.bad = 0; }
    this.last = wallMs;
    if (!running) return null;
    if (!this.start) { this.start = [wallMs, contextMs]; return null; }
    if (wallMs - this.start[0] < 1000) return null;
    const lag = wallMs - this.start[0] - (contextMs - this.start[1]);
    this.start = [wallMs, contextMs];
    this.bad = lag > Math.max(50, 8 * quantumMs) ? this.bad + 1 : 0;
    return this.bad >= 2 ? lag : null;
  }
}
