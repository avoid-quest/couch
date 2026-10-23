import { expect, test } from "bun:test";
import type { SessionState } from "../src/shared/protocol";
import { updateInterrupts, updateNoticeKey } from "../src/client/sections/updates/update-presentation";

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

test("Later applies only to this viewer, Couch, device, and release", () => {
  const keys = [
    updateNoticeKey("phone", "home", "tv", "0.4.0"),
    updateNoticeKey("tablet", "home", "tv", "0.4.0"),
    updateNoticeKey("phone", "office", "tv", "0.4.0"),
    updateNoticeKey("phone", "home", "laptop", "0.4.0"),
    updateNoticeKey("phone", "home", "tv", "0.4.1"),
  ];
  expect(new Set(keys).size).toBe(keys.length);
});
