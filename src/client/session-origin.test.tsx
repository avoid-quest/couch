import { setupUiTests, render as renderUI, screen, testWindow } from "./testing/react";
import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { act, startTransition, StrictMode, Suspense, use, useLayoutEffect } from "react";
import { useSession, type Credentials } from "./session/session";
import { knownConnection, rememberConnection } from "./session/connection";
import * as connection from "./session/connection";
import type { ConnectionDetails, ControllerIdentity } from "../shared/controllers";
import type { ClientMessage, NavigationKey, ServerMessage, SessionState } from "../shared/protocol";
import { loadedBuild } from "../shared/build";

setupUiTests();

let view: ReturnType<typeof renderUI>, request: ReturnType<typeof spyOn>;
let current: ReturnType<typeof useSession>;
const originalRevision = loadedBuild.revision;
const details: ConnectionDetails = { name: "Living room", player: "idle", urls: ["http://192.168.1.20:4100"], installationId: "installation" };
const identity: ControllerIdentity = { controller: null, authority: "administrator", claimAvailable: false };
const state: SessionState = { queue: [], currentEntryId: null, activeProfile: { id: "household", name: "Household" }, player: { playbackId: null, status: "idle", position: 0, duration: null, volume: 80, seekable: false, error: null } };
const credentials: Credentials = { origin: "http://192.168.1.20:4100", token: "pairing", installationId: "installation" };

