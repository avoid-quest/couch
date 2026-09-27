import { setupUiTests, act, render, screen } from "@/testing/react";
import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import type { Action, ClientMessage, ServerMessage, SessionState } from "../../shared/protocol";
import { loadedBuild } from "../../shared/build";
import { desktopClientProtocol as currentDesktopProtocol } from "../../shared/desktop-protocol";
import type { Credentials, useSession } from "./session";
import * as capabilities from "./browser-capabilities";
import * as nativeRenderer from "./native-renderer";
import * as events from "@tauri-apps/api/event";
import * as nativeContext from "./native-context";
import * as browserRenderer from "./browser-renderer";

setupUiTests();

const originalWebSocket = globalThis.WebSocket;
afterEach(() => { globalThis.WebSocket = originalWebSocket; });

const credentials: Credentials = { origin: "http://localhost", token: "paired", installationId: "installation" };
const state: SessionState = { sessionId: "household", queue: [], currentEntryId: null, activeProfile: { id: "household", name: "Household" }, player: { playbackId: null, status: "idle", position: 0, duration: null, volume: 80, seekable: false, error: null } };
const atom = { type: "enqueueProvider", provider: "youtube", shape: "atom", url: "https://www.youtube.com/watch?v=abcdefghijk", title: "Episode" } as const;
const playlist = { ...atom, shape: "playlist", url: "https://www.youtube.com/playlist?list=PL1234567890" } as const;
const sockets: Socket[] = [];
const timers: Array<{ handle: ReturnType<typeof setTimeout>; delay: number; fired: boolean; fire: () => void }> = [];
let session: ReturnType<typeof useSession>;
let capability = true;
let browserPlayback: boolean | undefined;
let nativeReceiver = false;
let rendererEnabled = true;
let desktopProtocol: number | undefined;
let onDeviceAudioOutput: Parameters<typeof useSession>[6];
const renderedObservations: Array<SessionState | null> = [];
let mount: (next: Credentials) => Promise<void>;

class Socket {
  static OPEN = 1;
  readyState = Socket.OPEN;
  sent: ClientMessage[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: MessageEvent<string>) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(readonly url: URL) { sockets.push(this); }
  send(value: string) { this.sent.push(JSON.parse(value)); }
  close(code = 1000) { this.readyState = 3; this.onclose?.({ code } as CloseEvent); }
  emit(message: ServerMessage) { this.onmessage?.({ data: JSON.stringify(message) } as MessageEvent<string>); }
}

beforeEach(async () => {
  capability = true;
  nativeReceiver = false; rendererEnabled = true; desktopProtocol = undefined; onDeviceAudioOutput = undefined;
  browserPlayback = undefined;
  sockets.length = timers.length = 0;
  globalThis.WebSocket = Socket as unknown as typeof WebSocket;
  spyOn(globalThis, "fetch").mockImplementation((async (input: RequestInfo | URL) => {
    const path = new URL(String(input)).pathname;
    if (path === "/api/connection") return Response.json({ desktopClientProtocol: currentDesktopProtocol, name: "Couch", installationId: "installation", urls: [credentials.origin], player: "idle", remoteControlEnabled: true, ...(capability ? { playbackClock: 1 } : {}), ...(browserPlayback === undefined ? {} : { capabilities: { browserPlayback, nativePlayback: false } }) });
    if (path === "/api/build") return Response.json(loadedBuild);
    if (path === "/api/controllers/me") return Response.json({ controller: { id: "remote", name: "Remote", role: "controller" }, authority: "controller", claimAvailable: false });
    throw new Error(`Unexpected session request: ${path}`);
  }) as typeof fetch);
  const { useSession } = await import("./session");
  function Probe({ connection }: { connection: Credentials }) {
    session = useSession(connection, undefined, undefined, desktopProtocol, nativeReceiver, rendererEnabled, onDeviceAudioOutput);
    renderedObservations.push(session.readObservation());
    return <output role="status">{session.status}</output>;
  }
  const view = render(<></>);
  mount = async next => { await act(async () => view.rerender(<Probe connection={next} />)); };
  await mount(credentials);
  expect(sockets).toHaveLength(1);
  await act(async () => sockets[0]!.emit({ type: "state", state }));
  expect(screen.getByRole("status").textContent).toBe("connected");

  // Control only the command confirmation deadlines, after the handshake.
  // Keeping real scheduler handles lets the hook's ordinary clearTimeout and
  // cleanup paths run unchanged; tests do not wait eight or thirty-five seconds.
  const schedule = globalThis.setTimeout;
  spyOn(globalThis, "setTimeout").mockImplementation(((...args: Parameters<typeof setTimeout>) => {
    const handle = schedule(...args);
    const [callback, delay] = args;
    if (typeof callback === "function" && (delay === 8_000 || delay === 35_000)) timers.push({ handle, delay, fired: false, fire: () => callback(...args.slice(2)) });
    return handle;
  }) as typeof setTimeout);
});

