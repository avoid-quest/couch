import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";

// Each browser session gets its own module globals and clock.
// The desktop app's bridge, as its preload exposes it: Close notifies the page, and Main grants one capture.
const desktop = `{
  onWindowClosed(listener) { windowClosed.add(listener); return () => windowClosed.delete(listener); },
  async prepareCapture(selection) { prepared.push(selection); },
}`;
const check = (source: string, couchApp = "undefined") => {
  const result = spawnSync(
    process.execPath,
    [
      "-e",
      `
    import assert from "node:assert/strict";
    import { mock } from "bun:test";
    globalThis.window = new EventTarget();
    const windowClosed = new Set(), prepared = [];
    const closeWindow = () => { for (const listener of [...windowClosed]) listener(); };
    mock.module("./src/client/session/native-context.ts", () => ({ couchApp: ${couchApp} }));
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
    const codecs = [
      { mimeType: "video/VP8", clockRate: 90000 },
      { mimeType: "video/H264", clockRate: 90000, sdpFmtpLine: "profile-level-id=42e01f;packetization-mode=1" },
      { mimeType: "video/H264", clockRate: 90000, sdpFmtpLine: "profile-level-id=64001f;packetization-mode=1" },
      { mimeType: "video/rtx", clockRate: 90000 },
    ];
    globalThis.RTCRtpSender = class { static getCapabilities() { return { codecs }; } };
    globalThis.RTCPeerConnection = class {
      connectionState = "new"; signalingState = "stable"; remoteDescription = null; tracks = []; candidates = []; senders = []; transceivers = [];
      constructor(config) { this.config = config; peers.push(this); }
      addTrack(track) {
        this.tracks.push(track);
        const sender = { track, parameters: { encodings: [{}], codecs: [], transactionId: "transaction" },
          getParameters() { return structuredClone(this.parameters); }, async setParameters(value) { this.parameters = value; } };
        this.senders.push(sender);
        this.transceivers.push({ sender, setCodecPreferences(value) { this.codecs = value; } });
        return sender;
      }
      getSenders() { return this.senders; }
      getTransceivers() { return this.transceivers; }
      async createOffer() { return { type: "offer", sdp: "offer" }; }
      async createAnswer() { return { type: "answer", sdp: "answer" }; }
      async setLocalDescription(description) { this.localDescription = description; }
      async setRemoteDescription(description) { this.remoteDescription = description; }
      async addIceCandidate(candidate) { this.candidates.push(candidate); }
      close() { this.connectionState = this.signalingState = "closed"; }
    };
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
      start(timeslice) { this.state = "recording"; this.timeslice = timeslice; }
      stop() { this.state = "inactive"; }
    };
    globalThis.MediaStream = class {
      constructor(tracks = []) { this.tracks = tracks; }
      getTracks() { return this.tracks; }
      getAudioTracks() { return this.tracks.filter(track => track.kind === "audio"); }
      getVideoTracks() { return this.tracks.filter(track => track.kind === "video"); }
      addTrack(track) { this.tracks.push(track); }
      removeTrack(track) { this.tracks = this.tracks.filter(item => item !== track); }
    };
    const track = kind => ({ kind, getSettings: () => ({ width: 1920, height: 1080 }), stopped: false, async applyConstraints(value) { this.constraints = value; }, stop() { this.stopped = true; }, addEventListener() {} });
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
    const session = createLiveSession({ iceServers, send: message => signals.push(message), command: async action => { commands.push(action); }, upload: (sourceId, key) => Object.assign(new WebSocket(), { sourceId, key }), failed: error => failures.push(error), published() {}, uploadUrl: (sourceId, key, uploadId) => \`wss://couch.example/api/live/upload?sourceId=\${sourceId}&key=\${key}&uploadId=\${uploadId}\` });
    const direct = (options = {}) => ({ type: "load", playbackId: "playing", source: "", liveSourceId: "source", livePeerId: "peer", liveOutput: { picture: true, sound: true, volume: 75 }, ...options });
    const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
    const unreachable = () => signals.filter(message => message.type === "liveFailed");
    // Core asks the publisher for its recording only while something plays the source buffered.
    const requestUpload = (sourceId, upload = true, uploadId = "attempt-1") => session.receive({ type: "livePeers", sourceId, peers: [], upload, uploadId: upload ? uploadId : undefined });
    ${source}
    session.close();
    assert.equal(timers.size, 0, "closing a session retires its connection deadline");
    assert.equal(windowClosed.size, 0, "a closed session stops following the window");
  `,
    ],
    { cwd: new URL("../", import.meta.url), encoding: "utf8" },
  );
  expect(result.stderr).toBe("");
  expect(result.status).toBe(0);
};

