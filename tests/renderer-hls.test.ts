import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";

// Load the real renderer in a fresh browser-shaped environment for each case.
// Mock only the browser and decoder boundaries, not the renderer's engine choice.
const check = (source: string) => {
  const result = spawnSync(process.execPath, ["-e", `
    import assert from "node:assert/strict";
    import { mock } from "bun:test";
    mock.module("./src/client/session/sendspin.ts", () => ({ soundClock: () => null }));
    mock.module("./src/client/session/device-id.ts", () => ({ localDeviceName: () => "Receiver" }));
    mock.module("./src/client/session/picture-clock.ts", () => ({ followClock: () => () => {} }));
    let mse = true, nativeHls = "probably";
    const decoders = [], media = [], reports = [];
    class Element extends EventTarget {
      style = {}; dataset = {}; children = []; attributes = new Map();
      currentTime = 0; duration = Infinity; volume = 1; paused = true; playbackRate = 1; defaultPlaybackRate = 1;
      textTracks = Object.assign([], { addEventListener() {} });
      constructor(tag) { super(); this.tagName = tag; if (["video", "audio"].includes(tag)) media.push(this); }
      canPlayType(type) { return type === "application/vnd.apple.mpegurl" ? nativeHls : ""; }
      append(...children) { this.children.push(...children); }
      querySelectorAll(tag) { return this.children.filter(child => child.tagName === tag); }
      set src(value) { this.attributes.set("src", value); }
      get src() { return this.attributes.get("src") ?? ""; }
      hasAttribute(name) { return this.attributes.has(name); }
      removeAttribute(name) { this.attributes.delete(name); }
      load() {}
      play() { this.paused = false; return Promise.resolve(); }
      pause() { this.paused = true; }
    }
    globalThis.document = { createElement: tag => new Element(tag), body: new Element("body") };
    globalThis.window = { MediaSource: class {} };
    globalThis.location = { href: "https://couch.example/now", origin: "https://couch.example" };
    globalThis.addEventListener = () => {};
    globalThis.MediaError = { MEDIA_ERR_SRC_NOT_SUPPORTED: 4 };
    Object.defineProperty(globalThis, "navigator", { value: { userAgent: "Chrome/140 Android" }, configurable: true });
    class Hls {
      static isSupported() { return mse; }
      static Events = { ERROR: "error", INIT_PTS_FOUND: "pts", LEVEL_LOADED: "level", AUDIO_TRACKS_UPDATED: "audio-tracks", AUDIO_TRACK_SWITCHED: "audio-switch", SUBTITLE_TRACKS_UPDATED: "subtitle-tracks", SUBTITLE_TRACK_SWITCH: "subtitle-switch" };
      static ErrorDetails = {};
      audioTracks = []; subtitleTracks = [];
      constructor(config) { this.config = config; decoders.push(this); }
      on() {}
      once() {}
      loadSource(source) { this.source = source; }
      attachMedia(element) { this.media = element; }
      destroy() { this.destroyed = true; }
    }
    mock.module("hls.js", () => ({ default: Hls }));
    const { play, connectRenderer } = await import("./src/client/session/renderer.ts");
    const disconnect = connectRenderer(state => reports.push(state));
    const [video, audio] = media;
    const load = (options = {}) => play({ type: "load", playbackId: "playback", source: "https://couch.example/stream.m3u8", ...options });
    const flush = async () => { for (let i = 0; i < 4; i++) await new Promise(setImmediate); };
    ${source}
    disconnect();
  `], { cwd: new URL("../", import.meta.url), encoding: "utf8" });
  expect(result.stderr).toBe("");
  expect(result.status).toBe(0);
};

test("Couch-hosted HLS uses hls.js even when the browser also advertises native HLS", () => check(`
  for (const options of [{}, { source: "https://couch.example/channel", hls: true }]) {
    load(options);
    assert.equal(video.src, "", "do not start the native pipeline before checking MSE");
    await flush();
    assert.equal(decoders.at(-1).media, video);
    assert.equal(decoders.at(-1).source, options.source ?? "https://couch.example/stream.m3u8");
    assert.equal(video.src, "");
  }
  assert.equal(decoders.length, 2);
`));

test("cross-origin HLS keeps native playback and its existing decoder fallback", () => check(`
  load({ source: "https://station.example/stream.m3u8" });
  await flush();
  assert.equal(decoders.length, 0);
  assert.equal(video.src, "https://station.example/stream.m3u8");
  video.error = { code: MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED };
  video.dispatchEvent(new Event("error"));
  await flush();
  assert.equal(decoders.length, 1);
  assert.equal(decoders[0].source, "https://station.example/stream.m3u8");
  assert.equal(decoders[0].media, video);
`));

test("a grouped cross-origin live picture still uses hls.js to map source timestamps", () => check(`
  load({ source: "https://station.example/stream.m3u8", follow: { group: "group", pts: true } });
  await flush();
  assert.equal(decoders.length, 1);
  assert.equal(video.src, "");
  assert.equal(video.muted, true);
`));

test("a browser without hls.js support retains native HLS playback", () => check(`
  mse = false;
  load({ startPosition: 12, paused: true, preferences: { speed: 1.25 } });
  await flush();
  assert.equal(decoders.length, 0);
  assert.equal(video.src, "https://couch.example/stream.m3u8");
  assert.equal(video.currentTime, 12);
  assert.equal(video.playbackRate, 1.25);
  assert.equal(video.paused, true);
  assert.equal(reports.at(-1).error, null);
`));

test("native HLS failure reports an error instead of retrying the same native source", () => check(`
  mse = false;
  load();
  await flush();
  video.error = { code: MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED };
  video.dispatchEvent(new Event("error"));
  await flush();
  assert.equal(decoders.length, 0);
  assert.equal(reports.at(-1).status, "error");
  assert.match(reports.at(-1).error, /can't play this format/);
`));

test("HLS keeps event starts, explicit positions and split audio without changing ordinary files", () => check(`
  load({ eventStart: true, paused: true, audioSource: "https://couch.example/sound.m4a", preferences: { speed: 1.25, audioDelay: 0.2 } });
  await flush();
  assert.equal(decoders.at(-1).config.startPosition, 0);
  assert.equal(decoders.at(-1).config.liveDurationInfinity, true);
  assert.equal(video.currentTime, 0);
  assert.equal(video.playbackRate, 1.25);
  assert.equal(video.paused, true);
  assert.equal(audio.src, "https://couch.example/sound.m4a");
  assert.equal(video.muted, true);
  load({ startPosition: 42 });
  await flush();
  assert.equal(decoders.at(-1).config.startPosition, 42);
  assert.equal(video.currentTime, 42);
  assert.equal(audio.src, "");
  load({ source: "https://couch.example/movie.mp4", audioSource: "https://couch.example/sound.m4a" });
  await flush();
  assert.equal(decoders.length, 2);
  assert.equal(video.src, "https://couch.example/movie.mp4");
  assert.equal(audio.src, "https://couch.example/sound.m4a");
  assert.equal(video.muted, true);
`));

test("an asynchronous HLS load cannot replace or fail a newer ordinary load", () => check(`
  load();
  load({ playbackId: "new", source: "https://couch.example/movie.mp4" });
  await flush();
  assert.equal(decoders.length, 0);
  assert.equal(video.src, "https://couch.example/movie.mp4");
  assert.equal(reports.at(-1).playbackId, "new");
  assert.equal(reports.at(-1).error, null);
`));