afterEach(async () => {
  for (const timer of timers) clearTimeout(timer.handle);
});

const commands = (peer: Socket) => peer.sent.filter(message => message.type === "command");

async function elapse(milliseconds: number) {
  for (const timer of timers) if (!timer.fired && timer.delay <= milliseconds) { timer.fired = true; clearTimeout(timer.handle); timer.fire(); }
  await Promise.resolve();
}

const slow: Array<[string, Action]> = [];
for (const playNow of [false, true]) {
  slow.push([`generic playlist playNow=${playNow}`, { ...playlist, playNow }]);
}
slow.push(["video quality", { type: "videoQuality", playbackId: "playing", quality: "720p" }]);

for (const [label, action] of slow) test(`${label} still accepts its confirmation after eight seconds`, async () => {
  let outcome = "pending";
  const done = session.command(action).then(() => { outcome = "confirmed"; }, error => { outcome = error.message; });
  expect(commands(sockets[0]!)).toHaveLength(1);
  expect(commands(sockets[0]!)[0]!.action).toEqual(action);
  expect(timers).toHaveLength(1);
  await elapse(8_001);
  expect(outcome).toBe("pending");
  sockets[0]!.emit({ type: "result", requestId: commands(sockets[0]!)[0]!.requestId, ok: true });
  await done;
  expect(outcome).toBe("confirmed");
});

test("a generic playlist confirmation remains bounded at thirty-five seconds and ignores a late success", async () => {
  let outcome = "pending";
  const done = session.command({ ...playlist, playNow: true }).then(() => { outcome = "confirmed"; }, error => { outcome = error.message; });
  await elapse(8_001);
  expect(outcome).toBe("pending");
  await elapse(35_000);
  await done;
  expect(outcome).toBe("No reply from Couch. Check before retrying.");
  sockets[0]!.emit({ type: "result", requestId: commands(sockets[0]!)[0]!.requestId, ok: true });
  await Promise.resolve();
  expect(outcome).not.toBe("confirmed");
});

test.each([false, true])("a generic atom keeps the ordinary eight-second confirmation deadline, playNow=%s", async playNow => {
  let outcome = "pending";
  const done = session.command({ ...atom, playNow }).then(() => { outcome = "confirmed"; }, error => { outcome = error.message; });
  await elapse(7_999);
  expect(outcome).toBe("pending");
  await elapse(8_000);
  await done;
  expect(outcome).toBe("No reply from Couch. Check before retrying.");
});

test("changing connections rejects the old provider request and an old confirmation cannot settle the new request", async () => {
  let oldOutcome = "pending", nextOutcome = "pending";
  const old = session.command(playlist).then(() => { oldOutcome = "confirmed"; }, error => { oldOutcome = error.message; });
  const oldSocket = sockets[0]!, oldRequest = commands(oldSocket)[0]!;
  await mount({ ...credentials, origin: "http://another-tv", token: "new-pairing" });
  await old;
  expect(oldOutcome).toBe("Connection lost. Try again.");
  expect(sockets).toHaveLength(2);
  const nextSocket = sockets[1]!;
  await act(async () => nextSocket.emit({ type: "state", state }));
  const next = session.command(playlist).then(() => { nextOutcome = "confirmed"; }, error => { nextOutcome = error.message; });
  oldSocket.emit({ type: "result", requestId: oldRequest.requestId, ok: true });
  await Promise.resolve();
  expect(nextOutcome).toBe("pending");
  expect(oldOutcome).not.toBe("confirmed");
  nextSocket.emit({ type: "result", requestId: commands(nextSocket)[0]!.requestId, ok: true });
  await next;
  expect(nextOutcome).toBe("confirmed");
});