test("a receiver keeps only the channels Core routed to its output", () =>
  check(`
  const received = output => {
    session.play(direct({ liveOutput: { ...output, volume: 75 }, livePeerId: String(peers.length) }));
    const tracks = { picture: track("video"), sound: track("audio"), data: track("data") };
    for (const item of Object.values(tracks)) peers.at(-1).ontrack({ track: item });
    return { tracks, kept: attachments.at(-1).stream.getTracks() };
  };
  const picture = received({ picture: true, sound: false });
  assert.deepEqual(picture.kept, [picture.tracks.picture]);
  assert.equal(picture.tracks.sound.stopped, true, "an excluded track never plays");
  const sound = received({ picture: false, sound: true });
  assert.deepEqual(sound.kept, [sound.tracks.sound]);
  assert.equal(sound.tracks.picture.stopped, true);
  const both = received({ picture: true, sound: true });
  assert.deepEqual(both.kept, [both.tracks.picture, both.tracks.sound]);
  assert.ok([picture, sound, both].every(item => item.tracks.data.stopped), "an unexpected kind is discarded");
  // A replaced receiver's late track joins neither stream.
  const stale = peers.at(-2), late = track("video");
  stale.ontrack({ track: late });
  assert.ok(attachments.every(item => !item.stream.getTracks().includes(late)));
  assert.equal(late.stopped, true, "late tracks release their resources after playback is replaced");
  session.play({ type: "stop" });
  assert.ok(both.kept.every(item => item.stopped));
`));

test("a receiver that doesn't connect within 10 seconds, or fails, asks Core to relay its source and keeps buffering", () =>
  check(`
  session.play(direct());
  advance(9999);
  assert.equal(unreachable().length, 0);
  advance(1);
  assert.deepEqual(unreachable().map(message => message.peerId), ["peer"]);
  assert.match(unreachable()[0].error, /10 seconds/);
  assert.equal(peers[0].connectionState, "closed");
  assert.equal(streamReports.filter(report => report.error).length, 0, "Core decides what the player shows next");
  assert.equal(failures.length, 0, "receiver failures belong to normal Now Playing state");
  session.play(direct({ livePeerId: "lost" }));
  peers[1].connectionState = "connected"; peers[1].onconnectionstatechange();
  peers[1].connectionState = "failed"; peers[1].onconnectionstatechange();
  assert.deepEqual(unreachable().map(message => message.peerId), ["peer", "lost"]);
  advance(60000);
  assert.equal(unreachable().length, 2, "each peer is reported once");
`));

test("a publisher that can't negotiate a peer reports it instead of dropping it silently", () =>
  check(`
  const source = await session.start({ kind: "screen" });
  RTCPeerConnection.prototype.createOffer = async () => { throw new Error("No codec in common."); };
  session.receive({ type: "livePeers", sourceId: source.id, peers: [{ peerId: "remote", deviceId: "other", picture: true, sound: true }] });
  await flush();
  assert.deepEqual(unreachable(), [{ type: "liveFailed", peerId: "remote", error: "No codec in common." }]);
  assert.equal(peers[0].connectionState, "closed");
  assert.equal(recorders.length, 0, "nothing records until Core asks");
`));

