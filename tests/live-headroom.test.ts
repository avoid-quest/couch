import { expect, test } from "bun:test";
import { serverNowUs } from "@sonn-audio/node-sendspin";
import { createScheduledCapture } from "../src/server/scheduled-capture";
import { liveOutputAdmission } from "../src/server/output-admission";
import type { SendspinSession } from "@sonn-audio/node-sendspin";

const packet = (capturedAtUs: number) => ({ generation: "g", sequence: 0, samplePosition: 0, capturedAtUs, sampleRate: 48_000, channels: 2 as const, pcm: new Float32Array(960) });

test("a live receiver budget is the deadline headroom Core measures for its wire", async () => {
  // Capture timestamps are non-negative on Core's clock.
  while (serverNowUs() < 100_000) await Bun.sleep(10);
  for (const age of [2, 30, 60]) {
    const capture = createScheduledCapture({ intent: "live" }, () => new Promise(() => {}), () => {});
    expect(capture.outputBudgetMs("pcm")).toBeUndefined();
    const capturedAtUs = Math.round(serverNowUs() - age * 1000), deadlineUs = capturedAtUs + 100_000;
    capture.write(packet(capturedAtUs));
    const sentUs = serverNowUs(), budget = capture.outputBudgetMs("pcm")!;
    // Bracketed by the packet's age at capture and at the moment Core sent it.
    expect(budget).toBeLessThanOrEqual(100 - age);
    expect(budget).toBeGreaterThanOrEqual(Math.floor((deadlineUs - sentUs) / 1000));
    // Opus has not been encoded, so it has no measured headroom yet.
    expect(capture.outputBudgetMs("opus")).toBeUndefined();
    capture.close();
  }
});

test("a receiver waits for measured headroom instead of an assumed budget", () => {
  const session = { getOutputPreparation: () => undefined, getPlayerBufferCapacity: () => 65536, getPlayerTiming: () => ({ requiredLeadTimeMs: 29, minBufferMs: 29, staticDelayMs: 0 }) } as unknown as SendspinSession;
  expect(liveOutputAdmission(session, "pcm", undefined, undefined)).toEqual({ state: "preparing" });
  expect(liveOutputAdmission(session, "pcm", undefined, 29)).toEqual({ state: "ready" });
  expect(liveOutputAdmission(session, "pcm", undefined, 28)).toMatchObject({ state: "failed", reason: "required-lead" });
});
