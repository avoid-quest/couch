import { expect, test } from "bun:test";
import { ListenerNetwork } from "../src/client/session/live-listener/network";
import { OutputClockPublisher } from "../src/client/session/live-listener/output-clock";
import { LiveProcessor } from "../src/client/session/live-listener/processor";
import { calibration, sampleRate } from "./fixtures/live-listener";
import { networkRuntime, pcm } from "./fixtures/live-network";

test("real network batches recycle transfers with no renderer audio allocation and only ≤2 clock messages/s", () => {
  for (const moving of [false, true]) {
    const harness = networkRuntime();
    let owned = 0, guard = false, batches = 0, recycles = 0, clocks = 0, seconds = 0;
    let reports = 0, reportIdentity: object | null = null;
    const Float = globalThis.Float32Array, Double = globalThis.Float64Array, Buffer = globalThis.ArrayBuffer;
    const track = <T extends typeof Float | typeof Double | typeof Buffer>(constructor: T): T => new Proxy(constructor, {
      construct(target, args) { if (guard) owned++; return Reflect.construct(target, args); },
    });
    const renderer = new LiveProcessor(sampleRate, calibration(), {
      report: report => { reports++; if (reportIdentity) expect(report).toBe(reportIdentity); reportIdentity = report; },
      recycle: (message, transfer) => {
        const buffer = message.data.buffer;
        const received = structuredClone(message, { transfer });
        expect(buffer.byteLength).toBe(0);
        network.batches.recycle(received); recycles++;
      },
    });
    const network = new ListenerNetwork({ url: "wss://fixture/api/live/listen" }, {
      postMessage: (message, transfer) => {
        const received = structuredClone(message, transfer ? { transfer } : undefined);
        if (message.type === "audio") { expect(message.data.byteLength).toBe(0); batches++; }
        guard = true; renderer.message(received); guard = false;
      },
    }, () => {}, harness.runtime);
    const publisher = new OutputClockPublisher({ postMessage: message => {
      clocks++; guard = true; renderer.message(structuredClone(message)); guard = false;
    } });
    const left = new Float(128), right = new Float(128);
    globalThis.Float32Array = track(Float); globalThis.Float64Array = track(Double); globalThis.ArrayBuffer = track(Buffer);
    try {
      network.start();
      const ws = harness.sockets[0]!;
      ws.text({ type: "hello", session: "one", codec: 1, leadMs: 40 });
      // One tick is 1/3 ms: 128 frames every 8 ticks, a batch every 24, pings every 150.
      for (let tick = 0; tick < 30_000; tick++) {
        const ms = tick / 3; harness.time(ms); seconds = ms / 1000;
        if (tick % 150 === 0) ws.text({ type: "pong", t: ms, s: ms * 1000 });
        if (tick % 8 === 0) ws.audio(pcm(tick * 16, ms * 1000));
        if (tick % 24 === 0) harness.intervals.find(t => t.ms === 8)!.fn();
        if (tick % 60 === 0) publisher.push({ x0: ms, y0: ms + (moving ? ms * 0.001 : 0), slope: 1 }, ms);
        if (tick % 8 === 0) { guard = true; renderer.process(left, right, tick * 16); guard = false; }
      }
      network.batches.flush();
      expect(owned).toBe(0);
      expect(recycles).toBe(batches);
      expect(batches).toBeGreaterThan(1240);
      expect(batches).toBeLessThanOrEqual(1254);
      expect(clocks).toBe(moving ? 20 : 10);
      expect((clocks + batches) / (seconds + 1 / 3000)).toBeLessThanOrEqual(batches / 10 + 2);
      expect(reports).toBeGreaterThanOrEqual(9);
      expect(renderer.stats.missing).toBe(0);
    } finally {
      guard = false; network.stop();
      globalThis.Float32Array = Float; globalThis.Float64Array = Double; globalThis.ArrayBuffer = Buffer;
    }
  }
});