const playing = { ...state, currentEntryId: "entry", queue: [{ id: "entry", title: "Track", source: "https://media.example/track" }], player: { ...state.player, playbackId: "active", status: "playing" as const, duration: 100 } };

test("a control-only Core connects and accepts commands without registering a browser renderer", async () => {
  const probe = spyOn(capabilities, "browserMediaCapabilities");
  browserPlayback = false;
  await act(async () => session.reconnect());
  const peer = sockets.at(-1)!;
  expect(peer.sent).toEqual([]);
  expect(probe).not.toHaveBeenCalled();
  await act(async () => peer.emit({ type: "state", state: { ...state, sessionId: "household" } }));
  expect(session.connected).toBe(true);
  expect(peer.sent).toEqual([]);
  const done = session.command({ type: "stop" });
  expect(peer.sent).toMatchObject([{ type: "command", action: { type: "stop" } }]);
  peer.emit({ type: "result", requestId: peer.sent[0]!.requestId, ok: true });
  await expect(done).resolves.toBeUndefined();
  expect(document.querySelector("#couch-browser-video")).toBeNull();
});

test.each(["credentials", "close"])("pending capabilities do not stall state or register after %s changes", async change => {
  let resolve!: (value: { mp4H264Aac: boolean; mp3: boolean }) => void;
  spyOn(capabilities, "browserMediaCapabilities").mockReturnValue(new Promise(done => { resolve = done; }));
  await act(async () => session.reconnect());
  const peer = sockets.at(-1)!;
  await act(async () => peer.emit({ type: "state", state: { ...state, sessionId: "household" } }));
  expect(session.connected).toBe(true);
  expect(peer.sent).toEqual([]);
  if (change === "credentials") await mount({ ...credentials, token: "replacement" });
  else await act(async () => peer.close());
  await act(async () => resolve({ mp4H264Aac: true, mp3: true }));
  expect(peer.sent).toEqual([]);
});

test("registers resolved capabilities exactly once and scopes media relay URLs to the selected Core", async () => {
  spyOn(capabilities, "browserMediaCapabilities").mockResolvedValue({ mp4H264Aac: true, mp3: false });
  const renderer = { command: (_command: import("../../shared/protocol").PlaybackCommand) => {}, close: () => {}, report: () => {}, play: () => {} };
  spyOn(browserRenderer, "createBrowserRenderer").mockReturnValue(renderer);
  await mount({ ...credentials, origin: "https://remote-core.example" });
  const rendererCommand = spyOn(renderer, "command");
  const peer = sockets.at(-1)!;
  await act(async () => peer.emit({ type: "state", state: { ...state, sessionId: "household" } }));
  await act(async () => peer.emit({ type: "state", state: { ...state, sessionId: "household" } }));
  expect(peer.sent as unknown[]).toEqual([{ type: "registerRenderer", capabilities: { mp4H264Aac: true, mp3: false } }]);
  await act(async () => peer.emit({ type: "rendererRegistered", sessionId: "household", targetId: "browser" }));
  const relay = "/api/media/12345678-1234-1234-1234-123456789abc";
  for (const source of [relay, "/other/file.mp4", `${relay}?extra=1`, "https://provider.example/video.mp4"]) {
    const load = { type: "load" as const, playbackId: "active", source };
    await act(async () => peer.emit({ type: "rendererCommand", sessionId: "household", command: load }));
    expect(rendererCommand).toHaveBeenLastCalledWith({ ...load, source: source === relay ? `https://remote-core.example${relay}` : source });
  }
});

test.each([true, undefined])("browser playback capability %s registers only after the session baseline", async enabled => {
  browserPlayback = enabled;
  await act(async () => session.reconnect());
  const peer = sockets.at(-1)!;
  expect(peer.sent).toEqual([]);
  await act(async () => peer.emit({ type: "state", state: { ...state, sessionId: "household" } }));
  expect(session.connected).toBe(true);
  expect(peer.sent.map(message => String(message.type))).toEqual(["registerRenderer"]);
  await act(async () => peer.emit({ type: "state", state: { ...state, sessionId: "household" } }));
  expect(peer.sent.map(message => String(message.type))).toEqual(["registerRenderer"]);
  expect(document.querySelector("#couch-browser-video")).toBeNull();
});

