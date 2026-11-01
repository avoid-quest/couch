import { expect, test } from "bun:test";
import { mediaToolVersion, updateInterrupts } from "../src/client/sections/updates/update-presentation";

test("media tool banners keep the full release or build version without command names and copyright", () => {
  for (const [name, version, expected] of [
    ["ffmpeg", "ffmpeg version 7.1.5-0+deb13u1 Copyright (c) 2000-2026 the FFmpeg developers", "7.1.5-0+deb13u1"],
    ["ffmpeg", "ffmpeg version N-119542-gabc123 Copyright (c) 2000-2026 the FFmpeg developers", "N-119542-gabc123"],
    ["mpv", "mpv v0.40.0 Copyright © 2000-2025 mpv/MPlayer/mplayer2 projects", "v0.40.0"],
    ["mpv", "mpv 0.40.0-3-gabc123\r\nbuilt on Oct 27 2026", "0.40.0-3-gabc123"],
    ["yt-dlp", "2026.10.21", "2026.10.21"],
    ["mpv", "custom build", "custom build"],
    ["ffmpeg", null, null],
    ["mpv", "", null],
  ] as const) expect(mediaToolVersion({ name, version })).toBe(expected);
});

test.each(["loading", "playing", "paused"] as const)("updating the server checks every %s playback", status => {
  const state = { player: { status: "idle" as const }, playbacks: [{ id: "other", title: "Music", status, outputs: [{ deviceId: "tv", sound: true, picture: true }] }] };
  expect(updateInterrupts(state, ["host"], "phone")).toBe(true);
  expect(updateInterrupts(state, [], "phone", true)).toBe(false);
  expect(updateInterrupts(state, ["app"], "phone", true)).toBe(true);
  expect(updateInterrupts(state, ["tv"], "phone")).toBe(true);
  expect(updateInterrupts(state, ["app"], "phone")).toBe(false);
  expect(updateInterrupts(state, ["app"], "tv")).toBe(true);
});

test("updating a publisher or server warns about capture even without a playback", () => {
  const state = { player: { status: "idle" as const }, playbacks: [], liveSources: [{ id: "capture", deviceId: "laptop", name: "Screen", kind: "screen" as const, audio: true, video: true }] };
  expect(updateInterrupts(state, ["laptop"], "phone")).toBe(true);
  expect(updateInterrupts(state, ["host"], "phone")).toBe(true);
  expect(updateInterrupts(state, ["app"], "phone")).toBe(false);
});
