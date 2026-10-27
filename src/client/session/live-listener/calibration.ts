import { LiveProcessor } from "./processor";
import type { Calibration } from "./types";

// Run only in a disposable Worker, before constructing the AudioWorkletNode.
export function calibrate(sampleRate: number, quantum: number): Calibration {
  const p = new LiveProcessor(sampleRate, null, { report() {}, recycle() {} });
  const left = new Float32Array(quantum), right = new Float32Array(quantum);
  for (let i = 0; i < p.N; i++) {
    p.stamps[i] = i; p.ring[i * 2] = Math.sin(i * 0.1); p.ring[i * 2 + 1] = Math.cos(i * 0.1);
  }
  const cost = (hermite: boolean) => {
    let worst = 0;
    for (let trial = 0; trial < 3; trial++) {
      let quanta = 0, elapsed = 0;
      const start = Date.now();
      do {
        for (let q = 0; q < 8; q++, quanta++) {
          const at = 64 + (quanta * quantum) % (p.N - quantum - 128);
          const checked = !hermite && p.present(at - 32, at + quantum + 33);
          for (let i = 0; i < quantum; i++) {
            left[i] = (hermite ? p.sample(at + i + 0.371, 0) : p.sinc(at + i + 0.371, 0, checked))!;
            right[i] = (hermite ? p.sample(at + i + 0.371, 1) : p.sinc(at + i + 0.371, 1, checked))!;
          }
        }
        elapsed = Date.now() - start;
      } while (elapsed < 12 && quanta < 16384);
      worst = Math.max(worst, (elapsed + 1) / quanta);
    }
    return worst;
  };
  const costMs = { sinc: cost(false), hermite: cost(true) };
  for (let i = 0; i < p.N; i++) p.ring[i * 2] = p.ring[i * 2 + 1] = Math.sin(i * 0.03);
  let search = 0;
  for (let trial = 0; trial < 3; trial++) {
    let count = 0, elapsed = 0;
    const start = Date.now();
    do {
      p.findSplice(64, p.stretchMax); p.spliceScore(64, p.stretchMax, 1, p.stretchMax);
      count++; elapsed = Date.now() - start;
    } while (elapsed < 12 && count < 4096);
    search = Math.max(search, (elapsed + 1) / count);
  }
  return { quantum, interp: { costMs }, stretch: { costMs: search } };
}
