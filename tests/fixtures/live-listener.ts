import { LiveProcessor } from "../../src/client/session/live-listener/processor";
import type { Calibration, WorkletStats } from "../../src/client/session/live-listener/types";

export const sampleRate = 48000;
export const base = 100000;
export const calibration = (interp: "sinc" | "hermite" = "hermite", stretch = false): Calibration => ({
  quantum: 128, interp: { costMs: { sinc: interp === "sinc" ? 0.1 : 2, hermite: 0.01 } },
  stretch: { costMs: stretch ? 0.1 : 2 },
});
export function renderer(interp: "sinc" | "hermite" = "hermite", stretch = false) {
  const reports: WorkletStats[] = [];
  const processor = new LiveProcessor(sampleRate, calibration(interp, stretch), { report: s => reports.push(structuredClone(s)), recycle() {} });
  processor.message({ type: "clock", fit: { x0: 0, y0: 0, slope: 1 } });
  processor.clock(0, { x0: 0, y0: base + 0.371, slope: 0.048 });
  processor.clock(6, { x0: 0, y0: 0, slope: 1 });
  processor.meta[10] = 1;
  return { processor, reports };
}
export function publish(p: LiveProcessor, from: number, to: number) {
  const data = new Float32Array((to - from) * 2);
  for (let i = from; i < to; i++) {
    const t = (i - base) / sampleRate;
    // Stereo harmonic content with separate phase, like the prototype's bounded synthetic fixture.
    data[(i - from) * 2] = 0.2 * Math.sin(t * Math.PI * 880) + 0.04 * Math.sin(t * Math.PI * 1760);
    data[(i - from) * 2 + 1] = 0.2 * Math.sin(t * Math.PI * 880 + 0.3) + 0.04 * Math.sin(t * Math.PI * 1760 + 0.6);
  }
  p.message({ type: "audio", position: from, frames: to - from, data, capture: null, server: null, ready: true });
}