class Socket {
  static OPEN = 1;
  static instances: Socket[] = [];
  readyState = 0;
  closed = false;
  sent: ClientMessage[] = [];
  onopen?: () => void;
  onmessage?: (event: MessageEvent<string>) => void;
  onerror?: () => void;
  onclose?: (event: CloseEvent) => void;
  constructor(readonly url: URL) { Socket.instances.push(this); }
  open() { this.readyState = Socket.OPEN; this.onopen?.(); }
  receive(message: ServerMessage) { this.onmessage?.({ data: JSON.stringify(message) } as MessageEvent<string>); }
  send(message: string) { this.sent.push(JSON.parse(message)); }
  close(code = 1000) { this.readyState = 3; this.closed = true; this.onclose?.({ code } as CloseEvent); }
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
function online() {
  request.mockImplementation(async (url: string | URL | Request) => Response.json(String(url).endsWith("/api/connection") ? details : identity));
}
function Remote({ credentials, onNavigation, pending, selectedOrigin, desktopProtocol }: { credentials: Credentials | null; onNavigation?: (key: NavigationKey) => void; pending?: Promise<void>; selectedOrigin?: string; desktopProtocol?: number }) {
  const session = useSession(credentials, onNavigation, selectedOrigin, desktopProtocol);
  useLayoutEffect(() => { current = session; });
  if (pending) use(pending);
  return <output>{session.status}</output>;
}

beforeEach(async () => {
  testWindow.happyDOM.setURL("http://192.168.1.20:4100");
  spyOn(globalThis, "WebSocket").mockImplementation(((url: string | URL) => new Socket(new URL(String(url)))) as never);
  Object.assign(WebSocket, { OPEN: Socket.OPEN });
  Socket.instances = [];
  request = spyOn(globalThis, "fetch").mockRejectedValue(new Error("Selected computer is offline"));
  view = renderUI(null);
});
afterEach(() => { loadedBuild.revision = originalRevision; });

test("an unavailable target never sends its pairing to advertised aliases", async () => {
  rememberConnection(location.origin, { name: "Living room", player: "idle", urls: ["http://192.168.1.99:4100"] });
  await act(async () => view.rerender(<Remote credentials={{ origin: location.origin, token: "paired-only-here" }} />));
  expect(request).toHaveBeenCalledTimes(1);
  expect(String(request.mock.calls[0]![0])).toStartWith(location.origin + "/api/");
  expect(new Headers(request.mock.calls[0]![1]?.headers).has("Authorization")).toBe(false);
  expect(screen.getByRole("status").textContent).toBe("server-unavailable");
});

test("an unpaired page checks its own origin despite cached connection addresses", async () => {
  rememberConnection("http://192.168.1.99:4100", { name: "Old address", player: "idle", urls: ["http://192.168.1.98:4100"] });
  await act(async () => view.rerender(<Remote credentials={null} />));
  expect(request).toHaveBeenCalledTimes(1);
  expect(request.mock.calls[0]![0]).toBe(location.origin + "/api/connection");
  expect(new Headers(request.mock.calls[0]![1]?.headers).has("Authorization")).toBe(false);
});


test("a replaced installation at the same origin requires pairing before any credential is sent", async () => {
  request.mockImplementation(async () => Response.json({ name: "Different Couch", player: "idle", urls: [location.origin], installationId: "different-installation" }));
  await act(async () => view.rerender(<Remote credentials={{ origin: location.origin, token: "old-pairing", installationId: "remembered-installation" }} />));
  expect(screen.getByRole("status").textContent).toBe("pairing-required");
  expect(request.mock.calls.length).toBeGreaterThan(0);
  for (const [url, options] of request.mock.calls) {
    expect(url).toBe(location.origin + "/api/connection");
    expect(new Headers(options?.headers).has("Authorization")).toBe(false);
  }
});

test("bundled remote discovery rejects incompatible hosts before sending a pairing", async () => {
  request.mockImplementation(async () => Response.json({ ...details, desktopClientProtocol: 2 }));
  await act(async () => view.rerender(<Remote credentials={credentials} selectedOrigin={credentials.origin} desktopProtocol={1} />));
  expect(current.status).toBe("protocol-mismatch");
  expect(Socket.instances).toHaveLength(0);
  expect(request.mock.calls.map(([url]: [unknown]) => String(url))).toEqual([`${credentials.origin}/api/connection`]);
  expect(new Headers(request.mock.calls[0]![1]?.headers).has("Authorization")).toBe(false);
});

test("bundled remote discovery rejects a host without a protocol marker", async () => {
  request.mockImplementation(async () => Response.json(details));
  await act(async () => view.rerender(<Remote credentials={credentials} selectedOrigin={credentials.origin} desktopProtocol={1} />));
  expect(current.status).toBe("protocol-mismatch");
  expect(Socket.instances).toHaveLength(0);
  expect(request.mock.calls.map(([url]: [unknown]) => String(url))).toEqual([`${credentials.origin}/api/connection`]);
});

test("bundled remote sessions accept a different host revision under the same protocol", async () => {
  loadedBuild.revision = "desktop-client";
  request.mockImplementation(async (url: string | URL | Request) => Response.json(String(url).endsWith("/api/connection") ? { ...details, desktopClientProtocol: 1 } : identity));
  await act(async () => view.rerender(<Remote credentials={credentials} selectedOrigin={credentials.origin} desktopProtocol={1} />));
  expect(Socket.instances).toHaveLength(1);
  expect(Socket.instances[0]!.url.searchParams.get("clientProtocol")).toBe("1");
  expect(request.mock.calls.some(([url]: [unknown]) => String(url).endsWith("/api/build"))).toBe(false);
});


test("navigation uses the latest committed callback without replacing its WebSocket", async () => {
  online();
  const received: string[] = [];
  const render = (prefix: string, pending?: Promise<void>) => <Suspense fallback="Waiting"><Remote credentials={credentials} onNavigation={key => received.push(`${prefix}:${key}`)} pending={pending} /></Suspense>;
  await act(async () => view.rerender(render("first")));
  const socket = Socket.instances[0]!;
  await act(async () => socket.receive({ type: "navigation", key: "home" }));
  await act(async () => view.rerender(render("second")));
  await act(async () => socket.receive({ type: "navigation", key: "back" }));
  const suspended = deferred<void>();
  await act(async () => startTransition(() => view.rerender(render("uncommitted", suspended.promise))));
  await act(async () => socket.receive({ type: "navigation", key: "select" }));
  expect(received).toEqual(["first:home", "second:back", "second:select"]);
  expect(Socket.instances).toHaveLength(1);
  expect(socket.closed).toBe(false);
  await act(async () => suspended.resolve());
  await act(async () => socket.receive({ type: "navigation", key: "right" }));
  expect(received.at(-1)).toBe("uncommitted:right");
});

test("connection details follow session metadata and persist without rewriting for playback ticks", async () => {
  online();
  await act(async () => view.rerender(<Remote credentials={credentials} />));
  const socket = Socket.instances[0]!;
  expect(current.details).toEqual(details);
  const renamed: SessionState = { ...state, installationName: "Den", player: { ...state.player, status: "playing" } };
  await act(async () => { socket.open(); socket.receive({ type: "state", state: renamed }); });
  expect(current.details).toEqual({ ...details, name: "Den", player: "playing" });
  expect(current.playerStatus).toBe("playing");
  expect(knownConnection()).toEqual({ origin: credentials.origin, details: { ...details, name: "Den", player: "playing" } });
  const storage = spyOn(connection, "rememberConnection");
  try {
    await act(async () => socket.receive({ type: "state", state: { ...renamed, player: { ...renamed.player, position: 1 } } }));
    expect(storage).not.toHaveBeenCalled();
    await act(async () => socket.receive({ type: "state", state: { ...renamed, installationName: "Office", player: { ...renamed.player, status: "paused" } } }));
    expect(storage).toHaveBeenCalledTimes(1);
    expect(knownConnection()?.details).toEqual({ ...details, name: "Office", player: "paused" });
  } finally { storage.mockRestore(); }
});

test.each(["origin", "token", "installationId"] as const)("changing %s resets controller identity and rejects commands from the previous connection", async key => {
  online();
  await act(async () => view.rerender(<Remote credentials={credentials} />));
  const socket = Socket.instances[0]!;
  await act(async () => { socket.open(); socket.receive({ type: "state", state }); });
  expect(current.identity).toEqual(identity);
  const pending = current.command({ type: "stop" }).then(() => null, error => error as Error);
  expect(socket.sent).toHaveLength(1);
  const response = deferred<Response>();
  request.mockImplementation(() => response.promise);
  const next = { ...credentials, [key]: key === "origin" ? "http://192.168.1.21:4100" : "replacement" };
  await act(async () => view.rerender(<Remote credentials={next} />));
  expect(current.identity).toBeNull();
  expect(current.state).toBeNull();
  expect(current.pairingRequired).toBe(false);
  expect(socket.closed).toBe(true);
  expect((await pending)?.message).toContain("Connection lost");
  await expect(current.command({ type: "stop" })).rejects.toThrow("Reconnecting. Try again in a moment.");
  await act(async () => socket.receive({ type: "state", state }));
  expect(current.state).toBeNull();
  if (key === "origin") {
    expect(current.details).toBeNull();
    expect(knownConnection()?.origin).toBe(credentials.origin);
  }
});

test.each(["origin", "token", "installationId"] as const)("changing %s clears rejection of the previous pairing", async key => {
  request.mockImplementation(async (url: string | URL | Request) => String(url).endsWith("/api/connection") ? Response.json(details) : new Response(null, { status: 401 }));
  await act(async () => view.rerender(<Remote credentials={credentials} />));
  expect(current.pairingRequired).toBe(true);
  expect(current.playerStatus).toBe("idle");
  const response = deferred<Response>();
  request.mockImplementation(() => response.promise);
  const next = { ...credentials, [key]: key === "origin" ? "http://192.168.1.21:4100" : "replacement" };
  await act(async () => view.rerender(<Remote credentials={next} />));
  expect(current.pairingRequired).toBe(false);
  expect(current.status).toBe("connecting");
});

test("an origin change ignores an older public response completed after the new connection", async () => {
  const stale = deferred<Response>();
  request.mockImplementation(() => stale.promise);
  await act(async () => view.rerender(<Remote credentials={credentials} />));
  const staleSignal = request.mock.calls[0]![1]!.signal as AbortSignal;
  const next = { ...credentials, origin: "http://192.168.1.21:4100" };
  const nextDetails = { ...details, name: "Bedroom", urls: [next.origin] };
  request.mockImplementation(async (url: string | URL | Request) => Response.json(String(url).endsWith("/api/connection") ? nextDetails : identity));
  await act(async () => view.rerender(<Remote credentials={next} />));
  expect(staleSignal.aborted).toBe(true);
  await act(async () => stale.resolve(Response.json(details)));
  expect(current.details).toEqual(nextDetails);
  expect(knownConnection()).toEqual({ origin: next.origin, details: nextDetails });
  expect(Socket.instances).toHaveLength(1);
  expect(Socket.instances[0]!.url.origin).toBe("ws://192.168.1.21:4100");
});

test("controller refresh ignores an older response body completed after a new controller version", async () => {
  online();
  await act(async () => view.rerender(<Remote credentials={credentials} />));
  const socket = Socket.instances[0]!;
  const stale = deferred<ControllerIdentity>();
  request.mockImplementation(async (url: string | URL | Request) => String(url).endsWith("/api/connection") ? Response.json(details) : ({ ok: true, status: 200, json: () => stale.promise }) as Response);
  await act(async () => { socket.open(); socket.receive({ type: "state", state }); });
  const staleSignal = request.mock.calls.at(-1)![1]!.signal as AbortSignal;
  const restricted: ControllerIdentity = { ...identity, authority: "controller" };
  request.mockImplementation(async (url: string | URL | Request) => Response.json(String(url).endsWith("/api/connection") ? details : restricted));
  await act(async () => socket.receive({ type: "state", state: { ...state, versions: { controllers: 1 } } }));
  expect(current.identity).toEqual(restricted);
  await act(async () => stale.resolve(identity));
  expect(staleSignal.aborted).toBe(true);
  expect(current.identity).toEqual(restricted);
});

test("a disposed build response cannot reload the replacement connection", async () => {
  loadedBuild.revision = "client";
  const stale = deferred<typeof loadedBuild>();
  request.mockImplementation(async (url: string | URL | Request) => String(url).endsWith("/api/build") ? ({ ok: true, status: 200, json: () => stale.promise }) as Response : Response.json(details));
  await act(async () => view.rerender(<Remote credentials={credentials} />));
  const next = { ...credentials, origin: "http://192.168.1.21:4100" };
  request.mockImplementation(async (url: string | URL | Request) => Response.json(String(url).endsWith("/api/connection") ? { ...details, urls: [next.origin] } : String(url).endsWith("/api/build") ? loadedBuild : identity));
  await act(async () => view.rerender(<Remote credentials={next} />));
  const socket = Socket.instances[0]!;
  await act(async () => { socket.open(); socket.receive({ type: "state", state }); });
  const reload = spyOn(location, "reload").mockImplementation(() => {});
  try {
    await act(async () => stale.resolve({ ...loadedBuild, revision: "obsolete-server" }));
    expect(reload).not.toHaveBeenCalled();
    expect(current.status).toBe("connected");
    expect(sessionStorage.getItem(`couch.asset-refresh:${credentials.origin}`)).toBeNull();
  } finally { reload.mockRestore(); }
});

test("Strict Mode aborts its discarded fetch and closes the surviving socket on unmount", async () => {
  const discarded = deferred<Response>();
  const signals: AbortSignal[] = [];
  request.mockImplementation(async (url: string | URL | Request, options?: RequestInit) => {
    signals.push(options!.signal as AbortSignal);
    if (signals.length === 1) return discarded.promise;
    return Response.json(String(url).endsWith("/api/connection") ? details : identity);
  });
  await act(async () => view.rerender(<StrictMode><Remote credentials={credentials} /></StrictMode>));
  expect(signals[0]!.aborted).toBe(true);
  expect(signals[1]!.aborted).toBe(false);
  await act(async () => discarded.resolve(Response.json({ ...details, name: "Discarded" })));
  expect(Socket.instances).toHaveLength(1);
  expect(current.details?.name).toBe("Living room");
  const socket = Socket.instances[0]!;
  await act(async () => { socket.open(); socket.receive({ type: "state", state }); });
  const pending = current.command({ type: "stop" }).then(() => null, error => error as Error);
  await act(async () => view.rerender(null));
  expect(socket.closed).toBe(true);
  expect(signals.every(signal => signal.aborted)).toBe(true);
  expect((await pending)?.message).toContain("Connection lost");
});
