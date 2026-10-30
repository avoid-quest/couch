import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";

// Load the real renderer in a fresh browser-shaped environment for each case.
// Mock only the browser and decoder boundaries, not the renderer's engine choice.
const check = (source: string, realPictureClock = false) => {
  const result = spawnSync(process.execPath, ["-e", `
    import assert from "node:assert/strict";
    import { mock } from "bun:test";
    mock.module("./src/client/session/sendspin.ts", () => ({ soundClock: () => clockSample }));
    mock.module("./src/client/session/device-id.ts", () => ({ localDeviceName: () => "Receiver" }));
    const clockTimers = new Set(), timingUpdates = [], timingAttachments = [];
    const tickPicture = () => { for (const tick of clockTimers) tick(); };
    if (${realPictureClock}) {
      globalThis.setInterval = tick => { clockTimers.add(tick); return tick; };
      globalThis.clearInterval = tick => { clockTimers.delete(tick); };
      mock.module("timing-object", () => ({ TimingObject: class { update(sample) { timingUpdates.push(sample); return Promise.resolve(); } } }));
      mock.module("timingsrc", () => ({ setTimingsrc: (element, timing) => { const attachment = { element, timing }; timingAttachments.push(attachment); return () => { attachment.closed = true; }; } }));
      const { followClock } = await import("./src/client/session/picture-clock.ts");
      mock.module("./src/client/session/picture-clock.ts", () => ({ followClock: (element, read, start) => {
        pictureRead = read;
        const stop = followClock(element, read, start);
        return () => { stop(); pictureRead = undefined; };
      } }));
    } else mock.module("./src/client/session/picture-clock.ts", () => ({ followClock: (_video, read) => { pictureRead = read; return () => { pictureRead = undefined; }; } }));
    const contexts = [], graphs = [];
    mock.module("./src/client/session/compressor.ts", () => ({ createCompressor: () => {
      const graph = { input: {}, output: { connect() {} }, set() {}, volume(value) { this.level = value; }, close() { this.closed = true; } };
      graphs.push(graph); return graph;
    } }));
    globalThis.AudioContext = class {
      state = "suspended"; destination = {};
      constructor() { contexts.push(this); }
      createMediaElementSource(element) { return this.source = { element, connect() {}, disconnect() { this.disconnected = true; } }; }
      resume() { this.state = "running"; return Promise.resolve(); }
      suspend() { this.state = "suspended"; return Promise.resolve(); }
      close() { this.state = "closed"; return Promise.resolve(); }
    };
    let mse = true, nativeHls = "probably";
    const decoders = [], transports = [], media = [], reports = [];
    let clockSample = null, pictureRead;
    class Element extends EventTarget {
      style = {}; dataset = {}; children = []; attributes = new Map();
      currentTime = 0; duration = Infinity; volume = 1; paused = true; playbackRate = 1; defaultPlaybackRate = 1; readyState = 0;
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
      replaceWith(next) { const parent = this.parent; parent.children.splice(parent.children.indexOf(this), 1, next); next.parent = parent; }
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
    globalThis.HTMLMediaElement = { HAVE_METADATA: 1 };
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
      static ErrorTypes = { NETWORK_ERROR: "networkError" };
      audioTracks = []; subtitleTracks = [];
      listeners = new Map();
      constructor(config) { this.config = config; decoders.push(this); }
      on(event, listener) { this.listeners.set(event, [...this.listeners.get(event) ?? [], listener]); }
      once(event, listener) { const once = (...args) => { this.listeners.set(event, this.listeners.get(event).filter(item => item !== once)); listener(...args); }; this.on(event, once); }
      emit(event, data) { for (const listener of this.listeners.get(event) ?? []) listener(event, data); }
      loadSource(source) { this.source = source; }
      attachMedia(element) { this.media = element; }
      broadcastCaptions() {
        // hls.js's timeline controller creates CEA captions outside subtitleTracks.
        if (this.config.enableCEA708Captions !== false) this.media.textTracks.push({ kind: "captions", label: "English", language: "en", mode: "showing" });
      }
      destroy() { this.destroyed = true; }
    }
    mock.module("hls.js", () => ({ default: Hls }));
    mock.module("mpegts.js", () => ({ default: {
      getFeatureList: () => ({ mseLivePlayback: true }), Events: { ERROR: "error" }, ErrorTypes: { MEDIA_ERROR: "media" },
      createPlayer(input, config) {
        const player = { input, config, on(_event, callback) { this.error = callback; }, attachMediaElement(element) { this.media = element; }, load() {}, destroy() { this.destroyed = true; } };
        transports.push(player); return player;
      },
    } }));
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

test("external subtitles remain the only visible captions and Off disables them all", () => check(`
  for (const subtitles of ["off", "on"]) {
    load({ subtitles: [{ source: "https://couch.example/english.vtt", title: "English", language: "en" }], preferences: { subtitles, subtitleLanguage: "en" } });
    await flush();
    const decoder = decoders.at(-1);
    decoder.emit(Hls.Events.LEVEL_LOADED, {});
    video.dispatchEvent(new Event("canplay"));
    decoder.broadcastCaptions();
    assert.equal(video.textTracks.filter(track => track.mode === "showing").length, subtitles === "off" ? 0 : 1, "in-band CEA captions must not bypass the chosen external subtitles");
    play({ type: "track", playbackId: "playback", kind: "subtitle", index: -1 });
    await flush();
    assert.ok(video.textTracks.every(track => track.mode !== "showing"), "Subtitle Off leaves no captions showing");
  }
  load();
  await flush();
  decoders.at(-1).broadcastCaptions();
  assert.ok(video.textTracks.some(track => track.kind === "captions"), "streams without external subtitles keep their in-band captions");
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

test("replacing compressed split audio disposes its graph and restores native media elements", () => check(`
  load({ source: "https://couch.example/movie.mp4", audioSource: "https://couch.example/audio.m4a", compressor: { enabled: true, threshold: -24, ratio: 4, attack: 10, release: 250, knee: 9, gain: 0 } });
  await flush();
  assert.equal(contexts[0].source.element, audio, "compression processes the selected audio rendition");
  play({ type: "volume", playbackId: "playback", volume: 40 });
  assert.equal(graphs[0].level, .4);
  load({ playbackId: "replacement", source: "https://couch.example/next.mp4" });
  await flush();
  assert.equal(contexts[0].state, "closed");
  assert.equal(contexts[0].source.disconnected, true);
  assert.equal(graphs[0].closed, true);
  assert.equal(video.src, ""); assert.equal(audio.src, "");
  assert.equal(media[2].src, "https://couch.example/next.mp4");
  assert.equal(media[2].crossOrigin, null, "native output no longer needs compressor CORS");
  assert.equal(media[2].volume, .4);
  video.error = { code: 3, message: "stale compressed element" };
  video.dispatchEvent(new Event("error"));
  assert.equal(reports.at(-1).error, null);
  assert.equal(reports.at(-1).playbackId, "replacement");
`));


test("sound-only selects the audio rendition without opening video and restores picture on a reload", () => check(`
  const options = { playbackId: "same", source: "https://couch.example/movie.mp4", audioSource: "https://couch.example/audio.m4a", startPosition: 42, paused: true, preferences: { speed: 1.5, audioDelay: .2 } };
  load({ ...options, output: { picture: false, sound: true } });
  await flush();
  assert.equal(video.src, options.audioSource);
  assert.equal(audio.src, "");
  assert.equal(decoders.length, 0);
  assert.equal(video.currentTime, 42);
  assert.equal(video.playbackRate, 1.5);
  assert.equal(video.muted, false);
  video.dispatchEvent(new Event("canplay"));
  assert.equal(reports.at(-1).tracks.some(track => track.kind === "video"), false);
  load({ ...options, output: { picture: true, sound: true } });
  assert.equal(video.src, options.source);
  assert.equal(audio.src, options.audioSource);
  assert.equal(video.currentTime, 42);
  assert.equal(reports.at(-1).playbackId, "same");
`));

test("muted scheduled pictures do not load a redundant audio rendition", () => check(`
  load({ source: "https://couch.example/movie.mp4", audioSource: "https://couch.example/audio.m4a", follow: { group: "g", pts: false }, output: { picture: true, sound: false }, preferences: { speed: 1.25 } });
  await flush();
  assert.equal(video.src, "https://couch.example/movie.mp4");
  assert.equal(audio.src, "");
  assert.equal(video.muted, true);
  video.playbackRate = 1.29;
  video.dispatchEvent(new Event("timeupdate"));
  play({ type: "volume", playbackId: "playback", volume: 50 });
  assert.equal(reports.at(-1).speed, 1.25, "corrective rate must never become programme speed");
`));

test("HLS reports measured source PTS mapping and destroyed callbacks cannot alter replacement", () => check(`
  video.readyState = HTMLMediaElement.HAVE_METADATA;
  clockSample = { position: 112, speed: 1 };
  load({ paused: true, follow: { group: "g", pts: true, timeline: { kind: "source-pts", mapping: "hls", generation: "one" } } });
  await flush();
  tickPicture();
  assert.equal(timingAttachments.length, 0, "mapped following waits for measured PTS");
  const first = decoders.at(-1);
  first.emit(Hls.Events.INIT_PTS_FOUND, { id: "main", initPTS: 9000000, timescale: 90000 });
  tickPicture();
  assert.deepEqual(pictureRead(), { position: 12, speed: 1 });
  assert.deepEqual(timingUpdates.at(-1), { position: 12, velocity: 1 });
  assert.equal(timingAttachments.length, 1, "measured mapping retains full position synchronization");
  assert.equal(reports.at(-1).timeline.mapping, "hls");
  load({ source: "https://couch.example/movie.mp4" });
  assert.equal(first.destroyed, true);
  assert.equal(timingAttachments[0].closed, true);
  assert.equal(clockTimers.size, 0);
  first.emit(Hls.Events.ERROR, { fatal: true, details: "old error" });
  first.emit(Hls.Events.LEVEL_LOADED, {});
  assert.equal(reports.at(-1).error, null);
  assert.equal(video.src, "https://couch.example/movie.mp4");
`, true));

test("a playing HLS picture that starts following its own group keeps its measured source PTS", () => check(`
  video.readyState = HTMLMediaElement.HAVE_METADATA;
  clockSample = { position: 112, speed: 1 };
  load();
  await flush();
  decoders.at(-1).emit(Hls.Events.INIT_PTS_FOUND, { id: "main", initPTS: 9000000, timescale: 90000 });
  play({ type: "follow", playbackId: "playback", follow: { group: "g", pts: true, timeline: { kind: "source-pts", mapping: "hls", generation: "playback" } } });
  await flush();
  tickPicture();
  assert.deepEqual(pictureRead(), { position: 12, speed: 1 }, "no reload: the decoder will not measure again");
  play({ type: "follow", playbackId: "playback", follow: { group: "g", pts: true, timeline: { kind: "source-pts", mapping: "hls", generation: "other" } } });
  await flush();
  assert.equal(pictureRead(), null, "a follow for another load has no mapping");
`, true));

test("native HLS and MPEG-TS expose missing source mapping without fabricating a join offset", () => check(`
  mse = false;
  delete window.MediaSource;
  video.readyState = HTMLMediaElement.HAVE_METADATA;
  clockSample = { position: 999, speed: 1 };
  const follow = { group: "g", pts: true, timeline: { kind: "source-pts", mapping: "unavailable", generation: "one" } };
  load({ follow });
  await flush();
  tickPicture();
  assert.deepEqual(pictureRead(), { speed: 1 });
  assert.equal(reports.at(-1).timeline.mapping, "unavailable");
  assert.match(reports.at(-1).timeline.error, /cannot align/);
  assert.equal(video.paused, false, "unmapped relaxed picture remains viewable");
  clockSample = { position: 999, speed: 0 };
  load({ source: "https://couch.example/channel.ts", mpegts: true, follow, paused: true, preferences: { speed: 1.5, audioDelay: .3 }, subtitles: [{ source: "/captions.vtt", title: "Captions" }] });
  await flush();
  tickPicture();
  assert.equal(transports.length, 1);
  assert.equal(transports[0].media, video);
  assert.equal(video.playbackRate, 1.5);
  assert.equal(video.paused, true);
  assert.deepEqual(pictureRead(), { speed: 0 });
  play({ type: "stop", playbackId: "playback" });
  assert.equal(transports[0].destroyed, true);
  transports[0].error("network", "late failure");
  assert.equal(reports.at(-1).status, "idle");
  assert.equal(reports.at(-1).error, null);
`, true));

test("switching to scheduled picture stops separate audio and stopping cancels pending MPEG-TS", () => check(`
  load({ source: "https://couch.example/movie.mp4", audioSource: "https://couch.example/audio.m4a" });
  audio.paused = false;
  play({ type: "follow", playbackId: "playback", follow: { group: "g", pts: false } });
  assert.equal(audio.paused, true);
  assert.equal(audio.src, "");
  assert.equal(video.muted, true);
  load({ mpegts: true, source: "https://couch.example/channel.ts" });
  play({ type: "stop", playbackId: "playback" });
  await flush();
  assert.equal(transports.length, 0);
  assert.equal(video.src, "");
  assert.equal(audio.src, "");
`));

test("native HLS fallback stays playable and reports unavailable PTS mapping even with an MSE symbol", () => check(`
  mse = false;
  video.readyState = HTMLMediaElement.HAVE_METADATA;
  assert.ok(window.MediaSource, "the symbol exists even though hls.js rejects this platform");
  clockSample = { position: 112, speed: 1 };
  load({ follow: { group: "g", pts: true, timeline: { kind: "source-pts", mapping: "hls", generation: "one" } } });
  await flush();
  tickPicture();
  assert.equal(decoders.length, 0);
  assert.equal(video.src, "https://couch.example/stream.m3u8");
  assert.equal(video.paused, false);
  assert.equal(video.muted, true);
  assert.deepEqual(pictureRead(), { speed: 1 });
  assert.equal(reports.at(-1).timeline.mapping, "unavailable");
  assert.match(reports.at(-1).timeline.error, /cannot align/);
`, true));

test("content audio delay is reported and applied only by the split-audio adapter", () => check(`
  load({ source: "https://couch.example/movie.mp4", paused: true, preferences: { audioDelay: .3 } });
  assert.equal(reports.at(-1).audioDelay, undefined, "muxed native media has no content-delay adapter");
  load({ source: "https://couch.example/movie.mp4", audioSource: "https://couch.example/audio.m4a", paused: true, preferences: { audioDelay: .3 } });
  video.currentTime = 10;
  video.dispatchEvent(new Event("canplay"));
  video.dispatchEvent(new Event("seeked"));
  assert.equal(reports.at(-1).audioDelay, .3);
  assert.equal(audio.currentTime, 9.7);
  play({ type: "audioDelay", playbackId: "playback", delay: .5 });
  assert.equal(audio.currentTime, 9.5);
  load({ source: "https://couch.example/movie.mp4", audioSource: "https://couch.example/audio.m4a", output: { picture: false, sound: true } });
  assert.equal(reports.at(-1).audioDelay, undefined, "selected sound-only rendition needs no A/V content delay");
`));

for (const mpegts of [false, true]) test(`${mpegts ? "MPEG-TS" : "native HLS"} Core-paused picture follows running group transport without mapped seeks`, () => check(`
  mse = false;
  assert.ok(window.MediaSource, "native fallback must work even with an unsupported MSE implementation");
  clockSample = { position: 999, speed: 1.5 };
  // Core's screenLoad always sends paused:true; the programme clock owns transport.
  load({ ${mpegts ? 'source: "https://couch.example/channel.ts", mpegts: true,' : ''}
    paused: true, output: { picture: true, sound: false }, preferences: { speed: 1.25 },
    follow: { group: "g", pts: true, timeline: { kind: "source-pts", mapping: ${mpegts ? '"unavailable"' : '"hls"'}, generation: "one" } } });
  await flush();
  tickPicture();
  assert.equal(video.paused, true, "wait for decoder metadata before applying the group transport");
  video.currentTime = 17;
  video.readyState = HTMLMediaElement.HAVE_METADATA;
  video.dispatchEvent(new Event("canplay"));
  tickPicture();
  video.dispatchEvent(new Event("playing"));
  assert.equal(video.paused, false, "initial join must start the already-running programme despite load.paused");
  assert.equal(video.playbackRate, 1.5);
  assert.equal(reports.at(-1).speed, 1.5);
  assert.equal(reports.at(-1).timeline.mapping, "unavailable");
  assert.match(reports.at(-1).timeline.error, /cannot align/);
  assert.equal(video.muted, true);
  assert.equal(video.currentTime, 17, "an unmapped clock cannot reposition the picture");
  assert.equal(timingAttachments.length, 0, "do not attach the position synchronizer without a mapping");
  assert.equal(timingUpdates.length, 0);

  clockSample = { position: 2000, speed: 0 };
  tickPicture();
  video.dispatchEvent(new Event("pause"));
  assert.equal(video.paused, true, "later group pause reaches the fallback picture");
  assert.equal(reports.at(-1).speed, 1.5, "pause is not a new programme rate of zero");
  clockSample = { position: 5000, speed: .75 };
  tickPicture();
  video.dispatchEvent(new Event("playing"));
  assert.equal(video.paused, false, "later group resume reaches the fallback picture");
  assert.equal(video.playbackRate, .75);
  assert.equal(reports.at(-1).speed, .75);
  assert.equal(video.currentTime, 17, "resume does not invent a PTS offset or seek");

  clockSample = null;
  tickPicture();
  assert.equal(video.paused, true, "clock loss waits rather than running without group transport");
  clockSample = { position: 6000, speed: 1 };
  tickPicture();
  assert.equal(video.paused, false);
  load({ playbackId: "replacement", source: "https://couch.example/movie.mp4", paused: true });
  await flush();
  tickPicture();
  assert.equal(video.paused, true, "disposed group following cannot start a replacement load");
  assert.equal(clockTimers.size, 0);
`, true));

test("refused or unreachable HLS reports its HTTP status or an unavailable source instead of the decoder's error name", () => check(`
  load();
  await flush();
  decoders.at(-1).emit(Hls.Events.ERROR, { fatal: true, type: "networkError", details: "manifestLoadError", response: { code: 404, text: "Not Found" } });
  assert.equal(reports.at(-1).error, "The media server refused this stream (HTTP 404).");
  load();
  await flush();
  decoders.at(-1).emit(Hls.Events.ERROR, { fatal: true, type: "networkError", details: "manifestLoadError" });
  assert.equal(reports.at(-1).error, "This media couldn't load. The source may be unavailable or unsupported.", "a status hidden by CORS still reads as an unavailable source");
  load();
  await flush();
  decoders.at(-1).emit(Hls.Events.ERROR, { fatal: true, details: "manifestParsingError" });
  assert.equal(reports.at(-1).error, "The stream failed (manifestParsingError).", "failures without an HTTP status keep their detail");
`));