test("clock negotiation retains full old-host fallback", async () => {
  expect(sockets[0]!.url.searchParams.get("playbackClock")).toBe("1");
  capability = false;
  await act(async () => session.reconnect());
  const peer = sockets.at(-1)!;
  expect(peer.url.searchParams.has("playbackClock")).toBe(false);
  expect(session.connected).toBe(false);
  await act(async () => peer.emit({ type: "state", state: playing }));
  await act(async () => peer.emit({ type: "state", state: { ...playing, player: { ...playing.player, position: 12 } } }));
  expect(session.clock.position).toBe(12);
  expect(session.connected).toBe(true);
});

test("only a current baseline and matching playback identity accept clocks, including reconnect and Stop", async () => {
  await act(async () => sockets[0]!.emit({ type: "state", state: playing }));
  const queue = session.state!.queue;
  await act(async () => sockets[0]!.emit({ type: "clock", playbackId: "active", position: 12, duration: 110 }));
  expect(session.clock).toMatchObject({ position: 12, duration: 110 });
  expect(session.state?.queue).toBe(queue);
  await act(async () => sockets[0]!.emit({ type: "clock", playbackId: "retired", position: 99, duration: 110 }));
  expect(session.clock.position).toBe(12);
  const retired = sockets[0]!.onmessage!;
  await act(async () => session.reconnect());
  const peer = sockets.at(-1)!;
  await act(async () => peer.emit({ type: "clock", playbackId: "active", position: 44, duration: 110 }));
  expect(session.state).toBeNull();
  expect(session.connected).toBe(false);
  await expect(session.command({ type: "stop" })).rejects.toThrow("Reconnecting");
  await act(async () => peer.emit({ type: "state", state: playing }));
  await act(async () => retired({ data: JSON.stringify({ type: "clock", playbackId: "active", position: 99, duration: 110 }) } as MessageEvent<string>));
  expect(session.clock.position).toBe(0);
  await act(async () => peer.emit({ type: "state", state }));
  await act(async () => peer.emit({ type: "clock", playbackId: "active", position: 44, duration: 110 }));
  expect(session.state?.player.playbackId).toBeNull();
  expect(session.clock.position).toBe(0);
  await act(async () => peer.close(4001));
  await act(async () => peer.emit({ type: "clock", playbackId: null, position: 33, duration: null }));
  expect(session.state).toBeNull();
  expect(session.pairingRequired).toBe(true);
});

test.each([
  '{"type":"clock","playbackId":"active","position":1e400,"duration":100}',
  '{"type":"clock","playbackId":"active","position":0,"duration":1e400}',
  '{"type":"clock","playbackId":"active","position":null,"duration":100}',
  '{"type":"clock","playbackId":7,"position":0,"duration":100}',
  '{"type":"clock","playbackId":"active","position":0}',
])("malformed clock closes with existing invalid-response behavior: %s", async data => {
  const peer = sockets[0]!, close = spyOn(peer, "close");
  await act(async () => peer.onmessage!({ data } as MessageEvent<string>));
  expect(close).toHaveBeenCalledWith(4002, "Invalid response");
  expect(session.connected).toBe(false);
});


test("replacement credentials mask the private observation during render, before effect cleanup", async () => {
  await act(async () => sockets[0]!.emit({ type: "state", state: playing }));
  const previousReader = session.readObservation;
  expect(previousReader()?.player.playbackId).toBe("active");
  renderedObservations.length = 0;
  await mount({ ...credentials, token: "replacement" });
  expect(renderedObservations.length).toBeGreaterThan(0);
  expect(renderedObservations.every(value => value === null)).toBe(true);
  expect(previousReader()).toBeNull();
  expect(session.clock).toEqual({ playbackId: null, position: 0, duration: null });
});


