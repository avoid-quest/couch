import { setupUiTests, act, render, screen, userEvent } from "@/testing/react";
import { beforeEach, expect, mock, spyOn, test } from "bun:test";
import * as adapter from "@/session/sendspin-renderer";
import { ShellProviders } from "@/sections/shell/test-providers";
import { SendspinClientDialog, useSendspinClient } from "./SendspinClientDialog";

setupUiTests();
let connection = { origin: "http://core.local", token: "paired" };
let client: ReturnType<typeof useSendspinClient>;
let callbacks: Parameters<typeof adapter.createSendspinRenderer>[1];
const beforeLeave = mock(async () => {});
const afterJoin = mock(async (_clientId: string) => {});
const renderer = {
  clientId: "sdk-client", preload: mock(async () => {}), setEnrollment: mock(() => {}),
  connectFromGesture: mock(async () => {}), disconnect: mock(async () => {}),
  setVolume: mock(() => {}), setMuted: mock(() => {}), transport: mock(() => true), openPairingWindow: mock(() => {}),
};
function Probe({ onJoin = afterJoin }: { onJoin?: (clientId: string) => Promise<void> } = {}) {
  client = useSendspinClient({ credentials: connection, allowed: true, canActivate: () => true, rendererTargetId: "direct-target", canEnableHosting: true, afterJoin: onJoin, beforeLeave });
  return null;
}
function DialogProbe() {
  client = useSendspinClient({ credentials: connection, allowed: true, canActivate: () => true, rendererTargetId: "direct-target", afterJoin, beforeLeave });
  return <ShellProviders value={{ sendspin: client, connected: true, state: null, rendererTargetId: null, nativeHost: false }}>
    <SendspinClientDialog open onOpenChange={() => {}} />
  </ShellProviders>;
}
const playback = (connected: boolean): adapter.SendspinRendererState => ({ connected, isPlaying: false, volume: 100, muted: false, metadata: undefined, group: {}, supportedCommands: [] });
beforeEach(() => {
  connection = { origin: "http://core.local", token: "paired" };
  beforeLeave.mockClear();
  beforeLeave.mockImplementation(async () => {});
  afterJoin.mockClear();
  afterJoin.mockImplementation(async () => {});
  for (const method of Object.values(renderer)) if (typeof method === "function") method.mockClear();
  renderer.preload.mockImplementation(async () => {});
  renderer.connectFromGesture.mockImplementation(async () => {});
  renderer.disconnect.mockImplementation(async () => {});
  spyOn(adapter, "createSendspinRenderer").mockImplementation((_config, events) => { callbacks = events; return renderer; });
});

test("joining Sendspin reuses this device's name without another name prompt", async () => {
  const user = userEvent.setup();
  render(<DialogProbe />);
  expect(screen.queryByRole("textbox", { name: "Device name" })).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Another audio server…" }));
  await user.type(screen.getByRole("textbox", { name: "Server address" }), "wss://music.local/sendspin");
  await user.click(screen.getByRole("button", { name: "Continue" }));
  expect(adapter.createSendspinRenderer).toHaveBeenCalledWith(expect.objectContaining({ name: "Couch browser" }), expect.anything());
});

test("connection status follows SDK observations after connect resolves and across reconnects", async () => {
  const user = userEvent.setup();
  render(<DialogProbe />);
  await act(async () => client.prepare("external", "wss://music.local/sendspin", "Kitchen"));
  await user.click(screen.getByRole("button", { name: "Join" }));
  expect(renderer.connectFromGesture).toHaveBeenCalledTimes(1);
  await act(async () => callbacks.state(playback(false)));
  expect(screen.getByRole("status")).toHaveTextContent("Waiting for audio server connection or pairing…");
  expect(screen.getByRole("button", { name: "Open pairing window" })).toBeEnabled();
  await user.click(screen.getByRole("button", { name: "Open pairing window" }));
  expect(renderer.openPairingWindow).toHaveBeenCalledTimes(1);
  await act(async () => callbacks.state(playback(true)));
  expect(screen.getByRole("status")).toHaveTextContent("Connected to audio server.");
  await act(async () => callbacks.state(playback(false)));
  expect(screen.getByRole("status")).toHaveTextContent("Disconnected. Waiting to reconnect…");
  await act(async () => callbacks.state(playback(true)));
  expect(screen.getByRole("status")).toHaveTextContent("Connected to audio server.");
  await user.click(screen.getByRole("button", { name: "Leave audio server" }));
  expect(client.phase).toBe("idle");
  await act(async () => client.prepare("external", "wss://music.local/sendspin", "Kitchen"));
  await user.click(screen.getByRole("button", { name: "Join" }));
  await act(async () => callbacks.state(playback(false)));
  expect(screen.getByRole("status")).toHaveTextContent("Waiting for audio server connection or pairing…");
});

