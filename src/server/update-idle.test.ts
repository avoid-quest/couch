import { expect, test } from "bun:test";
import { createUpdateIdle } from "./update-idle";

const minutes = (value: number) => value * 60_000;
test("ten continuous stopped minutes, without input or active work, are required", () => {
  let now = 0;
  const idle = createUpdateIdle(() => now);
  expect(idle.reason()).toContain("native player");
  idle.playback("idle", false);
  now = minutes(10) - 1; expect(idle.reason()).toContain("1 seconds");
  now++; expect(idle.reason()).toBeNull();
  idle.activity(); expect(idle.reason()).not.toBeNull();
  now += minutes(10); expect(idle.reason()).toBeNull();
  const finish = idle.begin("Import running");
  now += minutes(11); expect(idle.reason()).toBe("Import running");
  finish(); expect(idle.reason()).not.toBeNull();
  now += minutes(10); expect(idle.reason()).toBeNull();
});

test.each(["playing", "paused", "loading", "unavailable"])("%s never counts as stopped, even without controller input", status => {
  let now = 0;
  const idle = createUpdateIdle(() => now);
  idle.playback(status, false); now += minutes(10);
  expect(idle.reason()).not.toBeNull();
  idle.playback("idle", false);
  expect(idle.reason()).not.toBeNull();
  now += minutes(10); expect(idle.reason()).toBeNull();
});

test("radio reconnect and background work completion restart the interval", () => {
  let now = 0;
  const idle = createUpdateIdle(() => now);
  idle.playback("error", true); now += minutes(20);
  expect(idle.reason()).toContain("radio reconnect");
  idle.playback("idle", false); now += minutes(10);
  expect(idle.reason("Waiting for recordings")).toContain("recordings");
  now += minutes(10); expect(idle.reason()).not.toBeNull();
  now += minutes(10); expect(idle.reason()).toBeNull();
  idle.playback("idle", false); expect(idle.reason()).toBeNull();
});