test.each([false, true])("native receiver registration waits for begin and baseline, begin first=%s", async beginFirst => {
  spyOn(nativeContext, "isNativeHost").mockReturnValue(true);
  nativeReceiver = true; desktopProtocol = currentDesktopProtocol;
  const renderer = { command: (_command: import("../../shared/protocol").PlaybackCommand) => {}, close: () => {}, report: () => {}, play: () => {}, renew: (_nonce: string) => {} };
  let options!: Parameters<typeof nativeRenderer.createNativeRenderer>[1];
  spyOn(nativeRenderer, "createNativeRenderer").mockImplementation((_observe, next) => { options = next; return renderer; });
  const renew = spyOn(renderer, "renew"), report = spyOn(renderer, "report"), close = spyOn(renderer, "close");
  await act(async () => session.reconnect());
  const peer = sockets.at(-1)!;
  if (beginFirst) options.ready("challenge");
  expect(peer.sent).toEqual([]);
  await act(async () => peer.emit({ type: "state", state: { ...state, sessionId: "household" } }));
  expect(session.connected).toBe(true);
  if (!beginFirst) { expect(peer.sent).toEqual([]); options.ready("challenge"); }
  expect(peer.sent as unknown[]).toEqual([{ type: "registerNativeRenderer", nonce: "challenge" }]);
  await act(async () => peer.emit({ type: "nativeLease", nonce: "answer" }));
  expect(renew).toHaveBeenCalledWith("answer");
  await act(async () => peer.emit({ type: "rendererRegistered", sessionId: "household", targetId: "native-receiver" }));
  expect(report).toHaveBeenCalledTimes(1);
  expect(session.rendererTargetId).toBe("native-receiver");
  const previous = options;
  await mount({ ...credentials, token: "new" });
  expect(close).toHaveBeenCalled();
  previous.ready("stale"); previous.lease("stale"); previous.error(true);
  expect(peer.sent as unknown[]).toEqual([{ type: "registerNativeRenderer", nonce: "challenge" }]);
  expect(sockets.at(-1)!.readyState).toBe(Socket.OPEN);
});

test("native video presents a committed move after local playback selection", async () => {
  spyOn(nativeContext, "isNativeHost").mockReturnValue(true);
  nativeReceiver = true; desktopProtocol = currentDesktopProtocol;
  let observe!: (state: SessionState["player"]) => void;
  spyOn(nativeRenderer, "createNativeRenderer").mockImplementation((report) => {
    observe = report;
    return { command() {}, close() {}, report() {}, play() {}, renew() {} };
  });
  await act(async () => session.reconnect());
  const peer = sockets.at(-1)!;
  const device = { id: "native-receiver", name: "Desk", connected: true, volume: 50, muted: false, audio: false };
  const view = (sessionId: string, owner?: string): SessionState => ({ ...state, sessionId, devices: [{ ...device, playbackId: owner }], deviceIds: [], playbacks: owner ? [{ id: owner, title: "Movie", status: "paused", deviceIds: [device.id] }] : [] });
  await act(async () => peer.emit({ type: "state", state: view("household", "old") }));
  await act(async () => peer.emit({ type: "rendererRegistered", sessionId: "household", targetId: device.id }));
  expect(peer.sent.at(-1) as unknown).toEqual({ type: "selectPlayback", playbackId: "old" });
  await act(async () => peer.emit({ type: "state", state: view("old", "old") }));
  await act(async () => observe({ ...state.player, playbackId: "old-transport", status: "paused", tracks: [{ id: "video", index: 0, kind: "video", label: "", language: "", selected: true }] }));
  await act(async () => peer.emit({ type: "state", state: view("old", "old") }));
  expect(session.presentNativeVideo).toBeNull();

  await act(async () => session.selectPlayback("manual"));
  await act(async () => peer.emit({ type: "state", state: view("manual", "old") }));
  expect(session.playbackId).toBe("manual");
  await act(async () => observe({ ...state.player, playbackId: "new-transport", status: "paused", tracks: [{ id: "video", index: 0, kind: "video", label: "", language: "", selected: true }] }));
  await act(async () => peer.emit({ type: "state", state: { ...view("manual", "old"), handoff: { targetId: device.id } } }));
  expect(session.playbackId).toBe("manual");
  await act(async () => peer.emit({ type: "state", state: view("manual", "new") }));
  expect(peer.sent.at(-1) as unknown).toEqual({ type: "selectPlayback", playbackId: "new" });
  expect(session.presentNativeVideo).toEqual({ owner: "new", transport: "new-transport" });
  await act(async () => peer.emit({ type: "state", state: view("new", "new") }));
  await act(async () => session.selectPlayback("manual"));
  await act(async () => peer.emit({ type: "state", state: view("manual", "new") }));
  expect(session.playbackId).toBe("manual");
  expect(session.presentNativeVideo).toBeNull();
});

