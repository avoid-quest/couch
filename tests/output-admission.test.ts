import { expect, test } from "bun:test";
import { liveOutputAdmission } from "../src/server/output-admission";
import { liveOutputBudget } from "../src/server/live-audio-policy";
import type { SendspinSession, OutputPreparation } from "@sonn-audio/node-sendspin";
const token = "91cf4d2b-e08a-45c8-8f81-b010259e30bf";
function session(report?: OutputPreparation, timing = { requiredLeadTimeMs: 25, minBufferMs: 25, staticDelayMs: 0 }, capacity = 4096) {
  return { getOutputPreparation: () => report, getPlayerTiming: () => timing, getPlayerBufferCapacity: () => capacity } as SendspinSession;
}
const ready: OutputPreparation = { receiverId: token, epoch: 1, state: "ready" };
test("modern missing or mismatching reports never fall back to legacy numeric readiness", () => {
  for (const receiver of [undefined, session(), session({ ...ready, receiverId: "other" })]) expect(liveOutputAdmission(receiver, "opus", token)).toEqual({ state: "preparing" });
  expect(liveOutputAdmission(session(), "opus")).toEqual({ state: "ready" });
});
test("pending is explicit even with conservative timing; failed reason survives; legacy ignores extension", () => {
  const pending = session({ ...ready, state: "preparing" }, { requiredLeadTimeMs: 1000, minBufferMs: 250, staticDelayMs: 0 });
  expect(liveOutputAdmission(pending, "opus", token)).toEqual({ state: "preparing" });
  const failed = session({ ...ready, state: "failed", error: "No stable output clock" });
  expect(liveOutputAdmission(failed, "opus", token)).toMatchObject({ state: "failed", reason: "preparation", error: expect.stringContaining("No stable output clock") });
  expect(liveOutputAdmission(failed, "opus")).toEqual({ state: "ready" });
});
test("exact live boundaries and every independent format/capacity/timing gate stay intact", () => {
  for (const receiverId of [undefined, token]) {
    for (const [lead, min, delay] of [[70, 70, 0], [25, 25, 45], [70, 70, -100]]) {
      expect(liveOutputAdmission(session(ready, { requiredLeadTimeMs: lead!, minBufferMs: min!, staticDelayMs: delay! }), "opus", receiverId)).toEqual({ state: "ready" });
    }
    const check = (receiver: SendspinSession, wire: string | undefined, reason: string) => expect(liveOutputAdmission(receiver, wire, receiverId)).toMatchObject({ state: "failed", reason });
    check(session(ready), "flac", "format"); check(session(ready), undefined, "format");
    check(session(ready, undefined, 4095), "opus", "capacity");
    check(session(ready, {} as any), "opus", "timing-missing");
    check(session(ready, { requiredLeadTimeMs: 70.001, minBufferMs: 25, staticDelayMs: 0 }), "opus", "required-lead");
    check(session(ready, { requiredLeadTimeMs: 25, minBufferMs: 70.001, staticDelayMs: 0 }), "opus", "minimum-buffer");
    check(session(ready, { requiredLeadTimeMs: 25, minBufferMs: 25, staticDelayMs: 45.001 }), "opus", "output-correction");
  }
});

test("native PCM fits the explicit 45 ms preset without bypassing capacity, preparation or correction gates", () => {
  const budget = liveOutputBudget(45);
  const pcm = (lead = 31, delay = 0, capacity = 65536, report = ready) => session(report, { requiredLeadTimeMs: lead, minBufferMs: 25, staticDelayMs: delay }, capacity);
  expect(liveOutputAdmission(pcm(), "pcm", token, budget)).toEqual({ state: "ready" });
  expect(liveOutputAdmission(pcm(31, 6), "pcm", token, budget)).toEqual({ state: "ready" });
  expect(liveOutputAdmission(pcm(31, 6.001), "pcm", token, budget)).toMatchObject({ reason: "output-correction" });
  expect(liveOutputAdmission(pcm(37.001), "pcm", token, budget)).toMatchObject({ reason: "required-lead" });
  expect(liveOutputAdmission(pcm(31, 0, 65535), "pcm", token, budget)).toMatchObject({ reason: "capacity" });
  expect(liveOutputAdmission(pcm(31, 0, 65536, { ...ready, state: "preparing" }), "pcm", token, budget)).toEqual({ state: "preparing" });
});

test("source-specific budgets gate lead, buffer and positive correction independently", () => {
  expect(liveOutputAdmission(session(ready), "opus", token, 30)).toEqual({ state: "ready" });
  expect(liveOutputAdmission(session(ready, { requiredLeadTimeMs: 31, minBufferMs: 25, staticDelayMs: 0 }), "opus", token, 30)).toMatchObject({ reason: "required-lead" });
  expect(liveOutputAdmission(session(ready, { requiredLeadTimeMs: 25, minBufferMs: 31, staticDelayMs: 0 }), "opus", token, 30)).toMatchObject({ reason: "minimum-buffer" });
  expect(liveOutputAdmission(session(ready, { requiredLeadTimeMs: 25, minBufferMs: 25, staticDelayMs: 6 }), "opus", token, 30)).toMatchObject({ reason: "output-correction" });
  expect(liveOutputAdmission(session(ready, { requiredLeadTimeMs: 25, minBufferMs: 25, staticDelayMs: 5 }), "opus", token, 30)).toEqual({ state: "ready" });
});