test("exhausted reconnects show a recoverable stop and Leave permits a fresh Join", async () => {
  const user = userEvent.setup();
  render(<DialogProbe />);
  await act(async () => client.prepare("external", "wss://music.local/sendspin", "Kitchen"));
  await user.click(screen.getByRole("button", { name: "Join" }));
  await act(async () => { callbacks.state(playback(false)); callbacks.error(new Error(adapter.sendspinReconnectStopped)); });
  expect(screen.getByRole("alert")).toHaveTextContent("Sendspin stopped reconnecting. Leave and join again.");
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Open pairing window" })).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Leave audio server" }));
  await act(async () => client.prepare("external", "wss://music.local/sendspin", "Kitchen"));
  await user.click(screen.getByRole("button", { name: "Join" }));
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  await act(async () => callbacks.state(playback(true)));
  expect(screen.getByRole("status")).toHaveTextContent("Connected to audio server.");
});

test("hosting enrollment prepares identity but only a fresh Join connects", async () => {
  const requests: RequestInit[] = [];
  spyOn(globalThis, "fetch").mockImplementation((async (_url, init) => {
    requests.push(init ?? {});
    return Response.json(init?.method === "POST" ? { url: "ws://core.local/sendspin", serverId: "server", psk: "private", name: "Couch" } : { available: true, url: "ws://core.local/sendspin", serverId: "server", name: "Couch" });
  }) as typeof fetch);
  render(<Probe />);
  expect(renderer.connectFromGesture).not.toHaveBeenCalled();
  await act(async () => client.prepare("couch", "", "Kitchen"));
  expect(JSON.parse(requests[1]!.body as string)).toEqual({ clientId: "sdk-client", rendererTargetId: "direct-target" });
  expect(renderer.setEnrollment).toHaveBeenCalledTimes(1);
  expect(client.clientId).toBe("sdk-client");
  expect(client.phase).toBe("ready");
  expect(renderer.connectFromGesture).not.toHaveBeenCalled();
  await act(async () => client.join());
  expect(renderer.connectFromGesture).toHaveBeenCalledTimes(1);
  expect(client.phase).toBe("joined");
  await act(async () => callbacks.state(playback(true)));
  expect(client.connected).toBe(true);
  expect(afterJoin).toHaveBeenCalledWith("sdk-client");
  expect(client.sharedReady).toBe(true);
  await act(async () => { callbacks.state(playback(false)); callbacks.state(playback(true)); });
  expect(afterJoin).toHaveBeenCalledTimes(1);
});

test("shared-audio setup failure is shown without repeating membership changes on reconnect", async () => {
  spyOn(globalThis, "fetch").mockImplementation((async (_url, init) => Response.json(init?.method === "POST"
    ? { url: "ws://core.local/sendspin", serverId: "server", psk: "private", name: "Couch" }
    : { available: true, url: "ws://core.local/sendspin", serverId: "server", name: "Couch" })) as typeof fetch);
  afterJoin.mockRejectedValue(new Error("Unreachable Core"));
  render(<DialogProbe />);
  await act(async () => client.prepare("couch", "", "Kitchen"));
  await act(async () => client.join());
  await act(async () => callbacks.state(playback(true)));
  expect(screen.getByRole("alert")).toHaveTextContent("Couldn't add this device to shared audio.");
  await act(async () => { callbacks.state(playback(false)); callbacks.state(playback(true)); });
  expect(afterJoin).toHaveBeenCalledTimes(1);
});

test("hosted Join uses the playback intent from its click even if the view changes before connection", async () => {
  spyOn(globalThis, "fetch").mockImplementation((async (_url, init) => Response.json(init?.method === "POST"
    ? { url: "ws://core.local/sendspin", serverId: "server", psk: "private", name: "Couch" }
    : { available: true, url: "ws://core.local/sendspin", serverId: "server", name: "Couch" })) as typeof fetch);
  const newView = mock(async (_id: string) => {});
  const view = render(<Probe />);
  await act(async () => client.prepare("couch", "", "Kitchen"));
  await act(async () => client.join());
  await act(async () => view.rerender(<Probe onJoin={newView} />));
  await act(async () => callbacks.state(playback(true)));
  expect(afterJoin).toHaveBeenCalledWith("sdk-client");
  expect(newView).not.toHaveBeenCalled();
});

test("Sendspin uses and updates this browser's saved device volume", async () => {
  localStorage.setItem("couch.browser-volume", "0.37");
  render(<Probe />);
  await act(async () => client.prepare("external", "wss://music.local/sendspin", "Kitchen"));
  await act(async () => client.join());
  expect(renderer.setVolume).toHaveBeenCalledWith(37);
  await act(async () => callbacks.state({ ...playback(true), volume: 64 }));
  expect(localStorage.getItem("couch.browser-volume")).toBe("0.64");
});