test("a participating device follows its playback while explicit remote control stays selected until assignment changes", async () => {
  const peer = sockets[0]!;
  const view = (sessionId: string, assigned: string): SessionState => ({ ...state, sessionId,
    devices: [{ id: "speaker", name: "Speaker", connected: true, volume: 50, muted: false, audio: true, playbackId: assigned }],
    playbacks: [{ id: assigned, title: "Shared", status: "playing", deviceIds: ["speaker"] }],
    deviceIds: sessionId === assigned ? ["speaker"] : [] });
  await act(async () => peer.emit({ type: "rendererRegistered", sessionId: "household", targetId: "speaker" }));
  await act(async () => peer.emit({ type: "state", state: view("household", "shared") }));
  expect(peer.sent.at(-1) as unknown).toEqual({ type: "selectPlayback", playbackId: "shared" });
  await act(async () => peer.emit({ type: "state", state: view("shared", "shared") }));
  expect(session.state?.sessionId).toBe("shared");
  expect(session.scopedCredentials?.playbackId).toBe("shared");

  await act(async () => session.selectPlayback("elsewhere"));
  await act(async () => peer.emit({ type: "state", state: view("elsewhere", "shared") }));
  expect(session.playbackId).toBe("elsewhere");
  expect((peer.sent as unknown as Array<{ type: string }>).filter(message => message.type === "selectPlayback")).toHaveLength(2);

  await act(async () => peer.emit({ type: "state", state: view("elsewhere", "new-shared") }));
  expect(peer.sent.at(-1) as unknown).toEqual({ type: "selectPlayback", playbackId: "new-shared" });
  await act(async () => peer.emit({ type: "state", state: view("new-shared", "new-shared") }));
  expect(session.scopedCredentials?.playbackId).toBe("new-shared");
});

test("initial native output failure keeps control connected and retries only when output becomes available", async () => {
  spyOn(nativeContext, "isNativeHost").mockReturnValue(true);
  nativeReceiver = true; desktopProtocol = currentDesktopProtocol;
  let available!: () => void;
  spyOn(events, "listen").mockImplementation((async (_name, callback) => { available = () => callback({} as never); return () => {}; }) as typeof events.listen);
  const attempts: Array<Parameters<typeof nativeRenderer.createNativeRenderer>[1]> = [];
  const create = spyOn(nativeRenderer, "createNativeRenderer").mockImplementation((_observe, options) => {
    attempts.push(options);
    return { command() {}, close() {}, report() {}, play() {}, renew() {} };
  });
  await act(async () => session.reconnect());
  const peer = sockets.at(-1)!;
  await act(async () => peer.emit({ type: "state", state }));
  expect(session.connected).toBe(true);
  expect(create).toHaveBeenCalledTimes(1);
  await act(async () => attempts[0]!.error(false));
  expect(peer.readyState).toBe(Socket.OPEN);
  expect(session.connected).toBe(true);
  expect((peer.sent as unknown as Array<{ type: string }>).some(message => message.type === "registerNativeRenderer")).toBe(false);
  await act(async () => available());
  expect(create).toHaveBeenCalledTimes(2);
  attempts[1]!.ready("new-challenge");
  expect(peer.sent.at(-1) as unknown).toEqual({ type: "registerNativeRenderer", nonce: "new-challenge" });
  await act(async () => attempts[1]!.error(true));
  expect(peer.readyState).toBe(3);
});

test("audio output requests use the latest handler on the owning socket without reconnecting", async () => {
  const calls: string[] = [];
  onDeviceAudioOutput = async request => { calls.push(`old:${request.playbackId}`); };
  await mount(credentials);
  const peer = sockets.at(-1)!;
  await act(async () => peer.emit({ type: "rendererRegistered", sessionId: "household", targetId: "browser" }));
  const count = sockets.length;
  onDeviceAudioOutput = async request => { calls.push(`new:${request.playbackId}`); };
  await mount(credentials);
  await act(async () => peer.emit({ type: "deviceAudioOutput", requestId: "reserve-one", playbackId: "other-playback", acquire: true }));
  expect(sockets).toHaveLength(count);
  expect(calls).toEqual(["new:other-playback"]);
  expect(peer.sent.at(-1) as unknown).toEqual({ type: "deviceAudioOutputResult", requestId: "reserve-one" });
});

