import { expect, test } from "bun:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

// Load the real renderer in a fresh browser-shaped environment for each case.
// Mock only the browser and decoder boundaries, not the renderer's engine choice.
const check = (source: string, realPictureClock = false) => {
  const result = spawnSync(
    process.execPath,
    [
      "-e",
      `
    import assert from "node:assert/strict";
    import { mock } from "bun:test";
    mock.module("./src/client/session/sendspin.ts", () => ({ soundClock: () => clockSample }));
    mock.module("./src/client/session/device-id.ts", () => ({ localDeviceName: () => "Receiver" }));
    const realBuffered = await import("./src/client/session/buffered.ts");
    let bufferedReport = null;
    mock.module("./src/client/session/buffered.ts", () => ({ ...realBuffered, setBuffered: value => { bufferedReport = value; } }));
    const clockTimers = new Set();
    const tickPicture = () => { for (const tick of clockTimers) tick(); };
    if (${realPictureClock}) {
      globalThis.setInterval = tick => { clockTimers.add(tick); return tick; };
      globalThis.clearInterval = tick => { clockTimers.delete(tick); };
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
    globalThis.HTMLMediaElement = { HAVE_METADATA: 1, HAVE_FUTURE_DATA: 3 };
    globalThis.MediaStream = class {
      constructor(tracks = []) { this.tracks = tracks; }
      getTracks() { return this.tracks; }
      getAudioTracks() { return this.tracks.filter(track => track.kind === "audio"); }
      getVideoTracks() { return this.tracks.filter(track => track.kind === "video"); }
    };
    Object.defineProperty(globalThis, "navigator", { value: { userAgent: "Chrome/140 Android" }, configurable: true });
    class Hls {
      static isSupported() { return mse; }
      static Events = { ERROR: "error", INIT_PTS_FOUND: "pts", MANIFEST_PARSED: "manifest", LEVEL_LOADED: "level", AUDIO_TRACKS_UPDATED: "audio-tracks", AUDIO_TRACK_SWITCHED: "audio-switch", SUBTITLE_TRACKS_UPDATED: "subtitle-tracks", SUBTITLE_TRACK_SWITCH: "subtitle-switch" };
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
  `,
    ],
    { cwd: new URL("../", import.meta.url), encoding: "utf8" },
  );
  expect(result.stderr).toBe("");
  expect(result.status).toBe(0);
};

