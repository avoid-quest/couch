import { setupUiTests, act, renderWithQueryClient, createTestQueryClient, screen, userEvent, fireEvent, waitFor } from "@/testing/react";
import { afterEach, beforeEach, expect, jest, spyOn, test } from "bun:test";
import { onlineManager, type QueryClient, useQuery, useQueryClient } from "@tanstack/react-query";
import { isRedirect } from "@tanstack/react-router";
import type { ServerMessage, SessionState } from "../../shared/protocol";
import { loadedBuild } from "../../shared/build";
import { historyQuery } from "../api/library";
import { requireAdministrator } from "../routes/settings/-administrator";
import type { useSessionGate } from "./session-context";

setupUiTests();

const originalWebSocket = globalThis.WebSocket;
afterEach(() => { globalThis.WebSocket = originalWebSocket; });

const origin = "http://localhost";
const state: SessionState = { queue: [], currentEntryId: null, activeProfile: { id: "household", name: "Household" }, player: { playbackId: null, status: "idle", position: 0, duration: null, volume: 80, seekable: false, error: null } };
const sockets: Socket[] = [];
let client: QueryClient;
let gate: ReturnType<typeof useSessionGate>;
const requests: Array<{ path: string; token: string | null; signal?: AbortSignal | null }> = [];
let sharing = true;
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
async function connected() {
  await waitFor(() => expect(sockets.at(-1)?.readyState).toBe(1));
  await act(async () => sockets.at(-1)!.emit({ type: "state", state }));
  await waitFor(() => expect(gate.connected).toBe(true));
}
async function mount() {
  const { SessionGate, useSessionGate } = await import("./session-context");
  const { PairForm } = await import("../sections/shell/PairForm");
  function Probe() {
    gate = useSessionGate(); client = useQueryClient();
    const query = useQuery({ ...historyQuery(gate.credentials ?? { origin, token: "" }), enabled: gate.connected && !gate.pairingRequired });
    return <>
      <output role="status">{gate.status}</output>
      <p>{query.data?.items[0]?.title ?? "No cached history"}</p>
      <button onClick={() => gate.unpair()}>Unpair</button>
      <PairForm />
    </>;
  }
  // The gate must own a separate query cache for each connection.
  await act(async () => { renderWithQueryClient(<SessionGate><Probe /></SessionGate>, createTestQueryClient()); });
}
async function pair() {
  const { requestPairing } = await import("../sections/shell/PairForm");
  const count = sockets.length;
  await act(async () => gate.savePairing(await requestPairing(gate.pairingOrigin, "123456", "Memory remote")));
  await waitFor(() => expect(sockets.length).toBeGreaterThan(count));
  await connected();
}