test("a fresh hosted Listen together action enables hosting and waits for readiness", async () => {
  const requests: string[] = [];
  let checks = 0;
  spyOn(globalThis, "fetch").mockImplementation((async (input, init) => {
    const path = new URL(String(input)).pathname;
    requests.push(`${init?.method ?? "GET"} ${path}`);
    if (path === "/api/settings/sendspin") return Response.json({ enabled: true });
    if (init?.method === "POST") return Response.json({ url: "ws://core.local/sendspin", serverId: "server", psk: "private", name: "Couch" });
    return Response.json(++checks < 2 ? { available: false } : { available: true, url: "ws://core.local/sendspin", serverId: "server", name: "Couch" });
  }) as typeof fetch);
  render(<Probe />);
  await act(async () => client.prepare("couch", "", "Kitchen"));
  expect(requests).toEqual(["GET /api/sendspin/enrollment", "POST /api/settings/sendspin", "GET /api/sendspin/enrollment", "POST /api/sendspin/enrollment"]);
  expect(client.phase).toBe("ready");
  expect(renderer.connectFromGesture).not.toHaveBeenCalled();
});

test("hosted Leave removes group membership before disconnecting", async () => {
  const events: string[] = [];
  spyOn(globalThis, "fetch").mockImplementation((async (_url, init) => Response.json(init?.method === "POST"
    ? { url: "ws://core.local/sendspin", serverId: "server", psk: "private", name: "Couch" }
    : { available: true, url: "ws://core.local/sendspin", serverId: "server", name: "Couch" })) as typeof fetch);
  beforeLeave.mockImplementation(async () => { events.push("remove member"); });
  renderer.disconnect.mockImplementation(async () => { events.push("disconnect"); });
  render(<Probe />);
  await act(async () => client.prepare("couch", "", "Kitchen"));
  await act(async () => client.leave());
  expect(events).toEqual(["remove member", "disconnect"]);
  expect(client.clientId).toBeNull();
});

test("failed hosted membership removal keeps the connection available for retry", async () => {
  spyOn(globalThis, "fetch").mockImplementation((async (_url, init) => Response.json(init?.method === "POST"
    ? { url: "ws://core.local/sendspin", serverId: "server", psk: "private", name: "Couch" }
    : { available: true, url: "ws://core.local/sendspin", serverId: "server", name: "Couch" })) as typeof fetch);
  beforeLeave.mockRejectedValueOnce(new Error("Core unavailable"));
  render(<Probe />);
  await act(async () => client.prepare("couch", "", "Kitchen"));
  await act(async () => client.leave());
  expect(client.phase).toBe("ready");
  expect(renderer.disconnect).not.toHaveBeenCalled();
  await act(async () => client.leave());
  expect(renderer.disconnect).toHaveBeenCalledTimes(1);
});

test("leaving waits for disconnect and fences old SDK callbacks", async () => {
  render(<Probe />);
  await act(async () => client.prepare("external", "wss://music.local/sendspin", "Kitchen"));
  let finish!: () => void;
  renderer.disconnect.mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
  let leaving!: Promise<void>;
  await act(async () => { leaving = client.leave(); });
  expect(beforeLeave).not.toHaveBeenCalled();
  await act(async () => { callbacks.pairingPin?.("123456"); });
  expect(client.pin).toBeNull();
  await act(async () => { finish(); await leaving; });
  expect(beforeLeave).not.toHaveBeenCalled();
  expect(client.phase).toBe("idle");
});

test("changing Core cancels preparation without enrolling or connecting", async () => {
  let finish!: () => void;
  renderer.preload.mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
  const view = render(<Probe />);
  let preparing!: Promise<void>;
  await act(async () => { preparing = client.prepare("external", "wss://music.local", "Kitchen"); });
  connection = { origin: "http://other.local", token: "other" };
  await act(async () => view.rerender(<Probe />));
  await act(async () => { finish(); await preparing; });
  expect(renderer.disconnect).toHaveBeenCalledTimes(1);
  expect(renderer.connectFromGesture).not.toHaveBeenCalled();
});

test("SDK preparation errors do not expose server secrets", async () => {
  renderer.preload.mockRejectedValue(new Error("wss://private-server/?token=secret"));
  render(<Probe />);
  await act(async () => client.prepare("external", "wss://music.local", "Kitchen"));
  expect(client.error).toBe("Couldn't prepare Sendspin. Check the server address and try again.");
  expect(client.phase).toBe("idle");
});

test("unrelated parent renders preserve the Sendspin context value", async () => {
  const view = render(<Probe />);
  const idle = client;
  await act(async () => view.rerender(<Probe />));
  expect(client).toBe(idle);
  await act(async () => client.prepare("external", "wss://music.local", "Kitchen"));
  const ready = client;
  expect(ready).not.toBe(idle);
  await act(async () => view.rerender(<Probe />));
  expect(client).toBe(ready);
});
