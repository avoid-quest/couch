import { expect, test } from "bun:test";
import { parseCommand } from "./validation";

const parse = (action: unknown) => parseCommand(JSON.stringify({ type: "command", requestId: "test", action }), false);

test("device assignment and volume reject malformed requests", () => {
  expect(parse({ type: "assignDevices", deviceIds: ["browser-a", "receiver-b"] }).action.type).toBe("assignDevices");
  for (const deviceIds of [["same", "same"], ["bad\ndevice"], [""], Array.from({ length: 33 }, (_, index) => `device-${index}`)]) expect(() => parse({ type: "assignDevices", deviceIds })).toThrow();
  for (const volume of [-1, 101, "25", null]) expect(() => parse({ type: "deviceVolume", deviceId: "room", volume, muted: false })).toThrow();
});

test("provider albums accept a public link and discard client-supplied track lists and secrets", () => {
  const action = { type: "enqueueProvider", provider: "bandcamp", shape: "playlist", url: "https://blazo.bandcamp.com/album/jazz-format-mixtape-vol-1", playNow: true } as const;
  expect(parse({ ...action, entries: [{ source: "file:///private" }], headers: { Authorization: "secret" } }).action).toEqual(action);
  for (const change of [{ provider: "unknown" }, { url: "file:///private" }, { url: "https://user:secret@blazo.bandcamp.com/album/test" }, { playNow: "true" }]) expect(() => parse({ ...action, ...change })).toThrow();
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

test("web queue accepts automatic quality alongside explicit unrestricted playback", () => {
  for (const quality of ["auto", "best"]) expect(parse({ type: "enqueueWeb", entryId: "video", url: "https://www.youtube.com/watch?v=123", quality }).action).toMatchObject({ quality });
});


test("YouTube playlist commands validate quality and play intent", () => {
  const action = { type: "enqueueProvider", provider: "youtube", shape: "playlist", url: "https://www.youtube.com/playlist?list=PL1234567890", quality: "1080p", playNow: true } as const;
  const parse = (value: unknown) => parseCommand(JSON.stringify({ type: "command", requestId: "playlist", action: value }), false);
  expect(parse(action).action).toEqual(action);
  for (const change of [{ provider: "unknown" }, { url: "file:///private" }, { quality: "4k" }, { playNow: "true" }]) expect(() => parse({ ...action, ...change })).toThrow();
});

test.each(["enqueueProviderPlaylist", "enqueueProviderAlbum"])("%s is rejected", type => {
  expect(() => parse({ type, provider: "youtube", url: "https://www.youtube.com/playlist?list=PL1234567890" })).toThrow("Invalid command or unsupported media source.");
});

test("provider references validate their atom or playlist shape and preserve public metadata", () => {
  const action = { type: "enqueueProvider", provider: "raiplay", url: "https://www.raiplay.it/programmi/report", shape: "playlist", title: "Report", playNow: true } as const;
  expect(parse({ ...action, thumbnail: "https://example.test/poster.jpg", entries: ["injected"] }).action).toEqual({ ...action, thumbnail: "https://example.test/poster.jpg" });
  for (const change of [{ provider: "unknown" }, { shape: "collection" }, { url: "file:///private" }, { title: "a".repeat(201) }, { thumbnail: "file:///tmp/art" }, { quality: "4k" }]) expect(() => parse({ ...action, ...change })).toThrow();
});

test("current video quality requires a playback ID and a known quality and strips private fields", () => {
  for (const quality of ["auto", "best", "1080p", "720p", "480p"] as const) {
    const action = { type: "videoQuality", playbackId: "current", quality } as const;
    expect(parse({ ...action, source: "file:///private", headers: { Authorization: "secret" } }).action).toEqual(action);
  }
  for (const change of [{ playbackId: null }, { quality: "4k" }, { quality: ["720p"] }, { quality: 720 }, { quality: null }]) {
    expect(() => parse({ type: "videoQuality", playbackId: "current", quality: "720p", ...change })).toThrow();
  }
});

test("Autoplay preferences and provider context accept only bounded public references", () => {
  for (const autoplay of [true, false]) expect(parse({ type: "preferences", profileId: "household", preferences: { autoplay, injected: true } }).action).toEqual({ type: "preferences", profileId: "household", preferences: { autoplay } });
  expect(() => parse({ type: "preferences", profileId: "household", preferences: { autoplay: "yes" } })).toThrow();
  const collection = { title: "Playlist", url: "https://www.youtube.com/playlist?list=PL1234567890", index: 2 };
  const action = { type: "enqueueProvider", provider: "youtube", shape: "atom", url: "https://www.youtube.com/watch?v=abcdefghijk", collection } as const;
  expect(parse({ ...action, collection: { ...collection, entries: ["injected"], headers: { secret: "private" } } }).action).toEqual(action);
  for (const change of [{ url: "file:///private" }, { url: "https://artist.bandcamp.com/album/album" }, { index: -1 }, { index: 500 }, { index: 1.5 }, { title: "\ninvalid" }]) expect(() => parse({ ...action, collection: { ...collection, ...change } })).toThrow();
});
