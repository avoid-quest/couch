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
      buffered = { length: 0 };
      textTrackEvents = new EventTarget();
      textTracks = Object.assign([], { addEventListener: (...args) => this.textTrackEvents.addEventListener(...args) });
      constructor(tag) { super(); this.tagName = tag; if (["video", "audio"].includes(tag)) media.push(this); }
      canPlayType(type) { return type === "application/vnd.apple.mpegurl" ? nativeHls : ""; }
      append(...children) {
        this.children.push(...children);
        for (const child of children) {
          child.parent = this;
          if (child.tagName === "track") {
            child.track = { kind: child.kind, label: child.label, language: child.srclang, mode: "disabled" };
            let mode = "disabled";
            Object.defineProperty(child.track, "mode", {
              get: () => mode,
              set: value => {
                if (value === mode) return;
                mode = value;
                // Chromium queues one event per mode change, including hidden -> disabled.
                setTimeout(() => this.textTrackEvents.dispatchEvent(new Event("change")), 0);
              },
            });
            this.textTracks.push(child.track);
          }
        }
      }
      remove() {
        this.parent.children.splice(this.parent.children.indexOf(this), 1);
        if (this.track) this.parent.textTracks.splice(this.parent.textTracks.indexOf(this.track), 1);
      }
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
    globalThis.MediaStream = class {
      constructor(tracks = []) { this.tracks = tracks; }
      getTracks() { return this.tracks; }
      getAudioTracks() { return this.tracks.filter(track => track.kind === "audio"); }
      getVideoTracks() { return this.tracks.filter(track => track.kind === "video"); }
    };
    Object.defineProperty(globalThis, "navigator", { value: { userAgent: "Chrome/140 Android" }, configurable: true });
    class Hls {
      static isSupported() { return mse; }
      static Events = { ERROR: "error", INIT_PTS_FOUND: "pts", LEVEL_LOADED: "level", AUDIO_TRACKS_UPDATED: "audio-tracks", AUDIO_TRACK_SWITCHED: "audio-switch", SUBTITLE_TRACKS_UPDATED: "subtitle-tracks", SUBTITLE_TRACK_SWITCH: "subtitle-switch" };
      static ErrorDetails = {};
      audioTracks = []; subtitleTracks = [];
      listeners = new Map();
      constructor(config) { this.config = config; decoders.push(this); }
      on(event, listener) { this.listeners.set(event, [...this.listeners.get(event) ?? [], listener]); }
      once(event, listener) { const once = (...args) => { this.listeners.set(event, this.listeners.get(event).filter(item => item !== once)); listener(...args); }; this.on(event, once); }
      emit(event, data) { for (const listener of this.listeners.get(event) ?? []) listener(event, data); }
      loadSource(source) { this.source = source; }
      attachMedia(element) { this.media = element; }
      destroy() { this.destroyed = true; }
    }
    mock.module("hls.js", () => ({ default: Hls }));
    const { play, connectRenderer, attachStream, streamChanged } = await import("./src/client/session/renderer.ts");
    const disconnect = connectRenderer(state => reports.push(state));
    const [video, audio] = media;
    const load = (options = {}) => play({ type: "load", playbackId: "playback", source: "https://couch.example/stream.m3u8", ...options });
    const flush = async () => { for (let i = 0; i < 4; i++) await new Promise(resolve => setTimeout(resolve, 0)); };
    ${source}
    disconnect();
  `], { cwd: new URL("../", import.meta.url), encoding: "utf8" });
  expect(result.stderr).toBe("");
  expect(result.status).toBe(0);
};

test("16 subtitle tracks and HLS initialization do not flood Core with identical reports", () => check(`
  const subtitles = Array.from({ length: 16 }, (_, index) => ({ source: "https://couch.example/" + index + ".vtt", title: "Captions " + index, language: "en" }));
  let changes = 0;
  video.textTracks.addEventListener("change", () => { changes++; if (video.duration === 60) video.currentTime += .001; });
  for (let cycle = 0; cycle < 3; cycle++) {
    video.duration = Infinity;
    const before = reports.length, previousChanges = changes;
    load({ subtitles, preferences: { subtitles: "off" } });
    await flush();
    const decoder = decoders.at(-1);
    decoder.emit(Hls.Events.LEVEL_LOADED, {});
    for (const event of [Hls.Events.SUBTITLE_TRACKS_UPDATED, Hls.Events.AUDIO_TRACKS_UPDATED, Hls.Events.AUDIO_TRACK_SWITCHED]) decoder.emit(event, {});
    await flush();
    assert.equal(changes - previousChanges, 64, "two selections really drained Chromium's 64 queued mode changes");
    assert.equal(reports.length - before, 1, "only the new loading state goes to Core");
    video.dispatchEvent(new Event("canplay"));
    assert.equal(reports.at(-1).tracks.filter(track => track.kind === "subtitle").length, 16);
    assert.equal(reports.length - before, 2, "ready publishes the full track list");
    video.duration = 60;
    video.dispatchEvent(new Event("durationchange"));
    for (const index of [15, -1]) {
      const count = reports.length;
      play({ type: "track", playbackId: "playback", kind: "subtitle", index });
      await flush();
      assert.equal(reports.length, count + 1, "track selection reports once despite 32 queued events and an advancing clock");
      assert.deepEqual(reports.at(-1).tracks.filter(track => track.kind === "subtitle" && track.selected).map(track => track.index), index < 0 ? [] : [index]);
    }
    decoder.audioTracks = [{ name: "English", lang: "en" }];
    decoder.emit(Hls.Events.AUDIO_TRACKS_UPDATED, {});
    assert.equal(reports.at(-1).tracks.find(track => track.kind === "audio").label, "English", "real HLS track changes still report");
    const count = reports.length;
    play({ type: "stop", playbackId: "playback" });
    await flush();
    assert.equal(reports.length, count + 1);
    assert.equal(reports.at(-1).status, "idle");
    assert.equal(video.textTracks.length, 0);
  }
