import { expect, test } from "bun:test";
import type { SessionState } from "../src/shared/protocol";
import { automaticUpdateStatus, updateInstallHint, updateInterrupts } from "../src/client/sections/updates/update-presentation";

test.each(["loading", "playing", "paused"] as const)("updating the server checks every %s playback", status => {
  const state = { player: { status: "idle" as const }, playbacks: [{ id: "other", title: "Music", status, outputs: [{ deviceId: "tv", sound: true, picture: true }] }] };
  expect(updateInterrupts(state, ["host"], "phone")).toBe(true);
  expect(updateInterrupts(state, [], "phone", true)).toBe(false);
  expect(updateInterrupts(state, ["app"], "phone", true)).toBe(true);
  expect(updateInterrupts(state, ["tv"], "phone")).toBe(true);
  expect(updateInterrupts(state, ["app"], "phone")).toBe(false);
  expect(updateInterrupts(state, ["app"], "tv")).toBe(true);
});

test("ended or idle media does not require interruption confirmation", () => {
  const state = { player: { status: "ended" as const }, playbacks: [{ id: "p", title: null, status: "ended" as const, outputs: [] }] };
  expect(updateInterrupts(state, ["host"], "phone", true)).toBe(false);
});

test("updating a publisher or server warns about capture even without a playback", () => {
  const state = { player: { status: "idle" as const }, playbacks: [], liveSources: [{ id: "capture", deviceId: "laptop", name: "Screen", kind: "screen" as const, audio: true, video: true }] };
  expect(updateInterrupts(state, ["laptop"], "phone")).toBe(true);
  expect(updateInterrupts(state, ["host"], "phone")).toBe(true);
  expect(updateInterrupts(state, ["app"], "phone", true)).toBe(true);
  expect(updateInterrupts(state, ["app"], "phone")).toBe(false);
  expect(updateInterrupts(state, [], "phone", true)).toBe(false);
});

test("older sessions without the playback collection still warn for paused media", () => {
  expect(updateInterrupts({ player: { status: "paused" } } as SessionState, ["app"], "phone")).toBe(true);
});

test("automatic updates say what the TV did last, and only this app says when its download installs", () => {
  const state = { version: "0.3.0", channel: "latest" as const, status: "ready" as const, available: "0.3.1", progress: null, checkedAt: 1, error: null };
  expect(automaticUpdateStatus(state)).toBeNull();
  expect(automaticUpdateStatus({ ...state, automatic: { installed: false, last: null } })).toBe("Run sudo couch-setup --tv once to turn on automatic updates.");
  expect(automaticUpdateStatus({ ...state, automatic: { installed: true, active: true, last: { version: "0.3.1", outcome: "rolled-back", at: 1, error: null, failed: "0.3.1" } } }))
    .toBe("0.3.1 didn't start, so the TV went back to 0.3.0");
  expect(updateInstallHint(state, true)).toBe("Couch 0.3.1 installs when you quit Couch.");
  expect(updateInstallHint(state, false)).toBeNull();
  expect(updateInstallHint({ ...state, status: "up-to-date" }, true)).toBeNull();
  expect(updateInstallHint({ ...state, automatic: { installed: true, active: true, last: null } }, true)).toBe("Couch 0.3.1 installs automatically overnight when nothing is playing.");
});
