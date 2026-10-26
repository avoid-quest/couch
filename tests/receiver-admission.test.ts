import { afterEach, expect, test } from "bun:test";
import { createReceiverAdmission, type PreparedReceiver, type PreparationPublisher } from "../src/client/session/receiver-admission";
const guards: ReturnType<typeof createReceiverAdmission>[] = [];
afterEach(() => { for (const guard of guards.splice(0)) guard.close(); });
function fixture() {
  let now = 0, calls = 0, active = true;
  const reports: { report: Parameters<PreparationPublisher>[0]; timing: Parameters<PreparationPublisher>[1] }[] = [];
  const receiver = {
    outputReady: false, outputState: "running", timeSyncInfo: { synced: true, error: 0 }, syncInfo: { outputLatencyMs: 10 },
    async prepareAudio() { calls++; receiver.outputReady = true; }, invalidateAudio() { receiver.outputReady = false; },
  } satisfies PreparedReceiver;
  const guard = createReceiverAdmission(receiver, () => active, (report, timing) => reports.push({ report, timing }), () => now);
  guards.push(guard);
  return { receiver, guard, reports, last: () => reports.at(-1)!, advance: () => { now += 2500; }, deactivate: () => { active = false; }, calls: () => calls };
}
test("held preparation stays preparing; ready publishes timing atomically only once", async () => {
  const f = fixture(); let finish!: () => void;
  f.receiver.prepareAudio = () => new Promise(resolve => { finish = () => { f.receiver.outputReady = true; resolve(); }; });
  const attempt = f.guard.tick(); await f.guard.tick();
  expect(f.reports).toEqual([{ report: { state: "preparing", epoch: 0 }, timing: undefined }]);
  finish(); await attempt;
  expect(f.last()).toEqual({ report: { state: "ready", epoch: 0 }, timing: { requiredLeadTimeMs: 25, minBufferMs: 25 } });
  for (let i = 0; i < 5; i++) { f.advance(); await f.guard.tick(); }
  expect(f.reports.length).toBe(2);
});
test("suspended output and clock loss recover without rejoin", async () => {
  const f = fixture(); await f.guard.tick(); expect(f.last().report.state).toBe("ready");
  f.receiver.outputState = "suspended"; f.receiver.outputReady = false; await f.guard.tick(); expect(f.last().report.state).toBe("preparing"); expect(f.calls()).toBe(1);
  f.receiver.outputState = "running"; await f.guard.tick(); expect(f.last().report.state).toBe("ready"); expect(f.calls()).toBe(2);
  f.receiver.timeSyncInfo.synced = false; await f.guard.tick(); expect(f.last().report.state).toBe("preparing");
  f.receiver.timeSyncInfo.synced = true; await f.guard.tick(); expect(f.last().report.state).toBe("ready");
  f.receiver.timeSyncInfo.error = 20_000; await f.guard.tick(); expect(f.last().report.state).toBe("preparing");
  f.receiver.timeSyncInfo.error = 10_000; await f.guard.tick(); expect(f.last().report.state).toBe("ready");
});
for (const reject of [false, true]) test(`route replacement cancels old ${reject ? "failure" : "success"} after new readiness`, async () => {
  const f = fixture(); let finish!: () => void;
  f.receiver.prepareAudio = () => new Promise<void>((resolve, fail) => { finish = () => reject ? fail(new Error("old failure")) : resolve(); });
  const old = f.guard.tick(); f.guard.outputChanged();
  f.receiver.prepareAudio = async () => { f.receiver.outputReady = true; };
  await f.guard.tick(); const ready = f.last(); expect(ready.report.state).toBe("ready");
  finish(); await old; expect(f.last()).toBe(ready);
  expect(ready.report.epoch).toBe(1);
});
test("closing or losing active ownership cancels pending completion", async () => {
  for (const close of [true, false]) {
    const f = fixture(); let finish!: () => void;
    f.receiver.prepareAudio = () => new Promise<void>(resolve => { finish = () => { f.receiver.outputReady = true; resolve(); }; });
    const pending = f.guard.tick(); if (close) f.guard.close(); else f.deactivate();
    finish(); await pending; expect(f.reports.length).toBe(1);
  }
});
test("three spaced failures retain bounded sanitized reason; route recovery retries", async () => {
  const f = fixture(); let calls = 0;
  f.receiver.prepareAudio = async () => { calls++; throw new Error("clock https://secret/path\nmissing"); };
  await Promise.all([f.guard.tick(), f.guard.tick(), f.guard.tick()]); expect(calls).toBe(1);
  expect(f.last().report.state).toBe("preparing"); await f.guard.tick(); expect(calls).toBe(1);
  f.advance(); await f.guard.tick(); expect(calls).toBe(2); expect(f.last().report.state).toBe("preparing");
  f.advance(); await f.guard.tick(); expect(f.last().report).toEqual({ state: "failed", epoch: 0, error: "clock [url] missing" });
  for (let i = 0; i < 5; i++) { f.advance(); await f.guard.tick(); } expect(calls).toBe(3);
  f.guard.outputChanged(); f.receiver.prepareAudio = async () => { f.receiver.outputReady = true; };
  await f.guard.tick(); expect(f.last().report).toEqual({ state: "ready", epoch: 1 });
});
test("latency changes are reprobed and never relax the server budget", async () => {
  const f = fixture(); await f.guard.tick(); f.receiver.syncInfo.outputLatencyMs = 60.1;
  await f.guard.tick(); expect(f.last().timing?.requiredLeadTimeMs).toBe(71);
  expect(f.calls()).toBe(2); expect(f.last().report.epoch).toBe(1);
});

test("a ready route that loses its latency estimate withdraws readiness", async () => {
  const f = fixture(); await f.guard.tick(); f.receiver.syncInfo.outputLatencyMs = NaN;
  await f.guard.tick(); expect(f.last().report.state).toBe("preparing");
  f.advance(); await f.guard.tick(); f.advance(); await f.guard.tick();
  expect(f.last().report).toMatchObject({ state: "failed", error: "The audio output has no valid latency estimate." });
});