`));

test("report deduplication preserves position ticks, controls, failures and new subscribers", () => check(`
  let now = 0;
  Object.defineProperty(performance, "now", { value: () => now });
  load({ source: "https://couch.example/movie.mp4", audioSource: "https://couch.example/audio.m4a" });
  video.duration = 60;
  video.dispatchEvent(new Event("canplay"));
  const before = reports.length;
  video.currentTime = .5; now = 500;
  video.dispatchEvent(new Event("timeupdate"));
  assert.equal(reports.length, before);
  video.currentTime = 1.1; now = 1100;
  video.dispatchEvent(new Event("timeupdate"));
  assert.equal(reports.length, before + 1);
  assert.equal(reports.at(-1).position, 1.1);
  play({ type: "seek", playbackId: "playback", position: 1.2 });
  assert.equal(reports.at(-1).position, 1.2, "even a small seek reports immediately between ticks");
  video.currentTime = 1.3;
  video.dispatchEvent(new Event("seeked"));
  assert.equal(reports.at(-1).position, 1.3, "the browser's completed seek reports its actual position");
  play({ type: "pause", playbackId: "playback", paused: true });
  assert.equal(reports.at(-1).status, "paused");
  play({ type: "speed", playbackId: "playback", speed: 1.25 });
  assert.equal(reports.at(-1).speed, 1.25);
  play({ type: "audioDelay", playbackId: "playback", delay: .2 });
  assert.equal(reports.at(-1).audioDelay, .2);
  play({ type: "subtitleDelay", playbackId: "playback", delay: .5 });
  assert.equal(reports.at(-1).subtitleDelay, .5);
  video.error = { code: 3, message: "decoder failed" };
  video.dispatchEvent(new Event("error"));
  assert.equal(reports.at(-1).status, "error");
  assert.equal(reports.at(-1).error, "decoder failed");
  const reconnected = [];
  connectRenderer(state => reconnected.push(state));
  assert.deepEqual(reconnected, [reports.at(-1)], "a new connection receives even an unchanged state");
