import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";

// Each browser session gets its own module globals and clock.
const check = (source: string) => {
  const result = spawnSync(process.execPath, ["-e", `
    import assert from "node:assert/strict";
    import { mock } from "bun:test";
    mock.module("./src/client/session/native-context.ts", () => ({ couchApp: undefined }));
    mock.module("./src/client/session/device-id.ts", () => ({ deviceId: () => "receiver", localDeviceName: () => "Receiver" }));
    let now = 0, nextTimer = 0;
    const timers = new Map();
    globalThis.setTimeout = (callback, delay) => { const id = ++nextTimer; timers.set(id, { callback, at: now + delay }); return id; };
    globalThis.clearTimeout = id => timers.delete(id);
    const advance = milliseconds => {
      const target = now + milliseconds;
      while (true) {
        const due = [...timers].filter(([, timer]) => timer.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        timers.delete(due[0]); now = due[1].at; due[1].callback();
      }
      now = target;
    };
    const uploads = [], recorders = [], failures = [], commands = [], peers = [], signals = [], attachments = [], streamReports = [];
    mock.module("./src/client/session/renderer.ts", () => ({
      attachStream: (load, stream) => attachments.push({ load, stream }),
      streamChanged: (id, stream, error) => streamReports.push({ id, stream, error }),
    }));
    globalThis.RTCPeerConnection = class {
      connectionState = "new"; signalingState = "stable"; remoteDescription = null; tracks = []; candidates = [];
      constructor(config) { this.config = config; peers.push(this); }
      addTrack(track) { this.tracks.push(track); }
      async createOffer() { return { type: "offer", sdp: "offer" }; }
      async createAnswer() { return { type: "answer", sdp: "answer" }; }
      async setLocalDescription(description) { this.localDescription = description; }
      async setRemoteDescription(description) { this.remoteDescription = description; }
      async addIceCandidate(candidate) { this.candidates.push(candidate); }
      close() { this.connectionState = this.signalingState = "closed"; }
    };
    let autoReady = true;
    globalThis.WebSocket = class {
      static OPEN = 1;
      readyState = 0;
      bufferedAmount = 0;
      sent = [];
      constructor() { uploads.push(this); queueMicrotask(() => { this.readyState = 1; this.onopen?.(); }); }
      send(data) { this.sent.push(data); }
      close() { this.readyState = 3; this.onclose?.(); }
    };
    globalThis.MediaRecorder = class {
      static isTypeSupported(type) { return type.includes("webm"); }
      state = "inactive";
      constructor(stream, options) { this.stream = stream; this.options = options; recorders.push(this); }
      start(timeslice) { this.state = "recording"; this.timeslice = timeslice; if (autoReady) queueMicrotask(() => uploads.at(-1).onmessage({ data: JSON.stringify({ type: "ready" }) })); }
      stop() { this.state = "inactive"; }
    };
    globalThis.MediaStream = class {
      constructor(tracks = []) { this.tracks = tracks; }
      getTracks() { return this.tracks; }
      getAudioTracks() { return this.tracks.filter(track => track.kind === "audio"); }
      getVideoTracks() { return this.tracks.filter(track => track.kind === "video"); }
      addTrack(track) { this.tracks.push(track); }
    };
    const track = kind => ({ kind, stopped: false, stop() { this.stopped = true; }, addEventListener() {} });
    const captureRequests = [], captures = [];
    const capture = async request => {
      captureRequests.push(request);
      const stream = new MediaStream([...(request.audio ? [track("audio")] : []), ...(request.video ? [track("video")] : [])]);
      captures.push(stream);
      return stream;
    };
    Object.defineProperty(globalThis, "navigator", { value: { mediaDevices: { getDisplayMedia: capture, getUserMedia: capture, enumerateDevices: async () => [
      { kind: "audioinput", deviceId: "interface", label: "USB interface" }, { kind: "videoinput", deviceId: "camera" }
    ] } }, configurable: true });
    const { createLiveSession } = await import("./src/client/session/live.ts");
    const iceServers = [{ urls: "turn:relay.example:3478?transport=tcp", username: "test", credential: "test-only" }];
    const session = createLiveSession({ iceServers, send: message => signals.push(message), command: async action => { commands.push(action); }, upload: (sourceId, key) => Object.assign(new WebSocket(), { sourceId, key }), failed: error => failures.push(error), published() {} });
    const direct = (options = {}) => ({ type: "load", playbackId: "playing", source: "", liveSourceId: "source", livePeerId: "peer", liveOutput: { picture: true, sound: true, volume: 75 }, ...options });
    const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
    ${source}
    session.close();
    assert.equal(timers.size, 0, "closing a session retires its connection deadline");
  `], { cwd: new URL("../", import.meta.url), encoding: "utf8" });
  expect(result.stderr).toBe("");
  expect(result.status).toBe(0);
};

