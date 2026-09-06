import { expect, spyOn, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { captureGuideClock } from "./iptv-native-clock";
import { assertLiveFrame, clockFrame } from "./iptv-clock";
import type { UiDriver } from "./ui";

const ui = { watching: async () => {}, execute: async (script: string) => script.includes("getBoundingClientRect") ? { viewport: [1600, 1000, 1], stage: { x: 0, y: 0, width: 640, height: 360 } } : undefined } as unknown as UiDriver;

test("failed native capture saves intervals, geometry and exit status before asserting", async () => {
  const dir = await mkdtemp(join(tmpdir(), "couch-capture-evidence-"));
  const spawn = spyOn(Bun, "spawn").mockImplementation(() => ({ exited: Promise.resolve(17) }) as ReturnType<typeof Bun.spawn>);
  try {
    await expect(captureGuideClock(ui, dir, "failed", 100)).rejects.toThrow("X11 capture succeeds");
    const raw = await Bun.file(join(dir, "failed.json")).json();
    expect(raw).toMatchObject({ epoch: 100, captureExit: 17, sha256: null, before: { viewport: [1600, 1000, 1] }, after: { viewport: [1600, 1000, 1] } });
    expect(raw.captureEnd).toBeGreaterThanOrEqual(raw.captureStart);
    expect(raw.monotonicEnd).toBeGreaterThanOrEqual(raw.monotonicStart);
    expect(raw.failure).toContain("X11 capture succeeds");
  } finally { spawn.mockRestore(); await rm(dir, { recursive: true, force: true }); }
});

test("decoded native tick and PNG hash survive a later failed freshness assertion", async () => {
  const dir = await mkdtemp(join(tmpdir(), "couch-capture-evidence-"));
  const pixels = new Uint8Array(1600 * 1000 * 3), frame = clockFrame("blue", 0);
  for (let y = 0; y < 360; y++) pixels.set(frame.subarray(y * 640 * 3, (y + 1) * 640 * 3), y * 1600 * 3);
  pixels.set([13, 217, 101], (8 * 1600 + 8) * 3);
  const png = new Uint8Array([1, 2, 3]);
  await Bun.write(join(dir, "stale.png"), png);
  let calls = 0;
  const spawn = spyOn(Bun, "spawn").mockImplementation(() => ({ exited: Promise.resolve(0), ...(++calls === 2 ? { stdout: new Response(pixels).body } : {}) }) as ReturnType<typeof Bun.spawn>);
  try {
    const capture = await captureGuideClock(ui, dir, "stale", Date.now() - 20_000);
    expect(() => assertLiveFrame(capture)).toThrow("Presented IPTV frame exceeds");
    expect(await Bun.file(join(dir, "stale.json")).json()).toMatchObject({ tick: 0, captureStart: capture.captureStart, captureEnd: capture.captureEnd, sha256: createHash("sha256").update(png).digest("hex"), decodeExit: 0, pixelBytes: pixels.length });
  } finally { spawn.mockRestore(); await rm(dir, { recursive: true, force: true }); }
});
