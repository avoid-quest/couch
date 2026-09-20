import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { Window } from "happy-dom";
import { act } from "react";
import type { Root } from "react-dom/client";
import { onlineManager, QueryClient, QueryClientProvider, useQuery, useQueryClient } from "@tanstack/react-query";
import { isRedirect } from "@tanstack/react-router";
import type { ServerMessage, SessionState } from "../../shared/protocol";
import { loadedBuild } from "../../shared/build";
import { historyQuery } from "../api/library";
import { screen, fireEvent } from "../testing";
import { requireAdministrator } from "../routes/settings/-administrator";
import type { useSessionGate } from "./session-context";

const origin = "http://localhost";
const state: SessionState = { queue: [], currentEntryId: null, activeProfile: { id: "household", name: "Household" }, player: { playbackId: null, status: "idle", position: 0, duration: null, volume: 80, seekable: false, error: null } };
const originals = new Map<string, PropertyDescriptor | undefined>();
const sockets: Socket[] = [];
let root: Root | undefined, window: Window, outer: QueryClient, client: QueryClient;
let gate: ReturnType<typeof useSessionGate>;
let fetchSpy: ReturnType<typeof spyOn>;
const storageSpies: Array<ReturnType<typeof spyOn>> = [];
const requests: Array<{ path: string; token: string | null; signal?: AbortSignal | null }> = [];
let installation: string, role: "administrator" | "controller", title: string;
let delayedRead: ReturnType<typeof Promise.withResolvers<Response>> | undefined;
let delayedPair: ReturnType<typeof Promise.withResolvers<Response>> | undefined;
let readSignal: AbortSignal | null | undefined;

class Socket {
  static OPEN = 1;
  readyState = 1;
  onopen: (() => void) | null = null;
  onmessage: ((event: MessageEvent<string>) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(readonly url: URL) { sockets.push(this); }
  send() {}
  emit(message: ServerMessage) { this.onmessage?.({ data: JSON.stringify(message) } as MessageEvent<string>); }
  close(code = 1000) { this.readyState = 3; this.onclose?.({ code } as CloseEvent); }
}

const history = (name: string) => Response.json({ items: [{ mediaId: "library:movie", title: name, libraryItemId: "movie", position: 0, duration: null, watched: false, lastPlayedAt: 1 }] });
const flush = () => act(async () => { await Bun.sleep(15); });
async function until(predicate: () => boolean) {
  const deadline = Date.now() + 2_000;
  while (!predicate()) { if (Date.now() > deadline) throw new Error("Connection behavior did not settle"); await flush(); }
}
async function connected() {
  await until(() => !!sockets.at(-1) && sockets.at(-1)!.readyState === 1);
  await act(async () => sockets.at(-1)!.emit({ type: "state", state }));
  await until(() => gate.connected);
  await flush();
}
async function mount() {
  const { SessionGate, useSessionGate } = await import("./session-context");
  const { createRoot } = await import("react-dom/client");
  function Probe() {
    gate = useSessionGate(); client = useQueryClient();
    const query = useQuery({ ...historyQuery(gate.credentials ?? { origin, token: "" }), enabled: gate.connected && !gate.pairingRequired });
    return <>
      <output role="status">{gate.status}</output>
      <p>{query.data?.items[0]?.title ?? "No cached history"}</p>
      <button onClick={() => gate.unpair()}>Unpair</button>
    </>;
  }
  const container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  // Retain the former outer provider so the same public behavior cases also
  // characterize the pre-fix gate. The gate's own provider must supersede it.
  outer = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => root!.render(<QueryClientProvider client={outer}><SessionGate><Probe /></SessionGate></QueryClientProvider>));
  await flush();
}
async function pair() {
  await act(async () => { gate.setPairingCode("123456"); gate.setRemoteName("Memory remote"); });
  const count = sockets.length;
  await act(async () => { await gate.pair({ preventDefault() {} }); });
  await until(() => sockets.length > count);
  await connected();
}

