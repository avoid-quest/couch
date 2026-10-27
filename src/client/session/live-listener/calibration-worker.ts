import { calibrate } from "./calibration";
import type { Calibration } from "./types";

const scope = globalThis as unknown as {
  onmessage: (event: MessageEvent<{ sampleRate: number; quantum: number }>) => void;
  postMessage(message: Calibration | { error: string }): void;
};
scope.onmessage = ({ data }) => {
  try { scope.postMessage(calibrate(data.sampleRate, data.quantum)); }
  catch { scope.postMessage({ error: "Live audio could not measure rendering cost." }); }
};