test("direct playback attaches the received stream to the normal renderer with authenticated ICE", () => check(`
  assert.equal(session.play(direct()), true);
  assert.deepEqual(peers[0].config.iceServers, iceServers);
  assert.equal(attachments[0].load.playbackId, "playing");
  const picture = track("video"), sound = track("audio");
  peers[0].ontrack({ track: picture });
  peers[0].ontrack({ track: sound });
  assert.deepEqual(attachments[0].stream.getTracks(), [picture, sound]);
  session.receive({ type: "liveSignal", peerId: "peer", signal: { candidate: { candidate: "candidate" } } });
  session.receive({ type: "liveSignal", peerId: "peer", signal: { description: { type: "offer", sdp: "offer" } } });
  await flush(); await flush();
  assert.equal(peers[0].candidates.length, 1);
  assert.equal(signals.at(-1).signal.description.type, "answer");
`));

test("stalled direct playback reports its error through the normal renderer after 30 seconds", () => check(`
  session.play(direct());
  advance(29999);
  assert.equal(streamReports.filter(report => report.error).length, 0);
  advance(1);
  assert.match(streamReports.at(-1).error, /connect/);
  assert.equal(streamReports.at(-1).id, "playing");
  assert.equal(peers[0].connectionState, "closed");
  assert.equal(failures.length, 0, "receiver failures belong to normal Now Playing state");
`));

test("connected, stopped and replaced direct sessions cancel deadlines and reject stale events", () => check(`
  session.play(direct());
  const first = peers[0];
  first.connectionState = "connected"; first.onconnectionstatechange();
  advance(60000);
  assert.equal(streamReports.filter(report => report.error).length, 0);
  session.play(direct({ playbackId: "next", livePeerId: "next-peer" }));
  const second = peers[1];
  const before = streamReports.length;
  first.ontrack({ track: track("video") });
  first.connectionState = "failed"; first.onconnectionstatechange();
  assert.equal(streamReports.length, before);
  assert.equal(session.play({ type: "pause", playbackId: "stale", paused: true }), false);
  assert.notEqual(second.connectionState, "closed", "transport commands remain owned by the normal renderer");
  assert.equal(session.play({ type: "stop" }), false);
  advance(60000);
  assert.equal(second.connectionState, "closed");
  assert.equal(streamReports.filter(report => report.error).length, 0);
`));

test("switching direct playback to a synced URL keeps capture and the warm upload alive", () => check(`
  const source = await session.start({ kind: "screen" });
  session.receive({ type: "livePeers", sourceId: source.id, peers: [{ peerId: "remote", deviceId: "other", picture: true, sound: true }] });
  await flush();
  assert.equal(peers[0].tracks.length, 2);
  assert.equal(signals[0].signal.description.type, "offer");
  // A capturing window can receive another source; Core never routes its own capture back to it.
  session.play(direct());
  assert.equal(peers.length, 2);
  assert.equal(session.play({ type: "load", playbackId: "playing", source: "https://couch.example/stream.m3u8", follow: { group: "group", pts: true } }), false);
  assert.equal(peers[1].connectionState, "closed");
  session.receive({ type: "livePeers", sourceId: source.id, peers: [] });
  assert.equal(peers[0].connectionState, "closed");
  assert.equal(recorders[0].state, "recording");
  assert.equal(uploads[0].readyState, 1);
  assert.ok(captures[0].getTracks().every(track => !track.stopped));
  advance(60000);
  assert.equal(failures.length, 0);
  session.play(direct({ livePeerId: "returned" }));
  assert.ok(captures[0].getTracks().every(track => !track.stopped));
`));

