import type { NetworkRuntime } from "../../src/client/session/live-listener/network";
import { OpusDecoder } from "opus-decoder";

export class FakeSocket {
  binaryType = "";
  readyState = 1;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent<string | ArrayBuffer>) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  sent: Record<string, unknown>[] = [];
  send(value: string) { this.sent.push(JSON.parse(value)); }
  close() { this.disconnect(1000); }
  disconnect(code: number, reason = "") { this.readyState = 3; this.onclose?.({ code, reason } as CloseEvent); }
  text(value: object) { this.onmessage?.({ data: JSON.stringify(value) } as MessageEvent); }
  audio(data: ArrayBuffer) { this.onmessage?.({ data } as MessageEvent); }
}
export function networkRuntime() {
  let now = 0;
  const sockets: FakeSocket[] = [];
  const intervals: { fn: () => void; ms: number }[] = [], timeouts: { fn: () => void; ms: number }[] = [];
  const schedule = (list: typeof intervals, fn: () => void, ms: number) => {
    const item = { fn, ms }; list.push(item); return () => { const i = list.indexOf(item); if (i !== -1) list.splice(i, 1); };
  };
  const runtime: NetworkRuntime = {
    now: () => now,
    socket: () => { const ws = new FakeSocket(); sockets.push(ws); return ws; },
    decoder: () => new OpusDecoder({ sampleRate: 48000, channels: 2 }),
    interval: (fn, ms) => schedule(intervals, fn, ms),
    timeout: (fn, ms) => schedule(timeouts, fn, ms),
  };
  return { runtime, sockets, intervals, timeouts, time: (ms: number) => { now = ms; } };
}
export function pcm(position: number, captureUs: number, frames = 128) {
  const buffer = new ArrayBuffer(24 + frames * 4), view = new DataView(buffer);
  view.setUint8(0, 1); view.setUint8(1, 2); view.setUint16(2, frames, true);
  view.setFloat64(8, position, true); view.setFloat64(16, captureUs, true);
  for (let i = 0; i < frames * 2; i++) view.setInt16(24 + i * 2, Math.sin((position * 2 + i) * 0.02) * 8000, true);
  return buffer;
}
