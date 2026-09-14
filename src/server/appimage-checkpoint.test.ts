import { expect, test } from "bun:test";
import { checkpointAppImage } from "./appimage-checkpoint";

test("idle changes and unconfirmed paused playback never close data admission", async () => {
  let closes = 0;
  const base = { whenIdle: false, confirmInterrupt: false, idle: () => "New remote input", player: () => "paused", closeAdmission: () => { closes++; }, quiesce: async () => { throw new Error("must not run"); } };
  expect(await checkpointAppImage({ ...base, whenIdle: true })).toEqual({ closed: false, error: "New remote input" });
  expect((await checkpointAppImage(base)).error).toContain("Confirm interruption");
  expect(closes).toBe(0);
});
test("confirmed interruption closes admission before required producer checkpoint", async () => {
  let closed = false;
  expect(await checkpointAppImage({ whenIdle: false, confirmInterrupt: true, idle: () => null, player: () => "playing", closeAdmission: () => { closed = true; }, quiesce: async () => { expect(closed).toBe(true); return { progressSaved: true, admissionClosed: true }; } })).toEqual({ closed: true, error: null });
});
test("disk failure and incomplete writer acknowledgement prohibit replacement and require restart", async () => {
  for (const quiesce of [async () => { throw new Error("disk full"); }, async () => ({ progressSaved: false, admissionClosed: true })]) {
    const result = await checkpointAppImage({ whenIdle: true, confirmInterrupt: false, idle: () => null, player: () => "idle", closeAdmission: () => {}, quiesce });
    expect(result.closed).toBe(true); expect(result.error).toBeString();
  }
});


test.each(["Active recording", "Library scan", "Import request"])("manual interruption cannot stop %s", async reason => {
  let closed = false;
  const result = await checkpointAppImage({ whenIdle: false, confirmInterrupt: true, work: () => reason, idle: () => null, player: () => "playing", closeAdmission: () => { closed = true; }, quiesce: async () => { throw new Error("Must remain running"); } });
  expect(result).toEqual({ closed: false, error: reason });
  expect(closed).toBe(false);
});