`));

test("blocked audio is replayed when the shell subscribes again after recovery", () => check(`
  const { onBlocked, waitForTap } = await import("./src/client/session/renderer.ts");
  waitForTap(() => {});
  const first = [], recovered = [];
  const unsubscribe = onBlocked(value => first.push(value));
  assert.deepEqual(first, [true], "a new shell needs the current blocked state");
  unsubscribe();
  const stop = onBlocked(value => recovered.push(value));
  assert.deepEqual(recovered, [true], "recovery must offer Tap to hear again");
  waitForTap(null);
  assert.deepEqual(first, [true], "the old shell unsubscribed");
  assert.deepEqual(recovered, [true, false], "recovery still hears audio unlocking");
  stop();
`));

test("direct streams use the existing player, honest track capabilities, volume and pause controls", () => check(`
  const stream = new MediaStream([{ kind: "video" }]);
  attachStream({ type: "load", playbackId: "direct", source: "", liveOutput: { picture: true, sound: true, volume: 75 }, preferences: { speed: 2, audioDelay: 1 } }, stream);
  assert.equal(video.srcObject, stream);
  assert.equal(video.volume, .75);
  video.duration = 60;
  video.dispatchEvent(new Event("canplay"));
  assert.equal(reports.at(-1).playbackId, "direct");
  assert.equal(reports.at(-1).status, "playing");
  assert.equal(reports.at(-1).duration, null);
  assert.equal(reports.at(-1).seekable, false);
  assert.equal(reports.at(-1).audioDelay, undefined);
  assert.equal(reports.at(-1).speed, 1);
  assert.deepEqual(reports.at(-1).tracks.map(track => track.kind), ["video"]);
  stream.tracks.push({ kind: "audio" }); streamChanged("direct", stream);
  assert.deepEqual(reports.at(-1).tracks.map(track => track.kind), ["video", "audio"]);
  play({ type: "volume", playbackId: "direct", volume: 0 });
  assert.equal(video.volume, 0);
  play({ type: "pause", playbackId: "direct", paused: true });
  assert.equal(reports.at(-1).status, "paused");
  play({ type: "pause", playbackId: "direct", paused: false });
  assert.equal(reports.at(-1).status, "playing");
  play({ type: "stop", playbackId: "direct" });
  assert.equal(video.srcObject, null);
  assert.equal(reports.at(-1).status, "idle");
`));

test("a direct stream bound before its tracks arrive plays once they do, unless it was paused", () => check(`
  // As in Chromium, binding a stream loads it again and pauses the element.
  let bound;
  const binds = [];
  Object.defineProperty(video, "srcObject", { get: () => bound, set: value => { bound = value; binds.push(value); video.paused = true; }, configurable: true });
  const stream = new MediaStream();
  attachStream({ type: "load", playbackId: "direct", source: "", liveOutput: { picture: true, sound: true, volume: 75 } }, stream);
  stream.tracks.push({ kind: "video" }); streamChanged("direct", stream);
  assert.equal(binds.filter(value => value === stream).length, 2, "the stream is bound again with its track");
  assert.equal(video.paused, false);
  const paused = new MediaStream();
  attachStream({ type: "load", playbackId: "paused", source: "", paused: true, liveOutput: { picture: true, sound: true, volume: 75 } }, paused);
  paused.tracks.push({ kind: "audio" }); streamChanged("paused", paused);
  assert.equal(binds.at(-1), paused);
  assert.equal(video.paused, true);