test("16 subtitle tracks and HLS initialization do not flood Core with identical reports", () =>
  check(`
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

test("report deduplication preserves position ticks, controls, failures and new subscribers", () =>
  check(`
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
  video.error = { code: 3, message: "decoder failed" };
  video.dispatchEvent(new Event("error"));
  assert.equal(reports.at(-1).status, "error");
  assert.equal(reports.at(-1).error, "decoder failed");
  const reconnected = [];
  connectRenderer(state => reconnected.push(state));
  assert.deepEqual(reconnected, [reports.at(-1)], "a new connection receives even an unchanged state");
`));

test("external subtitles remain the only visible captions and Off disables them all", () =>
  check(`
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

test("blocked audio is replayed when the shell subscribes again after recovery", () =>
  check(`
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

test("a direct stream bound before its tracks arrive plays once they do, unless it was paused", () =>
  check(`
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

test("stream errors report through Now Playing and cannot damage a replacement stream or HLS load", () =>
  check(`
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

test("Couch-hosted HLS uses hls.js even when the browser also advertises native HLS", () =>
  check(`
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

test("cross-origin HLS keeps native playback and its existing decoder fallback", () =>
  check(`
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

test("native HLS failure reports an error instead of retrying the same native source", () =>
  check(`
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

test("an asynchronous HLS load cannot replace or fail a newer ordinary load", () =>
  check(`
  load();
  load({ playbackId: "new", source: "https://couch.example/movie.mp4" });
  await flush();
  assert.equal(decoders.length, 0);
  assert.equal(video.src, "https://couch.example/movie.mp4");
  assert.equal(reports.at(-1).playbackId, "new");
  assert.equal(reports.at(-1).error, null);
`));

test("replacing compressed split audio disposes its graph and restores native media elements", () =>
  check(`
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

test("muted scheduled pictures do not load a redundant audio rendition", () =>
  check(`
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

test("HLS reports measured source PTS mapping and destroyed callbacks cannot alter replacement", () =>
  check(
    `
  video.readyState = HTMLMediaElement.HAVE_METADATA;
  clockSample = { position: 112, speed: 1 };
  load({ paused: true, follow: { group: "g", pts: true, timeline: { kind: "source-pts", mapping: "hls", generation: "one" } } });
  await flush();
  tickPicture();
  assert.equal(video.currentTime, 0, "mapped following waits for measured PTS");
  const first = decoders.at(-1);
  first.emit(Hls.Events.INIT_PTS_FOUND, { id: "main", initPTS: 9000000, timescale: 90000, frag: { cc: 0, start: 0 } });
  tickPicture();
  assert.deepEqual(pictureRead(), { position: 12, speed: 1 });
  assert.equal(video.currentTime, 14, "an unbuffered picture waits ahead of the mapped sound");
  // A Twitch ad on this Device's stream: its own timestamps from media time 30, then the programme again at 60.
  first.latestLevelDetails = { fragmentStart: 0, edge: 70, targetduration: 2 };
  first.emit(Hls.Events.INIT_PTS_FOUND, { id: "main", initPTS: -30, timescale: 1, frag: { cc: 1, start: 30 } });
  assert.deepEqual(pictureRead(), { position: 12, speed: 1 }, "an ad parsed ahead doesn't move the programme's mapping");
  clockSample = { position: 145, speed: 1 };
  assert.deepEqual(pictureRead(), { speed: 1 }, "during this Device's ad the picture follows transport only");
  first.emit(Hls.Events.INIT_PTS_FOUND, { id: "main", initPTS: 100, timescale: 1, frag: { cc: 2, start: 60 } });
  clockSample = { position: 165, speed: 1 };
  assert.deepEqual(pictureRead(), { position: 65, speed: 1 }, "the programme maps again after the ad");
  // An encoder restart at media time 70 sends timestamps back ten seconds: 165 maps into both stretches.
  first.latestLevelDetails = { fragmentStart: 0, edge: 80, targetduration: 2 };
  first.emit(Hls.Events.INIT_PTS_FOUND, { id: "main", initPTS: 90, timescale: 1, frag: { cc: 3, start: 70 } });
  video.currentTime = 74;
  assert.deepEqual(pictureRead(), { position: 75, speed: 1 }, "the stretch nearer the picture wins");
  assert.equal(reports.at(-1).timeline.mapping, "hls");
  load({ source: "https://couch.example/movie.mp4" });
  assert.equal(first.destroyed, true);
  assert.equal(clockTimers.size, 0);
  first.emit(Hls.Events.ERROR, { fatal: true, details: "old error" });
  first.emit(Hls.Events.LEVEL_LOADED, {});
  assert.equal(reports.at(-1).error, null);
  assert.equal(video.src, "https://couch.example/movie.mp4");
`,
    true,
  ));

for (const mpegts of [false, true])
  test(`${mpegts ? "MPEG-TS" : "native HLS"} Core-paused picture follows running group transport without mapped seeks`, () =>
    check(
      `
  mse = false;
  assert.ok(window.MediaSource, "native fallback must work even with an unsupported MSE implementation");
  clockSample = { position: 999, speed: 1.5 };
  // Core's screenLoad always sends paused:true; the programme clock owns transport.
  load({ ${mpegts ? 'source: "https://couch.example/channel.ts", mpegts: true,' : ""}
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
`,
      true,
    ));

// A picture following the shared sound over a slow link (the Twitch freeze): Chromium-shaped media
// element with an explicit buffer, a clock 250 ms on per step.
const followed = (ranges: [number, number][] = []) => {
  const seeks: number[] = [];
  let time = 0;
  const video = {
    seeks,
    ranges,
    get currentTime() {
      return time;
    },
    set currentTime(value: number) {
      time = value;
      seeks.push(value);
    },
    play(seconds: number) {
      if (!video.paused) time += seconds * video.playbackRate;
    },
    playbackRate: 1,
    defaultPlaybackRate: 1,
    paused: true,
    seeking: false,
    readyState: 1,
    buffered: {
      get length() {
        return ranges.length;
      },
      start: (index: number) => ranges[index]![0],
      end: (index: number) => ranges[index]![1],
    },
    pause() {
      video.paused = true;
    },
  };
  return video;
};
const follower = async (video: ReturnType<typeof followed>, clock: { position: number }) => {
  Object.assign(globalThis, { HTMLMediaElement: { HAVE_METADATA: 1, HAVE_FUTURE_DATA: 3 } });
  const { createFollower } = await import("../src/client/session/picture-clock");
  const step = createFollower(
    video as unknown as HTMLVideoElement,
    () => ({ position: clock.position, speed: 1 }),
    () => {
      video.paused = false;
    },
  );
  return (seconds = 0.25) => {
    clock.position += seconds;
    video.play(seconds);
    step();
  };
};

test("a picture without data where the sound is waits ahead once instead of chasing it", async () => {
  const video = followed();
  const clock = { position: 30 };
  const step = await follower(video, clock);
  step();
  assert.deepEqual(video.seeks, [32.25], "parks two seconds ahead of the sound");
  video.seeking = true;
  for (let index = 0; index < 6; index++) step();
  assert.equal(video.seeks.length, 1, "no seek while its picture loads");
  video.ranges.push([31.9, 40]);
  video.seeking = false;
  video.readyState = 4;
  step();
  assert.equal(video.paused, true, "holds its frame until the sound arrives");
  while (clock.position < 32.25) step();
  assert.equal(video.paused, false);
  assert.equal(video.seeks.length, 1);
  assert.ok(Math.abs(clock.position - video.currentTime) < 0.05);
});

test("a picture whose link never catches up waits further ahead each time, not every tick", async () => {
  const video = followed();
  const clock = { position: 30 };
  const step = await follower(video, clock);
  for (let index = 0; index < 120; index++) {
    step();
    video.seeking = false;
  }
  // 2 s ahead, then 4, then 8 s ahead each time its picture misses.
  assert.deepEqual(video.seeks, [32.25, 37, 45.75, 54.5, 63.25]);
});

test("small drift moves the rate by at most 5% and a buffered second away seeks once", async () => {
  const video = followed([[0, 100]]);
  const clock = { position: 10.3 };
  video.readyState = 4;
  const step = await follower(video, clock);
  video.currentTime = 10;
  video.seeks.length = 0;
  step();
  assert.equal(video.paused, false);
  assert.equal(video.playbackRate, 1.05);
  video.currentTime = 10.6;
  video.seeks.length = 0;
  step();
  assert.ok(video.playbackRate < 1 && video.playbackRate >= 0.95);
  clock.position = 20;
  step();
  assert.equal(video.seeks.length, 1);
  step();
  step();
  assert.equal(video.seeks.length, 1, "lands, then corrects the rest by rate");
});

test("a picture near a film's end waits at the end, not past it, and holds its last frame", async () => {
  const video = followed();
  // At its end a media element is paused and ended, and play() restarts it from its first frame.
  Object.defineProperties(video, {
    duration: { value: 100 },
    ended: { get: () => video.currentTime >= 100 },
  });
  const clock = { position: 98.75 };
  const step = await follower(video, clock);
  step();
  assert.deepEqual(video.seeks, [100]);
  // The sound outlasts the picture.
  while (clock.position < 102) step();
  assert.deepEqual(video.seeks, [100]);
  assert.equal(video.paused, true, "not restarted from its first frame");
});

test("separate sound buffering holds the picture and resumes both without chasing the empty sound buffer", () =>
  check(`
  load({ source: "https://couch.example/movie.mp4", audioSource: "https://couch.example/audio.m4a" });
  video.duration = 60;
  video.readyState = audio.readyState = 4;
  video.dispatchEvent(new Event("canplay"));
  video.dispatchEvent(new Event("playing"));
  video.currentTime = audio.currentTime = 10;
  audio.readyState = 2;
  audio.dispatchEvent(new Event("waiting"));
  assert.equal(video.paused, true, "picture waits when its separate sound runs out");
  assert.equal(audio.paused, false, "the starved audio must keep decoding so it can become ready again");
  assert.equal(reports.at(-1).status, "loading");
  assert.equal(reports.at(-1).buffering, true);
  for (let i = 0; i < 3; i++) video.dispatchEvent(new Event("timeupdate"));
  assert.equal(audio.currentTime, 10, "recovery keeps one audio position instead of chasing ahead");
  play({ type: "seek", playbackId: "playback", position: 30 });
  assert.equal(audio.currentTime, 30, "an explicit seek moves the held sound to its new destination");
  assert.equal(video.currentTime, 30);
  assert.equal(video.paused, true);
  play({ type: "audioDelay", playbackId: "playback", delay: 1 });
  assert.equal(audio.currentTime, 29, "changing the delay moves held sound to its new target");
  audio.readyState = 4;
  audio.dispatchEvent(new Event("canplay"));
  assert.equal(video.paused, false, "the picture resumes when sound has data again");
  video.dispatchEvent(new Event("playing"));
  assert.equal(audio.paused, false);
  assert.equal(reports.at(-1).status, "playing");
  assert.equal(reports.at(-1).buffering, false);
`));

test("Pause during separate sound buffering survives data arriving and a replacement load", () =>
  check(`
  load({ source: "https://couch.example/movie.mp4", audioSource: "https://couch.example/audio.m4a" });
  video.duration = 60;
  video.readyState = audio.readyState = 4;
  video.dispatchEvent(new Event("canplay"));
  video.dispatchEvent(new Event("playing"));
  audio.readyState = 2;
  audio.dispatchEvent(new Event("waiting"));
  play({ type: "pause", playbackId: "playback", paused: true });
  assert.equal(reports.at(-1).status, "paused");
  assert.equal(reports.at(-1).buffering, false);
  assert.equal(audio.paused, true, "explicit Pause also pauses the starved sound");
  audio.readyState = 4;
  audio.dispatchEvent(new Event("canplay"));
  assert.equal(video.paused, true, "data arrival must not undo the person's Pause");
  play({ type: "pause", playbackId: "playback", paused: false });
  video.dispatchEvent(new Event("playing"));
  audio.readyState = 2;
  audio.dispatchEvent(new Event("waiting"));
  load({ source: "https://couch.example/next.mp4", paused: true });
  video.dispatchEvent(new Event("canplay"));
  audio.readyState = 4;
  audio.dispatchEvent(new Event("canplay"));
  assert.equal(video.paused, true, "an old audio event cannot start a replacement");
`));

test("the loaded timeline includes separate sound, its progress and the audio delay", () =>
  check(`
  load({ source: "https://couch.example/movie.mp4", audioSource: "https://couch.example/audio.m4a" });
  video.duration = 60;
  video.currentTime = audio.currentTime = 2.5;
  video.buffered = { length: 1, start: () => 0, end: () => 20 };
  audio.buffered = { length: 1, start: () => 0, end: () => 3 };
  video.dispatchEvent(new Event("progress"));
  assert.equal(bufferedReport.end, 3, "loaded picture alone cannot promise playable A/V");
  audio.buffered = { length: 0 };
  audio.dispatchEvent(new Event("progress"));
  assert.equal(bufferedReport, null, "sound without a current range leaves no loaded segment");
  audio.buffered = { length: 1, start: () => 0, end: () => 8 };
  audio.dispatchEvent(new Event("progress"));
  assert.equal(bufferedReport.end, 8, "sound arriving while the picture is held updates its loaded segment");
  play({ type: "audioDelay", playbackId: "playback", delay: 2 });
  assert.equal(bufferedReport.end, 10, "sound's loaded end is mapped onto the picture timeline");
  video.currentTime = 11;
  video.dispatchEvent(new Event("seeking"));
  assert.equal(bufferedReport, null, "a seek outside the loaded sound has no playable range");
  load({ source: "https://couch.example/next.mp4" });
  video.currentTime = 2.5;
  video.dispatchEvent(new Event("progress"));
  assert.equal(bufferedReport.end, 20, "an ordinary muxed source keeps its own loaded range");
`));

test("separate sound stays silent outside its delayed timeline", () =>
  check(`
  load({ source: "https://couch.example/movie.mp4", audioSource: "https://couch.example/audio.m4a", preferences: { audioDelay: 2 } });
  video.duration = audio.duration = 60;
  video.readyState = audio.readyState = 4;
  video.currentTime = .5;
  video.dispatchEvent(new Event("canplay"));
  video.dispatchEvent(new Event("playing"));
  assert.equal(audio.paused, true, "positive delay does not repeatedly play the first sound before its start");
  video.currentTime = 3;
  video.dispatchEvent(new Event("timeupdate"));
  assert.equal(audio.paused, false, "sound starts when the picture reaches its delayed timeline");
  assert.equal(audio.currentTime, 1);
  play({ type: "audioDelay", playbackId: "playback", delay: -2 });
  video.currentTime = 59;
  audio.currentTime = 60;
  audio.paused = true;
  video.dispatchEvent(new Event("timeupdate"));
  assert.equal(audio.paused, true, "an advanced sound track does not restart after its end");
`));

test("Pause during asynchronous decoder startup remains paused", () =>
  check(`
  for (const mpegts of [false, true]) {
    load({ mpegts });
    play({ type: "pause", playbackId: "playback", paused: true });
    await flush();
    assert.equal(video.paused, true, "the delayed decoder must honor Pause received during startup");
    load({ mpegts, paused: true });
    play({ type: "pause", playbackId: "playback", paused: false });
    await flush();
    assert.equal(video.paused, false, "the latest Play also survives startup");
    load({ mpegts });
    play({ type: "audioPause" });
    await flush();
    assert.equal(video.paused, true, "audio interruption remains paused through startup");
  }
`));

test("audio interruption cancels a separate sound buffer's pending play", () =>
  check(`
  load({ source: "https://couch.example/movie.mp4", audioSource: "https://couch.example/audio.m4a" });
  video.readyState = audio.readyState = 4;
  video.dispatchEvent(new Event("canplay"));
  video.dispatchEvent(new Event("playing"));
  audio.readyState = 2;
  audio.dispatchEvent(new Event("waiting"));
  assert.equal(video.paused, true);
  assert.equal(audio.paused, false);
  play({ type: "audioPause" });
  assert.equal(audio.paused, true, "an already held picture emits no new pause event to stop sound");
  audio.readyState = 4;
  audio.dispatchEvent(new Event("canplay"));
  assert.equal(video.paused, true);
  assert.equal(audio.paused, true, "data arrival cannot restart interrupted sound");
`));

test("terminal decoder failure stops buffered playback and cannot resume under its error", () =>
  check(`
  load({ audioSource: "https://couch.example/audio.m4a" });
  await flush();
  video.readyState = audio.readyState = 4;
  video.dispatchEvent(new Event("canplay"));
  video.dispatchEvent(new Event("playing"));
  assert.equal(video.paused, false);
  assert.equal(audio.paused, false);
  decoders.at(-1).emit(Hls.Events.ERROR, { fatal: false, type: Hls.ErrorTypes.NETWORK_ERROR, details: "fragLoadError" });
  assert.equal(video.paused, false, "ordinary decoder retries retain buffered playback");
  assert.equal(reports.at(-1).error, null);
  decoders.at(-1).emit(Hls.Events.ERROR, { fatal: true, type: Hls.ErrorTypes.NETWORK_ERROR, details: "fragLoadError" });
  assert.equal(reports.at(-1).status, "error");
  assert.equal(video.paused, true, "already buffered frames must not play behind the failure overlay");
  assert.equal(audio.paused, true);
  play({ type: "pause", playbackId: "playback", paused: false });
  assert.equal(video.paused, true, "a terminal decoder needs a new load, not a stale resume");
  load({ audioSource: "https://couch.example/audio.m4a" });
  await flush();
  video.dispatchEvent(new Event("canplay"));
  video.dispatchEvent(new Event("playing"));
  audio.readyState = 2;
  audio.dispatchEvent(new Event("waiting"));
  decoders.at(-1).emit(Hls.Events.ERROR, { fatal: true, type: Hls.ErrorTypes.NETWORK_ERROR, details: "fragLoadError" });
  audio.readyState = 4;
  audio.dispatchEvent(new Event("canplay"));
  assert.equal(video.paused, true, "late sound recovery cannot start failed media");
  assert.equal(audio.paused, true);
  assert.equal(reports.at(-1).buffering, false);
  load({ source: "https://couch.example/retry.mp4" });
  video.dispatchEvent(new Event("canplay"));
  assert.equal(video.paused, false, "an explicit replacement load can play again");
  assert.equal(reports.at(-1).error, null);
  load({ follow: { group: "g", pts: false } });
  await flush();
  clockSample = { position: 30, speed: 1 };
  assert.deepEqual(pictureRead(), clockSample);
  decoders.at(-1).emit(Hls.Events.ERROR, { fatal: true, type: Hls.ErrorTypes.NETWORK_ERROR, details: "fragLoadError" });
  assert.equal(pictureRead(), null, "shared sound cannot keep seeking a failed picture beneath its overlay");
`));
