import { setupUiTests, act, render } from "@/testing/react";
import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { loadedBuild } from "../../shared/build";
import { desktopClientProtocol } from "../../shared/desktop-protocol";
import type { ClientMessage, ServerMessage, SessionState } from "../../shared/protocol";
import type { Credentials, useSession } from "./session";

setupUiTests();

const originalWebSocket = globalThis.WebSocket;
afterEach(() => { globalThis.WebSocket = originalWebSocket; });

const originalRevision = loadedBuild.revision;
const credentials: Credentials = { origin: "http://localhost", token: "paired", installationId: "installation" };
const state: SessionState = { sessionId: "household", queue: [], currentEntryId: null, activeProfile: { id: "household", name: "Household" }, player: { playbackId: null, status: "idle", position: 0, duration: null, volume: 80, seekable: false, error: null } };
const playlist = { type: "enqueueProvider", provider: "youtube", shape: "playlist", url: "https://www.youtube.com/playlist?list=PL1234567890", title: "Playlist" } as const;
const sockets: Socket[] = [];
const requests: Array<{ origin: string; path: string; token: string | null; signal?: AbortSignal | null }> = [];
const timers: Array<{ handle: ReturnType<typeof setTimeout>; delay: number; due: number; active: boolean; callback: () => void }> = [];
let view: ReturnType<typeof render>, session: ReturnType<typeof useSession>;
let mount: (next?: Credentials | null, protocol?: number) => Promise<void>;
let now: number, unavailable: boolean, installation: string, identityStatus: number, buildMismatch: boolean;
let discovery: ReturnType<typeof Promise.withResolvers<Response>> | undefined;
const details = () => Response.json({ name: "Couch", installationId: installation, urls: [credentials.origin], player: "idle", remoteControlEnabled: true, desktopClientProtocol });

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
  sockets.length = requests.length = timers.length = 0;
  loadedBuild.revision = "fixture-revision";
  now = 0; unavailable = buildMismatch = false; installation = "installation"; identityStatus = 200; discovery = undefined;
  globalThis.WebSocket = Socket as unknown as typeof WebSocket;
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  const schedule = globalThis.setTimeout, cancel = globalThis.clearTimeout;
  // Retain real handles so production cleanup runs normally, while only this
  // fixture advances retry, handshake and command deadlines.
  spyOn(globalThis, "setTimeout").mockImplementation(((callback: (...args: unknown[]) => void, delay: number, ...args: unknown[]) => {
    if (![500, 1_000, 2_000, 4_000, 5_000, 8_000, 35_000].includes(delay)) return schedule(callback, delay, ...args);
    const handle = schedule(() => {}, 60_000);
    timers.push({ handle, delay, due: now + delay, active: true, callback: () => callback(...args) });
    return handle;
  }) as typeof setTimeout);
  spyOn(globalThis, "clearTimeout").mockImplementation(((handle: ReturnType<typeof setTimeout>) => {
    const timer = timers.find(timer => timer.handle === handle);
    if (timer) timer.active = false;
    cancel(handle);
  }) as typeof clearTimeout);
  spyOn(globalThis, "fetch").mockImplementation((async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    requests.push({ origin: url.origin, path: url.pathname, token: new Headers(init?.headers).get("Authorization"), signal: init?.signal });
    if (url.pathname === "/api/connection") {
      if (discovery) return discovery.promise;
      if (unavailable) throw new Error("Offline");
      return details();
    }
    if (url.pathname === "/api/build") return Response.json(buildMismatch ? { ...loadedBuild, revision: "other-revision" } : loadedBuild);
    if (url.pathname === "/api/controllers/me") return Response.json({ controller: { id: "remote", name: "Remote", role: "controller" }, authority: "controller", claimAvailable: false }, { status: identityStatus });
    throw new Error(`Unexpected request: ${url.pathname}`);
  }) as typeof fetch);
  const { useSession } = await import("./session");
  function Probe({ connection, protocol }: { connection: Credentials | null; protocol?: number }) {
    session = useSession(connection, undefined, connection?.origin ?? credentials.origin, protocol);
    return null;
  }
  view = render(<></>);
  mount = async (next = credentials, protocol) => { await act(async () => view.rerender(<Probe connection={next} protocol={protocol} />)); };
});

afterEach(async () => {
  discovery?.resolve(details());
  for (const timer of timers) clearTimeout(timer.handle);
  Reflect.deleteProperty(document, "visibilityState");
  Reflect.deleteProperty(navigator, "onLine");
  loadedBuild.revision = originalRevision;
});

