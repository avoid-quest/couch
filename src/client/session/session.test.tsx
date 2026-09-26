import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { Window } from "happy-dom";
import { act } from "react";
import type { Root } from "react-dom/client";
import type { Action, ClientMessage, ServerMessage, SessionState } from "../../shared/protocol";
import { loadedBuild } from "../../shared/build";
import { screen } from "../testing";
import type { Credentials, useSession } from "./session";

const credentials: Credentials = { origin: "http://localhost", token: "paired", installationId: "installation" };
const state: SessionState = { queue: [], currentEntryId: null, activeProfile: { id: "household", name: "Household" }, player: { playbackId: null, status: "idle", position: 0, duration: null, volume: 80, seekable: false, error: null } };
const atom = { type: "enqueueProvider", provider: "youtube", shape: "atom", url: "https://www.youtube.com/watch?v=abcdefghijk", title: "Episode" } as const;
const playlist = { ...atom, shape: "playlist", url: "https://www.youtube.com/playlist?list=PL1234567890" } as const;
const sockets: Socket[] = [];
const originals = new Map<string, PropertyDescriptor | undefined>();
const timers: Array<{ handle: ReturnType<typeof setTimeout>; delay: number; fired: boolean; fire: () => void }> = [];
let root: Root | undefined, window: Window | undefined, session: ReturnType<typeof useSession>;
let fetchSpy: ReturnType<typeof spyOn>, timerSpy: ReturnType<typeof spyOn> | undefined;
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
  sockets.length = timers.length = 0;
  window = new Window({ url: credentials.origin });
  for (const key of ["window", "document", "location", "navigator", "HTMLElement", "Element", "Node", "Event", "MessageEvent", "localStorage", "sessionStorage", "WebSocket", "IS_REACT_ACT_ENVIRONMENT"]) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    const value = key === "IS_REACT_ACT_ENVIRONMENT" ? true : key === "WebSocket" ? Socket : key === "window" ? window : Reflect.get(window, key);
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  fetchSpy = spyOn(globalThis, "fetch").mockImplementation((async (input: RequestInfo | URL) => {
    const path = new URL(String(input)).pathname;
    if (path === "/api/connection") return Response.json({ name: "Couch", installationId: "installation", urls: [credentials.origin], player: "idle", remoteControlEnabled: true });
    if (path === "/api/build") return Response.json(loadedBuild);
    if (path === "/api/controllers/me") return Response.json({ controller: { id: "remote", name: "Remote", role: "controller" }, authority: "controller", claimAvailable: false });
    throw new Error(`Unexpected session request: ${path}`);
  }) as typeof fetch);
  const { createRoot } = await import("react-dom/client");
  const { useSession } = await import("./session");
  function Probe({ connection }: { connection: Credentials }) {
    session = useSession(connection);
    return <output role="status">{session.status}</output>;
  }
  const container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  mount = async next => { await act(async () => root!.render(<Probe connection={next} />)); };
  await mount(credentials);
  expect(sockets).toHaveLength(1);
  await act(async () => sockets[0]!.emit({ type: "state", state }));
  expect(screen.getByRole("status").textContent).toBe("connected");

  // Control only the command confirmation deadlines, after the handshake.
  // Keeping real scheduler handles lets the hook's ordinary clearTimeout and
  // cleanup paths run unchanged; tests do not wait eight or thirty-five seconds.
  const schedule = globalThis.setTimeout;
  timerSpy = spyOn(globalThis, "setTimeout").mockImplementation(((...args: Parameters<typeof setTimeout>) => {
    const handle = schedule(...args);
    const [callback, delay] = args;
    if (typeof callback === "function" && (delay === 8_000 || delay === 35_000)) timers.push({ handle, delay, fired: false, fire: () => callback(...args.slice(2)) });
    return handle;
  }) as typeof setTimeout);
});

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  for (const timer of timers) clearTimeout(timer.handle);
  timerSpy?.mockRestore(); timerSpy = undefined;
  fetchSpy?.mockRestore();
  await window?.happyDOM.abort(); window = undefined;
  for (const [key, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  originals.clear();
});

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
  expect(sockets[0]!.sent).toHaveLength(1);
  expect(sockets[0]!.sent[0]!.action).toEqual(action);
  expect(timers).toHaveLength(1);
  await elapse(8_001);
  expect(outcome).toBe("pending");
  sockets[0]!.emit({ type: "result", requestId: sockets[0]!.sent[0]!.requestId, ok: true });
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
  sockets[0]!.emit({ type: "result", requestId: sockets[0]!.sent[0]!.requestId, ok: true });
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
  const oldSocket = sockets[0]!, oldRequest = oldSocket.sent[0]!;
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
  nextSocket.emit({ type: "result", requestId: nextSocket.sent[0]!.requestId, ok: true });
  await next;
  expect(nextOutcome).toBe("confirmed");
});
