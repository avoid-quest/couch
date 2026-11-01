import { expect, test } from "bun:test";
import { runInNewContext } from "node:vm";

const built = await Bun.build({ entrypoints: ["src/client/session/live-video-pacer-worker.ts"], target: "browser", format: "iife" });
if (!built.success) throw new Error("Video pacer worker did not build");
const code = await built.outputs[0]!.text();

test("the pacer presents a lone first frame at the next display tick and releases it", async () => {
  let tick!: () => void;
  const writes: unknown[] = [];
  const frame = { close() { closed++; } };
  let closed = 0;
  const input = new ReadableStream({ start(controller) { controller.enqueue(frame); } });
  const output = new WritableStream({ write(value) { writes.push(value); } });
  const scope = { onmessage: undefined as unknown as (event: { data: unknown }) => Promise<void>,
    requestAnimationFrame(callback: () => void) { tick = callback; return 1; }, cancelAnimationFrame() {}, postMessage() {} };
  runInNewContext(code, { self: scope });
  const running = scope.onmessage({ data: { readable: input, writable: output } });
  await new Promise<void>(resolve => setImmediate(resolve));
  tick();
  await new Promise<void>(resolve => setImmediate(resolve));
  expect(writes).toEqual([frame]);
  expect(closed).toBe(1);
  tick();
  await Promise.resolve();
  expect(writes).toHaveLength(1);
  await scope.onmessage({ data: { stop: true } });
  await running;
});