test("a synced URL replacement closes remote tracks and cancels its pending direct deadline", () => check(`
  session.play(direct());
  const old = peers[0], picture = track("video");
  old.ontrack({ track: picture });
  assert.equal(session.play({ type: "load", playbackId: "playing", source: "https://couch.example/live.m3u8", follow: { group: "group", pts: true } }), false);
  assert.equal(old.connectionState, "closed");
  assert.equal(picture.stopped, true);
  advance(60000);
  assert.equal(streamReports.filter(report => report.error).length, 0);
`));

test("a signaling failure from a replaced receiver cannot fail its replacement", () => check(`
  session.play(direct());
  let reject;
  peers[0].setRemoteDescription = () => new Promise((_, fail) => { reject = fail; });
  session.receive({ type: "liveSignal", peerId: "peer", signal: { description: { type: "offer", sdp: "offer" } } });
  await flush();
  session.play(direct({ livePeerId: "new-peer" }));
  reject(new Error("stale failure"));
  await flush();
  assert.equal(streamReports.filter(report => report.error).length, 0);
  peers[1].connectionState = "connected"; peers[1].onconnectionstatechange();
`));

test("the capture can publish to another tab on the same device", () => check(`
  const source = await session.start({ kind: "screen" });
  session.receive({ type: "livePeers", sourceId: source.id, peers: [{ peerId: "other-tab", deviceId: "receiver", picture: true, sound: false }] });
  await flush();
  assert.equal(peers.length, 1);
  assert.deepEqual(peers[0].tracks.map(track => track.kind), ["video"]);
  assert.equal(signals[0].peerId, "other-tab");
`));

test("capture uploads one ordered recording and waits for Core's playable source", () => check(`
  const source = await session.start({ kind: "screen" });
  assert.equal(uploads.length, 1);
  assert.equal(uploads[0].sourceId, source.id);
  assert.match(uploads[0].key, /^[a-f0-9]{64}$/);
  assert.equal(commands[0].uploadToken, uploads[0].key);
  assert.equal(recorders[0].timeslice, 250);
  const bytes = new Uint8Array(150_000).map((_, i) => i % 251);
  recorders[0].ondataavailable({ data: new Blob([bytes]) });
  assert.ok(uploads[0].sent.every(blob => blob.size <= 65_536));
  assert.deepEqual(new Uint8Array(await new Blob(uploads[0].sent).arrayBuffer()), bytes);
  advance(60000);
  assert.equal(failures.length, 0, "ready clears the startup deadline");
`));

test("a stalled upload fails after 30 seconds and releases capture", () => check(`
  autoReady = false;
  const starting = session.start({ kind: "screen" });
  const rejected = assert.rejects(starting, /didn't start/);
  await flush();
  advance(29999);
  assert.equal(captures[0].getTracks()[0].stopped, false);
  advance(1);
  await rejected;
  assert.ok(captures[0].getTracks().every(track => track.stopped));
  assert.equal(uploads[0].readyState, 3);
  assert.equal(recorders[0].state, "inactive");
  assert.equal(commands.at(-1).type, "endLive");
`));

test("stopping or closing a pending upload cancels its deadline", () => check(`
  autoReady = false;
  const starting = session.start({ kind: "screen" });
  const rejected = assert.rejects(starting, /canceled/);
  await flush();
  await session.end();
  await rejected;
  advance(60000);
  assert.equal(failures.length, 0);
  assert.equal(timers.size, 0);
  const next = session.start({ kind: "screen" });
  const nextRejected = assert.rejects(next, /canceled/);
  await flush();
  session.close();
  await nextRejected;
  assert.ok(captures.flatMap(stream => stream.getTracks()).every(track => track.stopped));
`));