beforeEach(() => {
  installation = "installation"; role = "administrator"; title = "Old household";
  delayedRead = delayedPair = undefined; readSignal = undefined;
  sockets.length = requests.length = 0;
  window = new Window({ url: origin });
  for (const key of ["CSS", "window", "document", "location", "history", "navigator", "localStorage", "sessionStorage", "HTMLElement", "HTMLInputElement", "HTMLButtonElement", "Element", "Node", "Event", "MouseEvent", "KeyboardEvent", "CustomEvent", "MutationObserver", "ResizeObserver", "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame", "WebSocket", "IS_REACT_ACT_ENVIRONMENT"]) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    const value = key === "IS_REACT_ACT_ENVIRONMENT" ? true : key === "WebSocket" ? Socket : key === "window" ? window : Reflect.get(window, key);
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: typeof value === "function" && /^[a-z]/.test(key) ? value.bind(window) : value });
  }
  localStorage.setItem("couch.remote-token", "old-secret");
  localStorage.setItem("couch.remote-installation-id", installation);
  fetchSpy = spyOn(globalThis, "fetch").mockImplementation((async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(String(input)).pathname;
    requests.push({ path, token: new Headers(init?.headers).get("Authorization"), signal: init?.signal });
    if (path === "/api/connection") return Response.json({ name: "Couch", installationId: installation, urls: [origin], player: "idle", remoteControlEnabled: true });
    if (path === "/api/build") return Response.json(loadedBuild);
    if (path === "/api/controllers/me") return Response.json({ authority: role, controller: { id: "remote", name: "Memory remote", role }, claimAvailable: false });
    if (path === "/api/pair") return delayedPair ? delayedPair.promise : Response.json({ token: "new-secret", installationId: installation });
    if (path === "/api/progress/history") {
      if (delayedRead) { readSignal = init?.signal; return delayedRead.promise; }
      return history(title);
    }
    if (path === "/api/activity") return new Response(null, { status: 204 });
    throw new Error(`Unexpected request: ${path}`);
  }) as typeof fetch);
});

