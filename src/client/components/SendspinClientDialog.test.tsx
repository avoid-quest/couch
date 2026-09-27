import { setupUiTests, act, render, screen, userEvent, waitFor } from "@/testing/react";
import { beforeEach, expect, mock, spyOn, test } from "bun:test";
import * as adapter from "@/session/sendspin-renderer";
import { ShellProviders } from "@/sections/shell/test-providers";
import { SendspinClientDialog, useSendspinClient } from "./SendspinClientDialog";

setupUiTests();
let client: ReturnType<typeof useSendspinClient>;
let callbacks: Parameters<typeof adapter.createSendspinRenderer>[1];
const renderer = {
  audioClock: null,
  clientId: "sdk-client", preload: mock(async () => {}), setEnrollment: mock(() => {}),
  connect: mock(async () => {}), unlockFromGesture: mock(async () => {}),
  connectFromGesture: mock(async () => {}), disconnect: mock(async () => {}),
  setVolume: mock(() => {}), setMuted: mock(() => {}), transport: mock(() => true), openPairingWindow: mock(() => {}),
};
function Probe({ token = "paired" }: { token?: string }) {
  client = useSendspinClient({ credentials: { origin: "http://core.local", token }, allowed: true, canActivate: () => true });
  return null;
}
function DialogProbe() {
  const externalAudio = useSendspinClient({ credentials: { origin: "http://core.local", token: "paired" }, allowed: true, canActivate: () => true });
  return <ShellProviders value={{ externalAudio, credentials: { origin: "http://core.local", token: "paired" }, connected: true, identity: { controller: { id: "one", name: "Couch browser", role: "controller" } } }}><SendspinClientDialog open onOpenChange={() => {}} /></ShellProviders>;
}
const playback = (connected: boolean): adapter.SendspinRendererState => ({ connected, isPlaying: false, volume: 100, muted: false, metadata: undefined, group: {}, supportedCommands: [] });
beforeEach(() => {
  for (const method of Object.values(renderer)) if (typeof method === "function") method.mockClear();
  spyOn(adapter, "createSendspinRenderer").mockImplementation((_config, events) => { callbacks = events; return renderer; });
});

test("other audio server reuses the device name without a name prompt", async () => {
  const user = userEvent.setup();
  render(<DialogProbe />);
  expect(screen.queryByRole("textbox", { name: "Device name" })).not.toBeInTheDocument();
  await user.type(screen.getByRole("textbox", { name: "Server address" }), "wss://music.local/sendspin");
  await user.click(screen.getByRole("button", { name: "Continue" }));
  expect(adapter.createSendspinRenderer).toHaveBeenCalledWith(expect.objectContaining({ name: "Couch browser" }), expect.anything());
  await user.click(screen.getByRole("button", { name: "Connect" }));
  expect(renderer.connectFromGesture).toHaveBeenCalledTimes(1);
});

test("external client follows SDK connection and releases on Leave", async () => {
  render(<Probe />);
  await act(async () => client.prepare("wss://music.local/sendspin", "Kitchen"));
  await act(async () => client.join());
  await act(async () => callbacks.state(playback(true)));
  expect(client.state?.connected).toBe(true);
  await act(async () => callbacks.state(playback(false)));
  expect(client.everConnected).toBe(true);
  await act(async () => client.leave());
  expect(renderer.disconnect).toHaveBeenCalledTimes(1);
  expect(client.phase).toBe("idle");
});

test("credential replacement disconnects retired SDK and fences late state", async () => {
  const view = render(<Probe />);
  await act(async () => client.prepare("wss://music.local/sendspin", "Kitchen"));
  const old = callbacks;
  await act(async () => view.rerender(<Probe token="other" />));
  await waitFor(() => expect(renderer.disconnect).toHaveBeenCalledTimes(1));
  await act(async () => old.state(playback(true)));
  expect(client.state).toBeNull();
});