const discoveries = () => requests.filter(request => request.path === "/api/connection");
const activeTimers = () => timers.filter(timer => timer.active);
async function elapse(milliseconds: number) {
  const end = now + milliseconds;
  for (;;) {
    const next = activeTimers().filter(timer => timer.due <= end).sort((a, b) => a.due - b.due)[0];
    if (!next) break;
    now = next.due; clearTimeout(next.handle);
    await act(async () => next.callback());
  }
  now = end;
}
function dispatch(type: "visibilitychange" | "pageshow" | "online", persisted = true) {
  const event = new Event(type);
  if (type === "pageshow") Object.defineProperty(event, "persisted", { value: persisted });
  (type === "visibilitychange" ? document : globalThis.window).dispatchEvent(event);
}
const burst = () => { dispatch("visibilitychange"); dispatch("pageshow"); dispatch("online"); };
async function connect() {
  await mount();
  await act(async () => sockets.at(-1)!.emit({ type: "state", state }));
  expect(session.connected).toBe(true);
}
async function maximumBackoff() {
  await connect(); unavailable = true;
  await act(async () => sockets[0]!.close());
  for (const delay of [500, 1_000, 2_000, 4_000, 8_000]) {
    expect(activeTimers().map(timer => timer.delay)).toEqual([delay]);
    await elapse(delay);
  }
  expect(activeTimers().map(timer => timer.delay)).toEqual([8_000]);
}

test.each(["visibilitychange", "pageshow", "online"] as const)("%s immediately advances maximum backoff and requires a fresh snapshot", async type => {
  await maximumBackoff(); unavailable = false;
  const before = discoveries().length, retry = activeTimers()[0]!, time = now;
  await act(async () => dispatch(type));
  expect(now).toBe(time);
  expect(retry.active).toBe(false);
  expect(discoveries()).toHaveLength(before + 1);
  expect(sockets).toHaveLength(2);
  expect(session.connected).toBe(false);
  await act(async () => sockets[1]!.onopen?.());
  expect(session.status).toBe("syncing");
  await expect(session.command(playlist)).rejects.toThrow("Reconnecting");
  await act(async () => burst());
  expect(sockets).toHaveLength(2);
  await act(async () => sockets[1]!.emit({ type: "state", state }));
  expect(session.connected).toBe(true);
});

test("hidden events and the initial pageshow leave the queued retry alone", async () => {
  await maximumBackoff();
  const before = discoveries().length, retry = activeTimers()[0]!;
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
  await act(async () => burst());
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  await act(async () => dispatch("pageshow", false));
  expect(discoveries()).toHaveLength(before);
  expect(retry.active).toBe(true);
});

test("wake bursts coalesce discovery, preserve connecting and resume bounded retries after failure", async () => {
  await maximumBackoff();
  const before = discoveries().length;
  discovery = Promise.withResolvers<Response>();
  await act(async () => { burst(); burst(); });
  expect(discoveries()).toHaveLength(before + 1);
  expect(activeTimers()).toHaveLength(0);
  await act(async () => burst());
  expect(discoveries()).toHaveLength(before + 1);
  const pending = discovery; discovery = undefined;
  await act(async () => pending.reject(new Error("Still offline")));
  expect(activeTimers().map(timer => timer.delay)).toEqual([8_000]);
  await elapse(8_000);
  expect(discoveries()).toHaveLength(before + 2);
  expect(activeTimers().map(timer => timer.delay)).toEqual([8_000]);
});

test("a foreground failure keeps the existing early exponential progression", async () => {
  await connect(); unavailable = true;
  await act(async () => sockets[0]!.close());
  expect(activeTimers().map(timer => timer.delay)).toEqual([500]);
  await act(async () => burst());
  expect(activeTimers().map(timer => timer.delay)).toEqual([1_000]);
  await elapse(1_000);
  expect(activeTimers().map(timer => timer.delay)).toEqual([2_000]);
});