afterEach(async () => {
  delayedRead?.resolve(history("Retired household"));
  delayedPair?.resolve(Response.json({ token: "late-secret", installationId: installation }));
  if (root) await act(async () => root!.unmount()); root = undefined;
  outer?.clear(); client?.clear();
  fetchSpy?.mockRestore();
  for (const spy of storageSpies.splice(0)) spy.mockRestore();
  await window.happyDOM.abort();
  for (const [key, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  originals.clear();
});

test("unpair retires in-flight reads; re-pair cannot display a late old household response", async () => {
  await mount(); await connected();
  await until(() => !!screen.queryByText("Old household"));
  const previous = client;
  delayedRead = Promise.withResolvers<Response>();
  void previous.invalidateQueries({ queryKey: ["library", "history"] });
  await until(() => !!readSignal);
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Unpair" })));
  expect(client).not.toBe(previous);
  expect(readSignal?.aborted).toBe(true);
  expect(screen.queryByText("Old household")).toBeNull();
  const late = delayedRead; delayedRead = undefined; title = "New household";
  await pair();
  late.resolve(history("Retired household"));
  await until(() => !!screen.queryByText("New household"));
  expect(screen.queryByText("Retired household")).toBeNull();
  expect(previous.getQueryCache().getAll()).toEqual([]);
  expect(JSON.stringify(client.getQueryCache().getAll().map(query => query.queryKey))).not.toContain("secret");
});

test("storage-disabled pairing supplies live administrator authority and authenticated reads", async () => {
  Object.defineProperty(globalThis, "localStorage", { configurable: true, get() { throw new Error("Storage disabled"); } });
  await mount();
  expect(gate.credentials).toBeNull();
  await pair();
  expect(gate.credentials?.token).toBe("new-secret");
  const context = { queryClient: client, identity: gate.identity, connected: gate.connected };
  await requireAdministrator({ context });
  expect(requests.some(request => request.path === "/api/progress/history" && request.token === "Bearer new-secret")).toBe(true);
});

test("a role change retires administrator data and immediately changes route authority", async () => {
  await mount(); await connected();
  const previous = client;
  previous.setQueryData(["controllers", "list"], [{ name: "Administrator-only data" }]);
  role = "controller";
  await act(async () => sockets.at(-1)!.emit({ type: "state", state: { ...state, controllerVersion: 1 } }));
  await until(() => gate.identity?.authority === "controller");
  expect(client).not.toBe(previous);
  expect(client.getQueryData(["controllers", "list"])).toBeUndefined();
  const context = { queryClient: client, identity: gate.identity, connected: gate.connected };
  const result = await requireAdministrator({ context }).catch(error => error);
  expect(isRedirect(result)).toBe(true);
});

test("revocation clears visible data and repairing the same origin uses a new cache", async () => {
  await mount(); await connected();
  await until(() => !!screen.queryByText("Old household"));
  const previous = client;
  await act(async () => sockets.at(-1)!.close(4001));
  expect(gate.pairingRequired).toBe(true);
  expect(gate.identity).toBeNull();
  expect(client).not.toBe(previous);
  expect(screen.queryByText("Old household")).toBeNull();
  title = "New household";
  await pair();
  await until(() => !!screen.queryByText("New household"));
});

test("installation replacement at the same address does not send the old token to identity reads", async () => {
  await mount(); await connected();
  const previous = client, start = requests.length;
  installation = "replacement-installation";
  await act(async () => gate.reconnect());
  await until(() => gate.pairingRequired);
  expect(client).not.toBe(previous);
  expect(gate.identity).toBeNull();
  expect(requests.slice(start).filter(request => request.path === "/api/controllers/me")).toEqual([]);
});

test("ordinary reconnect revalidates cached reads even when server version counters restart at zero", async () => {
  await mount(); await connected();
  await until(() => !!screen.queryByText("Old household"));
  const count = sockets.length;
  title = "Updated household";
  await act(async () => gate.reconnect());
  await until(() => sockets.length > count);
  await connected();
  await until(() => !!screen.queryByText("Updated household"));
});

test("unpair cancels a pending pairing response rather than silently pairing the tab again", async () => {
  await mount(); await connected();
  delayedPair = Promise.withResolvers<Response>();
  let pending!: Promise<void>;
  await act(async () => { pending = gate.pair({ preventDefault() {} }); });
  await act(async () => gate.unpair());
  delayedPair.resolve(Response.json({ token: "late-secret", installationId: installation }));
  await act(async () => pending);
  expect(gate.credentials).toBeNull();
  expect(localStorage.getItem("couch.remote-token")).toBeNull();
});

test("a reachable local coordinator still serves and refreshes reads when the browser reports offline", async () => {
  const wasOnline = onlineManager.isOnline();
  onlineManager.setOnline(false);
  try {
    await mount(); await connected();
    await until(() => !!screen.queryByText("Old household"));
    title = "Updated local library";
    await act(async () => sockets.at(-1)!.emit({ type: "state", state: { ...state, libraryVersion: 1 } }));
    await until(() => !!screen.queryByText("Updated local library"));
    expect(onlineManager.isOnline()).toBe(false);
    expect(gate.connected).toBe(true);
  } finally { await act(async () => onlineManager.setOnline(wasOnline)); }
});

test("a captured callback from a revoked socket cannot restore connected state", async () => {
  await mount(); await connected();
  const revoked = sockets.at(-1)!;
  const lateMessage = revoked.onmessage!;
  await act(async () => revoked.close(4001));
  await act(async () => lateMessage({ data: JSON.stringify({ type: "state", state }) } as MessageEvent<string>));
  expect(gate.connected).toBe(false);
  expect(gate.pairingRequired).toBe(true);
  expect(gate.identity).toBeNull();
  expect(gate.state).toBeNull();
});
