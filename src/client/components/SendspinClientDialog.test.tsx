import { setupUiTests, act, render, screen, userEvent } from "@/testing/react";
import { beforeEach, expect, mock, spyOn, test } from "bun:test";
import * as adapter from "@/session/sendspin-renderer";
import { ShellProviders } from "@/sections/shell/test-providers";
import { SendspinClientDialog, useSendspinClient } from "./SendspinClientDialog";

setupUiTests();
let connection = { origin: "http://core.local", token: "paired" };
let client: ReturnType<typeof useSendspinClient>;
let callbacks: Parameters<typeof adapter.createSendspinRenderer>[1];
const active = mock((_value: boolean) => {});
const renderer = {
  clientId: "sdk-client", preload: mock(async () => {}), setEnrollment: mock(() => {}),
  connectFromGesture: mock(async () => {}), disconnect: mock(async () => {}),
  setVolume: mock(() => {}), setMuted: mock(() => {}), transport: mock(() => true), openPairingWindow: mock(() => {}),
};
function Probe() {
  client = useSendspinClient({ credentials: connection, allowed: true, canActivate: () => true, setActive: active });
  return null;
}
function DialogProbe() {
  client = useSendspinClient({ credentials: connection, allowed: true, canActivate: () => true, setActive: active });
  return <ShellProviders value={{ sendspin: client, connected: true, state: null, rendererTargetId: null, nativeHost: false }}>
    <SendspinClientDialog open onOpenChange={() => {}} />
  </ShellProviders>;
}
const playback = (connected: boolean): adapter.SendspinRendererState => ({ connected, isPlaying: false, volume: 100, muted: false, metadata: undefined, group: {}, supportedCommands: [] });
beforeEach(() => {
  connection = { origin: "http://core.local", token: "paired" };
  active.mockClear();
  for (const method of Object.values(renderer)) if (typeof method === "function") method.mockClear();
  renderer.preload.mockImplementation(async () => {});
  renderer.connectFromGesture.mockImplementation(async () => {});
  renderer.disconnect.mockImplementation(async () => {});
  spyOn(adapter, "createSendspinRenderer").mockImplementation((_config, events) => { callbacks = events; return renderer; });
});

test("connection status follows SDK observations after connect resolves and across reconnects", async () => {
  const user = userEvent.setup();
  render(<DialogProbe />);
  await act(async () => client.prepare("external", "wss://music.local/sendspin", "Kitchen"));
  await user.click(screen.getByRole("button", { name: "Join" }));
  expect(renderer.connectFromGesture).toHaveBeenCalledTimes(1);
  await act(async () => callbacks.state(playback(false)));
  expect(screen.getByRole("status")).toHaveTextContent("Waiting for Sendspin connection or pairing…");
  expect(screen.getByRole("button", { name: "Open pairing window" })).toBeEnabled();
  await user.click(screen.getByRole("button", { name: "Open pairing window" }));
  expect(renderer.openPairingWindow).toHaveBeenCalledTimes(1);
  await act(async () => callbacks.state(playback(true)));
  expect(screen.getByRole("status")).toHaveTextContent("Connected to Sendspin.");
  await act(async () => callbacks.state(playback(false)));
  expect(screen.getByRole("status")).toHaveTextContent("Disconnected. Waiting to reconnect…");
  await act(async () => callbacks.state(playback(true)));
  expect(screen.getByRole("status")).toHaveTextContent("Connected to Sendspin.");
  await user.click(screen.getByRole("button", { name: "Leave Sendspin" }));
  expect(client.phase).toBe("idle");
  await act(async () => client.prepare("external", "wss://music.local/sendspin", "Kitchen"));
  await user.click(screen.getByRole("button", { name: "Join" }));
  await act(async () => callbacks.state(playback(false)));
  expect(screen.getByRole("status")).toHaveTextContent("Waiting for Sendspin connection or pairing…");
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
  await user.click(screen.getByRole("button", { name: "Leave Sendspin" }));
  await act(async () => client.prepare("external", "wss://music.local/sendspin", "Kitchen"));
  await user.click(screen.getByRole("button", { name: "Join" }));
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  await act(async () => callbacks.state(playback(true)));
  expect(screen.getByRole("status")).toHaveTextContent("Connected to Sendspin.");
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
  expect(JSON.parse(requests[1]!.body as string)).toEqual({ clientId: "sdk-client" });
  expect(renderer.setEnrollment).toHaveBeenCalledTimes(1);
  expect(active).toHaveBeenLastCalledWith(true);
  expect(client.phase).toBe("ready");
  expect(renderer.connectFromGesture).not.toHaveBeenCalled();
  await act(async () => client.join());
  expect(renderer.connectFromGesture).toHaveBeenCalledTimes(1);
  expect(client.phase).toBe("joined");
});

test("leaving waits for disconnect and fences old SDK callbacks", async () => {
  render(<Probe />);
  await act(async () => client.prepare("external", "wss://music.local/sendspin", "Kitchen"));
  let finish!: () => void;
  renderer.disconnect.mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
  let leaving!: Promise<void>;
  await act(async () => { leaving = client.leave(); });
  expect(active).toHaveBeenLastCalledWith(true);
  await act(async () => { callbacks.pairingPin?.("123456"); });
  expect(client.pin).toBeNull();
  await act(async () => { finish(); await leaving; });
  expect(active).toHaveBeenLastCalledWith(false);
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
  expect(active).not.toHaveBeenCalledWith(true);
});

test("SDK preparation errors do not expose server secrets", async () => {
  renderer.preload.mockRejectedValue(new Error("wss://private-server/?token=secret"));
  render(<Probe />);
  await act(async () => client.prepare("external", "wss://music.local", "Kitchen"));
  expect(client.error).toBe("Couldn't prepare Sendspin. Check the server address and try again.");
  expect(client.phase).toBe("idle");
  expect(active).not.toHaveBeenCalledWith(true);
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