test("Core's request starts one ordered recording, and its release or Core closing it stops only that upload", () =>
  check(`
  const source = await session.start({ kind: "screen" });
  assert.equal(uploads.length, 0, "Publish starts no recording");
  requestUpload(source.id);
  assert.equal(uploads.length, 1);
  assert.equal(uploads[0].sourceId, source.id);
  assert.match(uploads[0].key, /^[a-f0-9]{64}$/);
  assert.equal(commands[0].uploadToken, uploads[0].key);
  await flush();
  assert.equal(recorders[0].timeslice, 250);
  const bytes = new Uint8Array(150_000).map((_, i) => i % 251);
  recorders[0].ondataavailable({ data: new Blob([bytes]) });
  assert.ok(uploads[0].sent.every(blob => blob.size <= 65_536));
  assert.deepEqual(new Uint8Array(await new Blob(uploads[0].sent).arrayBuffer()), bytes);
  requestUpload(source.id);
  assert.equal(uploads.length, 1, "one recording at a time");
  requestUpload(source.id, false);
  assert.equal(recorders[0].state, "inactive");
  assert.equal(uploads[0].readyState, 3);
  requestUpload(source.id);
  await flush();
  uploads[1].close();
  assert.equal(recorders[1].state, "inactive");
  advance(60000);
  assert.equal(failures.length, 0, "Core ending buffered delivery is not a failure");
  assert.ok(captures[0].getTracks().every(track => !track.stopped), "capture continues");
  assert.equal(commands.some(action => action.type === "endLive"), false);
`));

test("upload backpressure stops the upload instead of growing an unbounded queue, and sharing continues", () =>
  check(`
  const source = await session.start({ kind: "screen" });
  requestUpload(source.id);
  await flush();
  uploads[0].bufferedAmount = 4 * 1024 * 1024;
  recorders[0].ondataavailable({ data: new Blob(["next frame"]) });
  assert.equal(failures.length, 1);
  assert.match(failures[0].message, /cannot keep up/);
  assert.equal(uploads[0].sent.length, 0);
  assert.equal(uploads[0].readyState, 3);
  assert.equal(recorders[0].state, "inactive");
  assert.ok(captures[0].getTracks().every(track => !track.stopped));
  assert.equal(commands.some(action => action.type === "endLive"), false);
  assert.deepEqual(signals.filter(message => message.type === "liveUploadFailed"), [{ type: "liveUploadFailed", sourceId: source.id, uploadId: "attempt-1", error: failures[0].message }]);
`));

test("a source Core removed reports failure and releases capture", () =>
  check(`
  await session.start({ kind: "screen" });
  session.observe([]);
  assert.equal(failures.length, 1);
  assert.match(failures[0].message, /stopped/);
  assert.ok(captures[0].getTracks().every(track => track.stopped));
  await session.start({ kind: "screen" });
  await session.end();
  session.observe([]);
  assert.equal(failures.length, 1, "an explicit Stop sharing is not a failure");
`));

test("receiver pacing cancels pending setup on Stop and falls back to the original track after worker failure", () =>
  check(`
  const workers = [], generated = [];
  globalThis.MediaStreamTrackProcessor = class { readable = new ReadableStream(); };
  globalThis.MediaStreamTrackGenerator = class {
    kind = "video"; readyState = "live"; writable = new WritableStream();
    constructor() { generated.push(this); }
    stop() { this.readyState = "ended"; }
  };
  globalThis.Worker = class {
    constructor() { workers.push(this); }
    postMessage(message) { this.last = message; }
    terminate() { this.terminated = true; }
  };
  const original = track("video"), clone = track("video"); original.clone = () => clone;
  session.play(direct()); peers[0].ontrack({ track: original });
  assert.equal(attachments[0].stream.getTracks().length, 0, "setup waits for its worker");
  session.play({ type: "stop" }); await flush(); advance(100);
  assert.equal(clone.stopped, true, "Stop cancels the pending owned capture clone immediately");
  assert.equal(workers[0].terminated, true);
  assert.equal(generated[0].readyState, "ended");
  assert.equal(attachments[0].stream.getTracks().length, 0, "a late setup cannot attach to a retired playback");
  const next = track("video"), copy = track("video"); next.clone = () => copy;
  session.play(direct({ livePeerId: "next" })); peers[1].ontrack({ track: next });
  workers[1].onmessage({ data: { ready: true } }); await flush();
  assert.deepEqual(attachments[1].stream.getTracks(), [generated[1]]);
  workers[1].onerror(); await flush(); advance(100);
  assert.deepEqual(attachments[1].stream.getTracks(), [next], "a failed pacer restores the native WebRTC track");
  assert.equal(next.stopped, false);
  assert.equal(copy.stopped, true);
  assert.equal(workers[1].terminated, true);
  assert.equal(unreachable().length, 0, "pacing failure need not abandon a working peer");
`));