beforeEach(() => {
  sharing = true; installation = "installation"; role = "administrator"; title = "Old household";
  delayedRead = delayedPair = undefined; readSignal = undefined;
  sockets.length = requests.length = 0;
  globalThis.WebSocket = Socket as unknown as typeof WebSocket;
  localStorage.setItem("couch.remote-token", "old-secret");
  localStorage.setItem("couch.remote-installation-id", installation);
  spyOn(globalThis, "fetch").mockImplementation((async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(String(input)).pathname;
    requests.push({ path, token: new Headers(init?.headers).get("Authorization"), signal: init?.signal });
    if (path === "/api/connection") return Response.json({ name: "Couch", installationId: installation, urls: [origin], player: "idle", remoteControlEnabled: sharing });
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
  client?.clear();
});

test("unpair retires in-flight reads; re-pair cannot display a late old household response", async () => {
  await mount(); await connected();
  await screen.findByText("Old household");
  const previous = client;
  delayedRead = Promise.withResolvers<Response>();
  void previous.invalidateQueries({ queryKey: ["progress", "history"] });
  await waitFor(() => expect(readSignal).toBeTruthy());
  await userEvent.click(screen.getByRole("button", { name: "Unpair" }));
  expect(client).not.toBe(previous);
  expect(readSignal?.aborted).toBe(true);
  expect(screen.queryByText("Old household")).toBeNull();
  const late = delayedRead; delayedRead = undefined; title = "New household";
  await pair();
  await act(async () => late.resolve(history("Retired household")));
  await screen.findByText("New household");
  expect(screen.queryByText("Retired household")).toBeNull();
  expect(previous.getQueryCache().getAll()).toEqual([]);
  expect(JSON.stringify(client.getQueryCache().getAll().map(query => query.queryKey))).not.toContain("secret");
});

test("storage-disabled pairing supplies live administrator authority and authenticated reads", async () => {
  const storage = Object.getOwnPropertyDescriptor(globalThis, "localStorage")!;
  Object.defineProperty(globalThis, "localStorage", { configurable: true, get() { throw new Error("Storage disabled"); } });
  try {
    await mount();
    expect(gate.credentials).toBeNull();
    await pair();
    expect(gate.credentials?.token).toBe("new-secret");
    const context = { queryClient: client, identity: gate.identity, connected: gate.connected };
    await requireAdministrator({ context });
    expect(requests.some(request => request.path === "/api/progress/history" && request.token === "Bearer new-secret")).toBe(true);
  } finally { Object.defineProperty(globalThis, "localStorage", storage); }
});

test("an older paired remote keeps its token when Couch reads the current installation ID", async () => {
  localStorage.removeItem("couch.remote-token");
  localStorage.setItem("modern-kodi.remote-token", "old-secret");
  await mount(); await connected();
  expect(gate.credentials?.token).toBe("old-secret");
  expect(localStorage.getItem("couch.remote-token")).toBe("old-secret");
  expect(localStorage.getItem("modern-kodi.remote-token")).toBeNull();
});

test("a role change retires administrator data and immediately changes route authority", async () => {
  await mount(); await connected();
  const previous = client;
  previous.setQueryData(["controllers", "list"], [{ name: "Administrator-only data" }]);
  role = "controller";
  await act(async () => sockets.at(-1)!.emit({ type: "state", state: { ...state, versions: { controllers: 1 } } }));
  await waitFor(() => expect(gate.identity?.authority).toBe("controller"));
  expect(client).not.toBe(previous);
  expect(client.getQueryData(["controllers", "list"])).toBeUndefined();
  const context = { queryClient: client, identity: gate.identity, connected: gate.connected };
  const result = await requireAdministrator({ context }).catch(error => error);
  expect(isRedirect(result)).toBe(true);
});

test("revocation clears visible data and repairing the same origin uses a new cache", async () => {
  await mount(); await connected();
  await screen.findByText("Old household");
  const previous = client;
  await act(async () => sockets.at(-1)!.close(4001));
  expect(gate.pairingRequired).toBe(true);
  expect(gate.identity).toBeNull();
  expect(client).not.toBe(previous);
  expect(screen.queryByText("Old household")).toBeNull();
  title = "New household";
  await pair();
  await screen.findByText("New household");
});

test("installation replacement at the same address does not send the old token to identity reads", async () => {
  await mount(); await connected();
  const previous = client, start = requests.length;
  installation = "replacement-installation";
  await act(async () => gate.reconnect());
  await waitFor(() => expect(gate.pairingRequired).toBe(true));
  expect(client).not.toBe(previous);
  expect(gate.identity).toBeNull();
  expect(requests.slice(start).filter(request => request.path === "/api/controllers/me")).toEqual([]);
});

test("ordinary reconnect revalidates cached reads even when server version counters restart at zero", async () => {
  await mount(); await connected();
  await screen.findByText("Old household");
  const count = sockets.length, previous = client;
  title = "Updated household";
  await act(async () => gate.reconnect());
  await waitFor(() => expect(sockets.length).toBeGreaterThan(count));
  await connected();
  await screen.findByText("Updated household");
  expect(client).toBe(previous);
});

test("a pushed revision refreshes an in-flight first read without another user action", async () => {
  const firstRead = delayedRead = Promise.withResolvers<Response>();
  await mount(); await connected();
  await waitFor(() => expect(readSignal).toBeDefined());
  delayedRead = undefined;
  title = "Updated household";
  await act(async () => sockets.at(-1)!.emit({ type: "state", state: { ...state, versions: { progress: 1 } } }));
  await act(async () => firstRead.resolve(history("Old household")));
  await waitFor(() => expect(screen.getByText("Updated household")).toBeVisible(), { timeout: 300 });
  expect(screen.queryByText("Old household")).toBeNull();
});

test("unpair cancels a pending pairing response rather than silently pairing the tab again", async () => {
  window.history.replaceState(null, "", "/#pair=123456");
  await mount(); await connected();
  delayedPair = Promise.withResolvers<Response>();
  await userEvent.click(screen.getByRole("button", { name: "Pair" }));
  expect(requests.at(-1)?.path).toBe("/api/pair");
  await act(async () => gate.unpair());
  await act(async () => delayedPair!.resolve(Response.json({ token: "late-secret", installationId: installation })));
  expect(gate.credentials).toBeNull();
  expect(localStorage.getItem("couch.remote-token")).toBeNull();
});

test("a reachable local coordinator still serves and refreshes reads when the browser reports offline", async () => {
  const wasOnline = onlineManager.isOnline();
  onlineManager.setOnline(false);
  try {
    await mount(); await connected();
    await screen.findByText("Old household");
    title = "Updated local library";
    await act(async () => sockets.at(-1)!.emit({ type: "state", state: { ...state, versions: { progress: 1 } } }));
    await screen.findByText("Updated local library");
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


test("live sharing changes update the connected gate", async () => {
  await mount(); await connected();
  expect(gate.remoteControlEnabled).toBe(true);
  sharing = false;
  await act(async () => sockets.at(-1)!.emit({ type: "state", state: { ...state, versions: { controllers: 1 } } }));
  await waitFor(() => expect(gate.remoteControlEnabled).toBe(false));
});


test("typing coalesces activity reports and unpairing cancels the trailing report", async () => {
  await mount(); await connected();
  jest.useFakeTimers();
  const activity = () => requests.filter(request => request.path === "/api/activity");
  for (let key = 0; key < 12; key++) fireEvent.keyDown(document, { key: "a" });
  expect(activity()).toHaveLength(1);
  await act(async () => jest.advanceTimersByTime(1_000));
  expect(activity()).toHaveLength(2);
  fireEvent.keyDown(document, { key: "b" });
  await act(async () => gate.unpair());
  await act(async () => jest.advanceTimersByTime(1_000));
  expect(activity()).toHaveLength(2);
});
