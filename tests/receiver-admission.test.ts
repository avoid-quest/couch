import { expect, test } from "bun:test";
import { createReceiverAdmission, type PreparedReceiver } from "../src/client/session/receiver-admission";
function fixture() {
  let now = 0, calls = 0, active = true, lead = 1000;
  const receiver = {
    outputReady: false, outputState: "running", timeSyncInfo: { synced: true, error: 0 }, syncInfo: { outputLatencyMs: 10 },
    async prepareAudio() { calls++; receiver.outputReady = true; }, invalidateAudio() { receiver.outputReady = false; }, setRequiredLeadTimeMs(value: number) { lead = value; }, setMinBufferMs() {},
  } satisfies PreparedReceiver;
  const guard = createReceiverAdmission(receiver, () => active, () => now);
  return { receiver, guard, advance: () => { now += 2500; }, deactivate: () => { active = false; }, calls: () => calls, lead: () => lead };
}
test("failed/suspended output is prepared again after it resumes", async () => {
  const f = fixture(); await f.guard.tick(); expect(f.lead()).toBe(25);
  f.receiver.outputState = "suspended"; f.receiver.outputReady = false; await f.guard.tick(); expect(f.lead()).toBe(1000); expect(f.calls()).toBe(1);
  f.receiver.outputState = "running"; await f.guard.tick(); expect(f.lead()).toBe(25); expect(f.calls()).toBe(2);
});
test("clock loss withdraws admission and recovery prepares only this receiver", async () => {
  const f = fixture(); await f.guard.tick(); f.receiver.timeSyncInfo.synced = false; await f.guard.tick(); expect(f.lead()).toBe(1000);
  f.receiver.timeSyncInfo.synced = true; await f.guard.tick(); expect(f.lead()).toBe(25);
  f.receiver.timeSyncInfo.error = 20_000; await f.guard.tick(); expect(f.lead()).toBe(1000);
});
test("same-latency output changes invalidate readiness; stale preparation cannot admit", async () => {
  const f = fixture(); let finish!: () => void;
  f.receiver.prepareAudio = () => new Promise<void>(resolve => { finish = () => { f.receiver.outputReady = true; resolve(); }; });
  const pending = f.guard.tick(); f.guard.outputChanged(); finish(); await pending; expect(f.lead()).toBe(1000);
  f.advance(); const next = f.guard.tick(); f.guard.close(); finish(); await next; expect(f.lead()).toBe(1000);
});
test("failed preparation has one in-flight attempt and a bounded retry interval", async () => {
  const f = fixture(); let calls = 0;
  f.receiver.prepareAudio = async () => { calls++; throw new Error("no timestamp"); };
  await Promise.all([f.guard.tick(), f.guard.tick(), f.guard.tick()]); expect(calls).toBe(1); expect(f.lead()).toBe(1000);
  await f.guard.tick(); expect(calls).toBe(1); f.advance(); await f.guard.tick(); expect(calls).toBe(2);
  f.deactivate(); f.advance(); await f.guard.tick(); expect(calls).toBe(2);
});

test("a permanently unready route stops retrying until the route changes", async () => {
  const f = fixture(); let calls = 0;
  f.receiver.prepareAudio = async () => { calls++; throw new Error("unsupported clock"); };
  for (let i = 0; i < 8; i++) { await f.guard.tick(); f.advance(); }
  expect(calls).toBe(3); expect(f.lead()).toBe(1000);
  f.guard.outputChanged(); await f.guard.tick(); expect(calls).toBe(4);
});