test("upload backpressure ends sharing instead of growing an unbounded queue", () => check(`
  await session.start({ kind: "screen" });
  uploads[0].bufferedAmount = 4 * 1024 * 1024;
  recorders[0].ondataavailable({ data: new Blob(["next frame"]) });
  await flush();
  assert.equal(failures.length, 1);
  assert.match(failures[0].message, /cannot keep up/);
  assert.equal(uploads[0].sent.length, 0);
  assert.ok(captures[0].getTracks().every(track => track.stopped));
  assert.equal(commands.at(-1).type, "endLive");
`));

test("a removed source reports failure even when its state arrives before the upload error", () => check(`
  await session.start({ kind: "screen" });
  session.observe([]);
  uploads[0].onmessage({ data: JSON.stringify({ type: "error", error: "encoder failed" }) });
  assert.equal(failures.length, 1);
  assert.match(failures[0].message, /stopped/);
  assert.ok(captures[0].getTracks().every(track => track.stopped));
  await session.start({ kind: "screen" });
  await session.end();
  session.observe([]);
  assert.equal(failures.length, 1, "an explicit Stop sharing is not a failure");
`));

test("screen capture defaults to bounded video and unprocessed audio, with explicit quality and audio choices", () => check(`
  const screen = await session.start({ kind: "screen" });
  assert.equal(screen.audio, true);
  assert.equal(screen.video, true);
  assert.equal(captureRequests[0].video.width.max, 1920);
  assert.equal(captureRequests[0].video.height.max, 1080);
  assert.equal(captureRequests[0].video.frameRate.max, 30);
  assert.deepEqual(captureRequests[0].audio, { echoCancellation: false, noiseSuppression: false, autoGainControl: false });
  await session.end();
  const picture = await session.start({ kind: "screen", videoQuality: "720p", includeAudio: false });
  assert.equal(picture.audio, false);
  assert.equal(captureRequests[1].audio, false);
  assert.equal(captureRequests[1].video.height.max, 720);
  await session.end();
  await session.start({ kind: "screen", videoQuality: "original" });
  assert.equal(captureRequests[2].video.width, undefined);
  assert.equal(captureRequests[2].video.height, undefined);
`));

test("system audio retains only a small idle picture and never sends its video track", () => check(`
  const source = await session.start({ kind: "system-audio" });
  assert.equal(source.audio, true);
  assert.equal(source.video, false);
  assert.equal(captureRequests[0].video.frameRate.max, 1);
  assert.equal(captureRequests[0].video.height.max, 180);
  assert.equal(captures[0].getVideoTracks()[0].stopped, false);
  assert.deepEqual(recorders[0].stream.getTracks().map(track => track.kind), ["audio"]);
  await session.end();
  assert.ok(captures[0].getTracks().every(track => track.stopped));
`));

test("choosing an audio input releases its permission probe and captures the selected device", () => check(`
  assert.deepEqual(await session.audioInputs(), [{ kind: "audioinput", deviceId: "interface", label: "USB interface" }]);
  assert.ok(captures[0].getTracks().every(track => track.stopped));
  assert.equal(commands.length, 0, "listing devices must not publish capture");
  await session.start({ kind: "microphone", audioDeviceId: "interface" });
  assert.deepEqual(captureRequests[1].audio.deviceId, { exact: "interface" });
  await assert.rejects(session.audioInputs(), /Stop sharing/);
`));

test("closing while audio input permission is pending releases the eventual capture", () => check(`
  let finish;
  navigator.mediaDevices.getUserMedia = () => new Promise(resolve => { finish = resolve; });
  const selecting = session.audioInputs();
  await Promise.resolve();
  await assert.rejects(session.start({ kind: "screen" }), /already starting/);
  session.close();
  const microphone = track("audio");
  finish(new MediaStream([microphone]));
  await assert.rejects(selecting, /canceled/);
  assert.equal(microphone.stopped, true);
  assert.equal(commands.length, 0);
`));