`));

test("stream errors report through Now Playing and cannot damage a replacement stream or HLS load", () => check(`
  const first = new MediaStream([{ kind: "audio" }]);
  attachStream({ type: "load", playbackId: "same", source: "" }, first);
  streamChanged("same", first, "connection failed");
  assert.equal(reports.at(-1).status, "error");
  const second = new MediaStream([{ kind: "video" }]);
  attachStream({ type: "load", playbackId: "same", source: "" }, second);
  streamChanged("same", first, "stale failure");
  assert.equal(reports.at(-1).error, null);
  load({ playbackId: "same", follow: { group: "group", pts: true } });
  streamChanged("same", second, "stale failure");
  await flush();
  assert.equal(reports.at(-1).error, null);
  assert.equal(video.srcObject, null);
  assert.equal(decoders.at(-1).media, video);
  assert.equal(video.muted, true);
`));

test("an old stream's rejected play request cannot mute its replacement", () => check(`
  let reject;
  video.play = () => new Promise((_, fail) => { reject = fail; });
  attachStream({ type: "load", playbackId: "same", source: "" }, new MediaStream([{ kind: "audio" }]));
  video.play = () => { video.paused = false; return Promise.resolve(); };
  attachStream({ type: "load", playbackId: "same", source: "" }, new MediaStream([{ kind: "video" }, { kind: "audio" }]));
  reject(new DOMException("old request", "NotAllowedError"));
  await flush();
  assert.equal(video.muted, false);
`));

test("direct streams retain the normal external subtitle settings across delivery changes", () => check(`
  const command = { type: "load", playbackId: "same", source: "", subtitles: [{ source: "https://couch.example/captions.vtt", title: "Captions", language: "en" }], subtitleTrack: 0, subtitleDelay: .5 };
  attachStream(command, new MediaStream([{ kind: "video" }]));
  video.dispatchEvent(new Event("canplay"));
  assert.equal(reports.at(-1).subtitleDelay, .5);
  assert.deepEqual(reports.at(-1).tracks.filter(track => track.kind === "subtitle").map(track => [track.label, track.selected]), [["Captions", true]]);
  play({ type: "track", playbackId: "same", kind: "subtitle", index: -1 });
  assert.equal(reports.at(-1).tracks.find(track => track.kind === "subtitle").selected, false);
  load({ ...command, source: "https://couch.example/stream.m3u8", follow: { group: "group", pts: true } });
  await flush();
  attachStream(command, new MediaStream([{ kind: "video" }]));
  video.dispatchEvent(new Event("canplay"));
  assert.equal(reports.at(-1).tracks.find(track => track.kind === "subtitle").selected, true);
  assert.equal(reports.at(-1).subtitleDelay, .5);
`));

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
  video.error = { code: MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED, message: "MEDIA_ELEMENT_ERROR: Format error" };
  video.dispatchEvent(new Event("error"));
  await flush();
  assert.equal(decoders.length, 0);
  assert.equal(reports.at(-1).status, "error");
  assert.equal(reports.at(-1).error, video.error.message);
`));

test("source-open failures keep the browser's reason without diagnosing a codec failure", () => check(`
  load({ source: "https://couch.example/movie.mp4" });
  video.error = { code: MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED, message: "MEDIA_ELEMENT_ERROR: Format error" };
  video.dispatchEvent(new Event("error"));
  assert.equal(reports.at(-1).status, "error");
  assert.equal(reports.at(-1).error, video.error.message);
  video.error = { code: MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED, message: "" };
  video.dispatchEvent(new Event("error"));
  assert.match(reports.at(-1).error, /couldn't load/);
  assert.doesNotMatch(reports.at(-1).error, /can't play this format/);
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

test("compressor settings received while HLS imports do not discard the current load", () => check(`
  load();
  play({ type: "compressor", playbackId: "playback", settings: { enabled: false, threshold: -24, ratio: 4, attack: 10, release: 250, knee: 9, gain: 0 } });
  await flush();
  assert.equal(decoders.length, 1);
  assert.equal(decoders[0].media, video);
`));