test("healthy sockets and ordinary or slow provider commands survive every wake event", async () => {
  await connect();
  const socket = sockets[0]!, before = requests.length;
  let outcome = "pending";
  const slow = session.command(playlist).then(() => { outcome = "confirmed"; }, error => { outcome = error.message; });
  const ordinary = session.command({ type: "stop" });
  await act(async () => burst());
  expect(sockets).toEqual([socket]);
  expect(socket.readyState).toBe(Socket.OPEN);
  expect(requests).toHaveLength(before);
  socket.emit({ type: "result", requestId: socket.sent.filter(message => message.type === "command")[1]!.requestId, ok: true });
  await ordinary;
  await elapse(8_001);
  await act(async () => burst());
  expect(outcome).toBe("pending");
  expect(activeTimers().map(timer => timer.delay)).toEqual([35_000]);
  socket.emit({ type: "result", requestId: socket.sent.filter(message => message.type === "command")[0]!.requestId, ok: true });
  await slow;
  expect(outcome).toBe("confirmed");
  expect(session.connected).toBe(true);
});

test.each(["pairing-required", "connection-rejected", "build-mismatch", "protocol-mismatch"] as const)("wake does not bypass %s", async expected => {
  identityStatus = expected === "connection-rejected" ? 403 : 200;
  buildMismatch = expected === "build-mismatch";
  await mount(expected === "pairing-required" ? null : credentials, expected === "protocol-mismatch" ? desktopClientProtocol + 1 : undefined);
  expect(session.status).toBe(expected);
  const before = requests.length;
  await act(async () => burst());
  expect(requests).toHaveLength(before);
  expect(session.status).toBe(expected);
  expect(sockets).toHaveLength(0);
});

test("wake rechecks installation identity before credentials and never replays failed commands", async () => {
  await connect();
  const old = sockets[0]!;
  const failed = session.command(playlist).catch(error => error.message);
  await act(async () => old.close());
  expect(await failed).toBe("Connection lost. Try again.");
  const before = requests.length; installation = "replacement";
  await act(async () => burst());
  expect(session.pairingRequired).toBe(true);
  expect(session.connected).toBe(false);
  expect(requests.slice(before).every(request => !request.token && request.origin === credentials.origin)).toBe(true);
  expect(sockets).toEqual([old]);
  await act(async () => burst());
  expect(sockets).toEqual([old]);
});

test("reachable LAN recovers even when navigator reports offline, without replaying a command", async () => {
  await connect();
  Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
  const failed = session.command(playlist).catch(error => error.message);
  await act(async () => sockets[0]!.close());
  expect(await failed).toBe("Connection lost. Try again.");
  await act(async () => dispatch("pageshow"));
  await act(async () => sockets[1]!.emit({ type: "state", state }));
  expect(session.connected).toBe(true);
  expect(sockets[1]!.url.origin).toBe("ws://localhost");
  expect(sockets[1]!.sent.filter(message => message.type === "command")).toEqual([]);
});

test.each(["target", "credential", "unmount"] as const)("%s replacement retires listeners, retry timers and late callbacks", async change => {
  const documentRemove = spyOn(document, "removeEventListener"), windowRemove = spyOn(globalThis.window, "removeEventListener");
  await connect(); unavailable = true;
  await act(async () => sockets[0]!.close());
  const oldRetry = activeTimers()[0]!;
  discovery = Promise.withResolvers<Response>();
  await act(async () => burst());
  const late = discovery, signal = discoveries().at(-1)!.signal;
  discovery = undefined;
  if (change === "unmount") view.unmount();
  else await mount({ ...credentials, ...(change === "target" ? { origin: "http://another-tv" } : { token: "replacement-token" }) });
  expect(signal?.aborted).toBe(true);
  expect(oldRetry.active).toBe(false);
  const removed = documentRemove.mock.calls.filter(([type]) => type === "visibilitychange");
  expect(removed).toHaveLength(1);
  const retired = removed[0]![1] as EventListener;
  expect(windowRemove.mock.calls.some(([type, listener]) => type === "online" && listener === retired)).toBe(true);
  expect(windowRemove.mock.calls.some(([type, listener]) => type === "pageshow" && listener === retired)).toBe(true);
  const before = requests.length;
  await act(async () => { retired(new Event("online")); oldRetry.callback(); late.resolve(details()); });
  expect(requests).toHaveLength(before);
  expect(sockets).toHaveLength(1);
  if (change === "unmount") {
    await act(async () => burst());
    await elapse(8_000);
    expect(requests).toHaveLength(before);
    expect(activeTimers()).toHaveLength(0);
  } else {
    await act(async () => burst());
    expect(discoveries().at(-1)!.origin).toBe(change === "target" ? "http://another-tv" : credentials.origin);
    expect(requests).toHaveLength(before + 1);
  }
});