test("native hosts remain controllers unless receiver mode and desktop protocol are both selected", async () => {
  spyOn(nativeContext, "isNativeHost").mockReturnValue(true);
  const native = spyOn(nativeRenderer, "createNativeRenderer");
  for (const [enabled, protocol] of [[false, currentDesktopProtocol], [true, undefined]] as const) {
    nativeReceiver = enabled; desktopProtocol = protocol;
    await act(async () => session.reconnect());
    const peer = sockets.at(-1)!;
    await act(async () => peer.emit({ type: "state", state: { ...state, sessionId: "household" } }));
    expect(peer.sent).toEqual([]);
  }
  expect(native).not.toHaveBeenCalled();
});

test("selecting playback changes only the view and fences old commands", async () => {
  const renderer = { command: () => {}, report: () => {}, play: () => {}, close: () => {} };
  const close = spyOn(renderer, "close");
  spyOn(browserRenderer, "createBrowserRenderer").mockReturnValue(renderer);
  await act(async () => session.reconnect());
  const peer = sockets.at(-1)!;
  await act(async () => peer.emit({ type: "state", state }));
  await act(async () => peer.emit({ type: "rendererRegistered", sessionId: "household", targetId: "browser" }));
  const oldCommand = session.command;
  const socketCount = sockets.length;
  await act(async () => session.selectPlayback("private"));
  expect(peer.readyState).toBe(Socket.OPEN);
  expect(sockets).toHaveLength(socketCount);
  expect(close).not.toHaveBeenCalled();
  expect(session.state).toBeNull();
  expect(peer.sent.at(-1) as unknown).toEqual({ type: "selectPlayback", playbackId: "private" });
  await expect(oldCommand({ type: "stop" })).rejects.toThrow("Reconnecting");
  await act(async () => peer.emit({ type: "state", state }));
  expect(session.state).toBeNull();
  await act(async () => peer.emit({ type: "state", state: { ...state, sessionId: "private" } }));
  expect(session.scopedCredentials).toMatchObject({ playbackId: "private", token: credentials.token });
  expect(session.rendererTargetId).toBe("browser");
  expect(close).not.toHaveBeenCalled();
  expect(peer.sent.filter(message => message.type === "command")).toHaveLength(0);
  const { useSession } = await import("./session");
  function Reloaded() { useSession(credentials); return null; }
  await act(async () => { render(<Reloaded />); });
  expect(sockets.at(-1)!.url.searchParams.get("playback")).toBe("private");
});

test("playback selection does not carry to different pairing credentials", async () => {
  await act(async () => session.selectPlayback("private"));
  await mount({ ...credentials, token: "another-controller" });
  expect(session.playbackId).toBe("default");
  expect(sockets.at(-1)!.url.searchParams.get("playback")).toBe("default");
});

test("Sendspin mode retires the local renderer but keeps Core control connected", async () => {
  spyOn(capabilities, "browserMediaCapabilities").mockResolvedValue({ mp4H264Aac: true, mp3: true });
  const renderer = { command: () => {}, close: () => {}, report: () => {}, play: () => {} };
  const create = spyOn(browserRenderer, "createBrowserRenderer").mockReturnValue(renderer);
  const close = spyOn(renderer, "close");
  await act(async () => session.reconnect());
  await act(async () => sockets.at(-1)!.emit({ type: "state", state: { ...state, sessionId: "household" } }));
  expect(create).toHaveBeenCalledTimes(1);
  rendererEnabled = false;
  await mount(credentials);
  await act(async () => sockets.at(-1)!.emit({ type: "state", state: { ...state, sessionId: "household" } }));
  expect(close).toHaveBeenCalledTimes(1);
  expect(create).toHaveBeenCalledTimes(1);
  expect(session.connected).toBe(true);
  expect(sockets.at(-1)!.sent).toEqual([]);
  rendererEnabled = true;
  await mount(credentials);
  await act(async () => sockets.at(-1)!.emit({ type: "state", state: { ...state, sessionId: "household" } }));
  expect(create).toHaveBeenCalledTimes(2);
  expect(sockets.at(-1)!.sent.map(message => String(message.type))).toEqual(["registerRenderer"]);
});
