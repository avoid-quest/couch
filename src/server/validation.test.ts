import { expect, test } from "bun:test";
import { parseCommand } from "./validation";

const parse = (action: unknown) => parseCommand(JSON.stringify({ type: "command", requestId: "test", action }), false);

test("provider albums accept a public link and discard client-supplied track lists and secrets", () => {
  const action = { type: "enqueueProviderAlbum", provider: "bandcamp", url: "https://blazo.bandcamp.com/album/jazz-format-mixtape-vol-1", playNow: true } as const;
  expect(parse({ ...action, entries: [{ source: "file:///private" }], headers: { Authorization: "secret" } }).action).toEqual(action);
  for (const change of [{ provider: "youtube" }, { url: "file:///private" }, { url: "https://user:secret@blazo.bandcamp.com/album/test" }, { playNow: "true" }]) expect(() => parse({ ...action, ...change })).toThrow();
});

test("TV navigation accepts only remote keys and strips unrelated command fields", () => {
  for (const key of ["up", "down", "left", "right", "select", "back", "home", "info"] as const) {
    expect(parse({ type: "navigate", key, target: "other-controller", script: "private" }).action).toEqual({ type: "navigate", key });
  }
  for (const key of ["ArrowUp", "enter", "shutdown", "", null, {}, ["up"], 1]) expect(() => parse({ type: "navigate", key })).toThrow();
  expect(() => parse({ type: "navigate" })).toThrow();
});

test("playback preferences accept language policy while stripping unrelated fields", () => {
  const preferences = { audioLanguage: "ITA", subtitleLanguage: "en", subtitles: "auto", speed: 1.25 } as const;
  const action = { type: "preferences", profileId: "household", preferences } as const;
  expect(parse({ ...action, preferences: { ...preferences, source: "file:///private" } }).action).toEqual({ ...action, preferences: { ...preferences, audioLanguage: "ita" } });
  for (const changes of [{ audioLanguage: "eng,ita" }, { subtitleLanguage: "../" }, { subtitles: "yes" }, { speed: 0 }, { speed: 5 }, { speed: "1" }]) expect(() => parse({ ...action, preferences: { ...preferences, ...changes } })).toThrow();
  expect(() => parse({ type: "addSubtitle", playbackId: "current", source: "file:///private", title: "Private" })).toThrow();
  expect(parse({ ...action, preferences: { audioLanguage: "EN", source: "private" } }).action).toEqual({ ...action, preferences: { audioLanguage: "en" } });
  for (const preferences of [{}, { source: "private" }, { audioLanguage: null }, { speed: null }, { subtitles: null }, { subtitles: ["auto"] }, { subtitles: ["off"] }]) expect(() => parse({ ...action, preferences })).toThrow();
});

test("save-default requests carry only current item, profile and supported choice", () => {
  const action = { type: "savePlaybackDefault", profileId: "household", playbackId: "playing", setting: "speed" } as const;
  expect(parse({ ...action, speed: 9, language: "private", track: 100, audioDelay: 5 }).action).toEqual(action);
  for (const setting of ["audio", "subtitles", "speed"] as const) expect(parse({ ...action, setting }).action).toEqual({ ...action, setting });
  for (const change of [{ setting: "audioDelay" }, { setting: "track" }, { playbackId: "" }, { profileId: "" }]) expect(() => parse({ ...action, ...change })).toThrow();
  for (const setting of [["speed"], ["audio"], ["subtitles"], {}, null, true, 1]) expect(() => parse({ ...action, setting })).toThrow();
});

test("web queue commands validate quality and public metadata and ordinary enqueue strips extras", () => {
  const action = { type: "enqueueWeb", entryId: "video", url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", quality: "720p", title: "A video" };
  expect(parse(action).action).toMatchObject(action);
  for (const quality of ["2160p", "720", 720, null]) expect(() => parse({ ...action, quality })).toThrow();
  expect(() => parse({ ...action, title: "a".repeat(201) })).toThrow();
  expect(() => parse({ ...action, thumbnail: "file:///tmp/image.png" })).toThrow();
  const entry = { id: "one", title: "One", source: "https://media.example/one.mp4" };
  expect(parse({ type: "enqueue", entry: { ...entry, automaticTitle: true, quality: "invalid", headers: { Authorization: "secret" }, thumbnail: "file:///tmp/private" } }).action).toEqual({ type: "enqueue", entry });
});

test("play accepts an explicit restart without allowing invalid flags", () => {
  expect(parse({ type: "play", entryId: "one", fromStart: true }).action).toEqual({ type: "play", entryId: "one", fromStart: true });
  for (const fromStart of ["true", 1, null, {}]) expect(() => parse({ type: "play", entryId: "one", fromStart })).toThrow();
});

test("radio queue intent is limited to direct HTTP streams and cannot carry native settings", () => {
  const entry = { id: "station", title: "Station", source: "https://radio.example/live", kind: "radio" } as const;
  expect(parse({ type: "enqueue", entry: { ...entry, headers: { Authorization: "secret" }, retryCount: 999, nowPlaying: { title: "Invented" } }, playNow: true }).action).toEqual({ type: "enqueue", entry: { ...entry, live: true }, playNow: true });
  for (const source of ["web:https://radio.example/page", "file:///private/song", "https://user:password@radio.example/live"]) expect(() => parse({ type: "enqueue", entry: { ...entry, source } })).toThrow();
  expect(() => parse({ type: "enqueue", entry: { ...entry, kind: "movie" } })).toThrow();
});

test.each(["enqueueLibrary", "enqueueJellyfin", "enqueueWeb"])("%s validates playback intent and requires play-now for a restart", type => {
  const action = { type, itemId: "item", entryId: "entry", url: "https://media.example/video" };
  expect(parse(action).action).toEqual(action);
  expect(parse({ ...action, playNow: false }).action).toMatchObject({ playNow: false });
  for (const fromStart of [undefined, false, true]) expect(parse({ ...action, playNow: true, fromStart }).action).toMatchObject({ playNow: true });
  for (const invalid of ["true", 1, null, {}]) {
    expect(() => parse({ ...action, playNow: invalid })).toThrow();
    expect(() => parse({ ...action, playNow: true, fromStart: invalid })).toThrow();
  }
  for (const fromStart of [false, true]) {
    expect(() => parse({ ...action, fromStart })).toThrow();
    expect(() => parse({ ...action, playNow: false, fromStart })).toThrow();
  }
});

test("Go live requires a current playback identity and exposes no native option parameter", () => {
  const command = (action: unknown) => parseCommand(JSON.stringify({ type: "command", requestId: "live", action }), false);
  expect(command({ type: "goLive", playbackId: "current", goLive: false, source: "https://untrusted.test", demuxerOptions: { live_start_index: -100 } }).action).toEqual({ type: "goLive", playbackId: "current" });
  for (const playbackId of [undefined, "", -1]) expect(() => command({ type: "goLive", playbackId })).toThrow();
});