test("the desktop app is told which source to prepare and whether its sound is included", () =>
  check(
    `
  for (const selection of [{ kind: "screen", sourceId: "screen:1:0" }, { kind: "screen", sourceId: "window:2:0", includeAudio: false }, { kind: "system-audio", sourceId: "screen:1:0", includeAudio: false }, { kind: "microphone" }]) {
    await session.start(selection);
    await session.end();
  }
  assert.deepEqual(prepared.filter(Boolean), [
    { kind: "screen", sourceId: "screen:1:0", audio: true },
    { kind: "screen", sourceId: "window:2:0", audio: false },
    { kind: "system-audio", sourceId: "screen:1:0", audio: true },
    { kind: "microphone", sourceId: undefined, audio: true },
  ]);
  assert.deepEqual(captureRequests.slice(0, 3).map(request => !!request.audio), [true, false, true]);
`,
    desktop,
  ));

test("system audio retains only a small idle picture and never sends its video track", () =>
  check(`
  const source = await session.start({ kind: "system-audio" });
  requestUpload(source.id);
  assert.equal(source.audio, true);
  assert.equal(source.video, false);
  assert.equal(captureRequests[0].video.frameRate.max, 1);
  assert.equal(captureRequests[0].video.height.max, 180);
  assert.equal(captures[0].getVideoTracks()[0].stopped, false);
  assert.deepEqual(recorders[0].stream.getTracks().map(track => track.kind), ["audio"]);
  await session.end();
  assert.ok(captures[0].getTracks().every(track => track.stopped));
`));

test("choosing an audio input releases its permission probe and captures the selected device", () =>
  check(`
  assert.deepEqual(await session.audioInputs(), [{ kind: "audioinput", deviceId: "interface", label: "USB interface" }]);
  assert.ok(captures[0].getTracks().every(track => track.stopped));
  assert.equal(commands.length, 0, "listing devices must not publish capture");
  await session.start({ kind: "microphone", audioDeviceId: "interface" });
  assert.deepEqual(captureRequests[1].audio.deviceId, { exact: "interface" });
  await assert.rejects(session.audioInputs(), /Stop sharing/);
`));

test("leaving a publishing page ends capture before its control socket closes", () =>
  check(`
  const source = await session.start({ kind: "screen" });
  window.dispatchEvent(new Event("pagehide"));
  await flush();
  assert.ok(captures[0].getTracks().every(track => track.stopped));
  assert.deepEqual(commands.filter(action => action.type === "endLive"), [{ type: "endLive", sourceId: source.id }]);
  window.dispatchEvent(new Event("pagehide"));
  await flush();
  assert.equal(commands.filter(action => action.type === "endLive").length, 1);
`));

test("closing the desktop window ends this device's sharing, while its playback and Couch continue", () =>
  check(
    `
  session.play(direct());
  const receiving = peers[0];
  const source = await session.start({ kind: "screen" });
  session.receive({ type: "livePeers", sourceId: source.id, peers: [{ peerId: "remote", deviceId: "other", picture: true, sound: true }], upload: true, uploadId: "attempt-1" });
  await flush();
  const publisher = peers[1];
  closeWindow();
  await flush();
  assert.equal(recorders[0].state, "inactive");
  assert.equal(uploads[0].readyState, 3);
  assert.ok(captures[0].getTracks().every(track => track.stopped));
  assert.equal(publisher.connectionState, "closed");
  assert.deepEqual(commands.filter(action => action.type === "endLive"), [{ type: "endLive", sourceId: source.id }]);
  assert.notEqual(receiving.connectionState, "closed", "the hidden window keeps playing what it receives");
  assert.equal(failures.length, 0, "Close is a deliberate stop, not a failure");
  // Closing again while nothing is shared sends nothing; sharing after reopening ends on the next Close.
  closeWindow();
  await flush();
  assert.equal(commands.filter(action => action.type === "endLive").length, 1);
  const again = await session.start({ kind: "microphone" });
  assert.equal(windowClosed.size, 1, "one listener however often the window closes and reopens");
  closeWindow();
  await flush();
  assert.deepEqual(commands.filter(action => action.type === "endLive").map(action => action.sourceId), [source.id, again.id]);
  assert.ok(captures[1].getTracks().every(track => track.stopped));
  assert.equal(prepared.at(-1), null, "no capture grant stays armed");
`,
    desktop,
  ));
