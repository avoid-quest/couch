import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";

// Each browser session gets its own module globals and clock.
const check = (source: string) => {
  const result = spawnSync(process.execPath, ["-e", `
    import assert from "node:assert/strict";
    import { mock } from "bun:test";
    mock.module("./src/client/session/native-context.ts", () => ({ couchApp: undefined }));
    mock.module("./src/client/session/device-id.ts", () => ({ deviceId: () => "receiver", localDeviceName: () => "Receiver" }));
    mock.module("./src/client/session/renderer.ts", () => ({ attachLive() {}, detachLive() {}, play() {} }));
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
    const peers = [], failures = [], commands = [];
    globalThis.RTCPeerConnection = class {
      connectionState = "new";
      signalingState = "stable";
      constructor(configuration) { this.configuration = configuration; peers.push(this); }
      addTrack(track) { (this.tracks ??= []).push(track); }
      async createOffer() { return { type: "offer", sdp: "fixture" }; }
      async setLocalDescription(description) { this.localDescription = description; }
      close() { this.connectionState = this.signalingState = "closed"; this.onconnectionstatechange?.(); }
    };
    globalThis.MediaStream = class {
      constructor(tracks = []) { this.tracks = tracks; }
      getTracks() { return this.tracks; }
      getAudioTracks() { return this.tracks.filter(track => track.kind === "audio"); }
      getVideoTracks() { return this.tracks.filter(track => track.kind === "video"); }
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
    const iceServers = [{ urls: "turn:relay.example:3478?transport=tcp", username: "fixture", credential: "fixture-credential" }];
    const session = createLiveSession({ iceServers, command: async action => { commands.push(action); }, send() {}, failed: state => failures.push(state), published() {} });
    const load = playbackId => ({ type: "load", id: playbackId, playbackId, liveSourceId: "screen", livePeerId: playbackId, liveOutput: { picture: true, sound: true, volume: 80 } });
    ${source}
    session.close();
    assert.equal(timers.size, 0, "closing a session retires its connection deadline");
  `], { cwd: new URL("../", import.meta.url), encoding: "utf8" });
  expect(result.stderr).toBe("");
  expect(result.status).toBe(0);
};

test("live peers use the authenticated standard ICE configuration", () => check(`
  session.play(load("one"));
  assert.deepEqual(peers[0].configuration.iceServers, iceServers);
`));

test("a live receiver with no network connection stops buffering after 30 seconds", () => check(`
  session.play(load("one"));
  advance(29999);
  assert.equal(failures.length, 0);
  advance(1);
  assert.equal(failures.length, 1);
  assert.equal(failures[0].playbackId, "one");
  assert.equal(failures[0].status, "error");
  assert.equal(failures[0].buffering, false);
  assert.match(failures[0].error, /connect/i);
  assert.equal(peers[0].connectionState, "closed");
`));

test("connected receivers and replaced or stopped loads never report a stale timeout", () => check(`
  session.play(load("old"));
  advance(20000);
  session.play(load("current"));
  advance(10000);
  assert.equal(failures.length, 0);
  peers[1].connectionState = "connected";
  peers[1].onconnectionstatechange();
  advance(60000);
  assert.equal(failures.length, 0);
  session.play(load("stopped"));
  session.play({ type: "stop" });
  advance(30000);
  assert.equal(failures.length, 0);
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
  session.receive({ type: "livePeers", sourceId: source.id, peers: [{ peerId: "listener", deviceId: "other", sound: true, picture: true }] });
  assert.deepEqual(peers[0].tracks.map(track => track.kind), ["audio"]);
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
