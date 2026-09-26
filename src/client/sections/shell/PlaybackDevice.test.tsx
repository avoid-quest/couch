import { act, cleanup, createTestQueryClient, fireEvent, render as renderReact, renderWithQueryClient, screen, setupUiTests, testWindow, userEvent, waitFor } from "@/testing/react";
import { afterEach, beforeEach, expect, spyOn, test, type Mock } from "bun:test";
import * as core from "@tauri-apps/api/core";
import { onlineManager } from "@tanstack/react-query";
import { isNativeHost } from "@/session/native-context";
import { applyTvNavigation } from "@/navigation";
import { buildInfo } from "../../../shared/build";

setupUiTests();
let invoke: Mock<typeof core.invoke>, request: ReturnType<typeof spyOn>;
let choice = { mode: null as "local" | "remote" | null, address: null as string | null, targets: [] as string[], localSetupComplete: false };
let interruption: string | null = null;
let connectionError: string | null = null;
const button = (label: string) => screen.getByRole("button", { name: label });

let user: ReturnType<typeof userEvent.setup>;

beforeEach(() => {
  user = userEvent.setup();
  testWindow.happyDOM.setURL("http://tauri.localhost");
  Object.assign(window, { __COUCH_NATIVE_HOST__: true });
  choice = { mode: null, address: null, targets: [] as string[], localSetupComplete: false }; interruption = null; connectionError = null;
  invoke = spyOn(core, "invoke").mockImplementation(async <T,>(command: string, args?: core.InvokeArgs): Promise<T> => {
    const options = args as { mode: "local" | "remote"; address?: string; confirmInterrupt?: boolean };
    if (command === "select_playback_device") {
      if (options.mode === "remote" && interruption && !options.confirmInterrupt) throw `confirmation-required:${interruption}`;
      choice = { ...choice, mode: options.mode, address: options.address ?? choice.address, targets: [...new Set([...choice.targets, ...(options.address ? [options.address] : [])])] };
    }
    if (command === "connection_info") return { origin: "http://127.0.0.1:54321", token: "own-installation" } as T;
    if (command === "complete_local_setup") choice = { ...choice, targets: ["http://192.168.1.10:4100"], localSetupComplete: true };
    if (command === "retry_playback_device" && connectionError) throw connectionError;
    return { ...choice } as T;
  });
  request = spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ enabled: false }));
});
afterEach(() => {
  buildInfo.clientOnly = false;
  Reflect.deleteProperty(globalThis, "COUCH_DEV_ORIGIN");
  onlineManager.setOnline(true);
  Reflect.deleteProperty(window, "isTauri");
});
async function render(sharing = false) {
  const { NativeModeGate, PlaybackDevice, DeviceRecovery, LocalSharingPrompt, usePlaybackDevice } = await import("./PlaybackDevice");
  function Controls() {
    const device = usePlaybackDevice();
    return <><p>Local installation</p><PlaybackDevice updates={device?.mode === "remote"} /><DeviceRecovery />{sharing && <LocalSharingPrompt credentials={{ origin: "http://127.0.0.1:4100", token: "local-secret" }} />}</>;
  }
  await act(async () => { renderWithQueryClient(<NativeModeGate><Controls /></NativeModeGate>); });
}

async function openUpdates() {
  await user.click(button("Playing on 192.168.1.10:4100"));
  await user.click(button("Update this app"));
}

test("first launch chooses a device before requesting local startup", async () => {
  await render();
  expect(screen.getByRole("heading", { name: "Where do you want to play?" })).toBeInTheDocument();
  expect(invoke.mock.calls.map(([name]) => name)).toEqual(["playback_device"]);
  expect(screen.queryByText("Local installation")).toBeNull();
  await user.click(button("This computer"));
  expect(invoke).toHaveBeenCalledWith("select_playback_device", { mode: "local", address: null, confirmInterrupt: false });
  expect(screen.getByText("Local installation")).toBeInTheDocument();
});

test("Client-only Windows offers remote playback and keeps offline recovery remote", async () => {
  buildInfo.clientOnly = true;
  await render();
  expect(screen.getByRole("heading", { name: "Connect to a Couch" })).toBeInTheDocument();
  expect(screen.getByText(/controls a Couch on your network/)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "This computer" })).toBeNull();
  await user.type(screen.getByRole("textbox", { name: "Couch address" }), "192.168.1.10:4100");
  await user.click(button("Connect"));
  expect(choice.mode).toBe("remote");
  connectionError = "Cannot reach that Couch.";
  cleanup();
  await render();
  expect(button("Try again")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Use this computer" })).toBeNull();
  await user.click(button("Playing on 192.168.1.10:4100"));
  expect(screen.queryByRole("button", { name: "This computer" })).toBeNull();
  expect(invoke.mock.calls.some(([name, args]) => name === "select_playback_device" && (args as any).mode === "local")).toBe(false);
});

test("an external Tauri page uses browser UI without accessing local commands", async () => {
  Object.assign(window, { __COUCH_NATIVE_HOST__: undefined, isTauri: true });
  expect(isNativeHost()).toBe(false);
  await render();
  expect(screen.getByText("Local installation")).toBeInTheDocument();
  expect(invoke).not.toHaveBeenCalled();
  expect(screen.queryByRole("button", { name: /^Playing (here|on)/ })).toBeNull();
});

test("a native marker on an external origin never grants local presentation", () => {
  testWindow.happyDOM.setURL("http://192.168.1.10:4100");
  expect(isNativeHost()).toBe(false);
});

test("the configured dev origin opens the native chooser only with the native marker", async () => {
  Object.assign(globalThis, { COUCH_DEV_ORIGIN: "http://localhost:1420" });
  testWindow.happyDOM.setURL("http://localhost:1420");
  await render();
  expect(screen.getByRole("heading", { name: "Where do you want to play?" })).toBeInTheDocument();
  expect(invoke.mock.calls.map(([name]) => name)).toEqual(["playback_device"]);
  Object.assign(window, { __COUCH_NATIVE_HOST__: undefined });
  expect(isNativeHost()).toBe(false);
});

test("development presentation rejects other origins and is absent from production", () => {
  Object.assign(globalThis, { COUCH_DEV_ORIGIN: "http://localhost:1420" });
  for (const url of ["http://localhost:1421", "https://localhost:1420", "http://localhost.evil:1420", "http://192.168.1.10:4100"]) {
    testWindow.happyDOM.setURL(url);
    expect(isNativeHost()).toBe(false);
  }
  Object.assign(globalThis, { COUCH_DEV_ORIGIN: null });
  testWindow.happyDOM.setURL("http://localhost:1420");
  expect(isNativeHost()).toBe(false);
});

test("an unavailable remembered target retains recovery and only switches after explicit choice", async () => {
  choice = { mode: "remote", address: "http://192.168.1.10:4100", targets: ["http://192.168.1.10:4100"], localSetupComplete: true };
  connectionError = "Cannot reach that Couch.";
  await render();
  expect(screen.getByText("Cannot reach that Couch.")).toBeInTheDocument();
  expect(button("Try again")).toBeInTheDocument();
  expect(button("Use this computer")).toBeInTheDocument();
  expect(invoke.mock.calls.some(([name]) => name === "select_playback_device")).toBe(false);
  await user.click(button("Try again"));
  expect(choice.mode).toBe("remote");
  connectionError = null;
  await user.click(button("Use this computer"));
  expect(choice.mode).toBe("local");
  expect(screen.getByText("Local installation")).toBeInTheDocument();
});

test("a selected remote stays in the bundled app shell with one playback device control", async () => {
  choice = { mode: "remote", address: "http://192.168.1.10:4100", targets: ["http://192.168.1.10:4100"], localSetupComplete: true };
  connectionError = "Cannot reach that Couch.";
  await render();
  expect(screen.getByText("Local installation")).toBeInTheDocument();
  expect(screen.getAllByRole("button", { name: "Playing on 192.168.1.10:4100" })).toHaveLength(1);
});

test("TV remote input cannot open or select a playback device, but local clicks can", async () => {
  choice = { mode: "local", address: "http://192.168.1.10:4100", targets: ["http://192.168.1.10:4100"], localSetupComplete: true };
  // Happy DOM has no layout; navigation needs rendered controls to receive input.
  spyOn(HTMLElement.prototype, "getClientRects").mockReturnValue([new DOMRect(0, 0, 100, 30)] as unknown as DOMRectList);
  await render();
  const trigger = button("Playing here");
  await act(async () => { trigger.focus(); applyTvNavigation("select"); });
  expect(screen.queryByRole("radiogroup", { name: "Play on" })).not.toBeInTheDocument();
  await user.click(trigger);
  const remote = screen.getByRole("radio", { name: "http://192.168.1.10:4100" });
  await act(async () => { remote.focus(); applyTvNavigation("select"); });
  expect(invoke.mock.calls.some(([name]) => name === "select_playback_device")).toBe(false);
  await user.click(remote);
  expect(choice.mode).toBe("remote");
});

test("sharing-only interruption needs a deliberate confirmation and preserves the selected address", async () => {
  spyOn(HTMLElement.prototype, "getClientRects").mockReturnValue([new DOMRect(0, 0, 100, 30)] as unknown as DOMRectList);
  choice = { mode: "local", address: "http://192.168.1.10:4100", targets: ["http://192.168.1.10:4100"], localSetupComplete: true };
  interruption = "sharing";
  await render();
  await user.click(button("Playing here"));
  await user.click(screen.getByRole("radio", { name: "http://192.168.1.10:4100" }));
  expect(screen.getByText(/Remotes can't reach this computer/)).toBeInTheDocument();
  expect(screen.queryByText(/Playback here stops/)).toBeNull();
  const confirm = button("Stop and switch");
  await act(async () => { confirm.focus(); applyTvNavigation("select"); });
  expect(choice.mode).toBe("local");
  expect(invoke).not.toHaveBeenCalledWith("select_playback_device", { mode: "remote", address: "http://192.168.1.10:4100", confirmInterrupt: true });
  await user.click(confirm);
  expect(choice.mode).toBe("remote");
  expect(choice.address).toBe("http://192.168.1.10:4100");
  expect(invoke).toHaveBeenCalledWith("select_playback_device", { mode: "remote", address: "http://192.168.1.10:4100", confirmInterrupt: true });
});

test("local first use records private choice after the host saves it", async () => {
  choice.mode = "local";
  await render(true);
  expect(screen.getByRole("heading", { name: "Allow remotes?" })).toBeInTheDocument();
  await user.click(button("Not now"));
  expect(request.mock.calls[0]?.[0]).toBe("http://127.0.0.1:4100/api/settings/sharing");
  expect(JSON.parse(String(request.mock.calls[0]?.[1]?.body))).toEqual({ enabled: false });
  expect(choice.localSetupComplete).toBe(true);
  expect(screen.queryByRole("heading", { name: "Allow remotes?" })).toBeNull();
});

test("failed local sharing save leaves the prompt available and does not mark setup complete", async () => {
  choice.mode = "local";
  request.mockResolvedValue(Response.json({ error: "Could not save sharing." }, { status: 500 }));
  await render(true);
  await user.click(button("Not now"));
  expect(screen.getByText("Could not save sharing.")).toBeInTheDocument();
  expect(choice.localSetupComplete).toBe(false);
  expect(invoke.mock.calls.some(([name]) => name === "complete_local_setup")).toBe(false);
});

test("closing the device chooser reconnects the same remote and restores trigger focus", async () => {
  choice = { mode: "remote", address: "http://192.168.1.10:4100", targets: ["http://192.168.1.10:4100"], localSetupComplete: true };
  await render();
  const initial = invoke.mock.calls.filter(([name]) => name === "retry_playback_device").length;
  await user.click(button("Playing on 192.168.1.10:4100"));
  expect(invoke.mock.calls.filter(([name]) => name === "retry_playback_device")).toHaveLength(initial);
  await user.click(button("Playing on 192.168.1.10:4100"));
  expect(invoke.mock.calls.filter(([name]) => name === "retry_playback_device")).toHaveLength(initial + 1);
  expect(choice.mode).toBe("remote");
  await waitFor(() => expect(button("Playing on 192.168.1.10:4100")).toHaveFocus());
});

test("a route change closes Play on and resumes the selected remote connection", async () => {
  choice = { mode: "remote", address: "http://192.168.1.10:4100", targets: ["http://192.168.1.10:4100"], localSetupComplete: true };
  const { NativeModeGate, PlaybackDevice } = await import("./PlaybackDevice");
  const { QueryClientProvider } = await import("@tanstack/react-query");
  const client = createTestQueryClient();
  const screenFor = (path: string) => <NativeModeGate><QueryClientProvider client={client}><PlaybackDevice key={path} /></QueryClientProvider></NativeModeGate>;
  const view = renderReact(screenFor("/find"));
  await screen.findByRole("button", { name: "Playing on 192.168.1.10:4100" });
  const attempts = () => invoke.mock.calls.filter(([name]) => name === "retry_playback_device").length;
  const initial = attempts();
  await user.click(button("Playing on 192.168.1.10:4100"));
  expect(attempts()).toBe(initial);
  view.rerender(screenFor("/now"));
  await waitFor(() => expect(attempts()).toBe(initial + 1));
});

test("Play on marks the current computer and switches directly to a remembered Couch", async () => {
  choice = { mode: "local", address: "http://192.168.1.10:4100", targets: ["http://192.168.1.10:4100", "http://192.168.1.20:4100"], localSetupComplete: true };
  await render();
  await user.click(button("Playing here"));
  expect(screen.getByRole("radio", { name: "This computer" })).toBeChecked();
  expect(screen.getByRole("radio", { name: "http://192.168.1.20:4100" })).not.toBeChecked();
  await user.click(screen.getByRole("radio", { name: "http://192.168.1.20:4100" }));
  expect(choice.address).toBe("http://192.168.1.20:4100");
  expect(screen.queryByRole("button", { name: "Stop and switch" })).toBeNull();
  expect(button("Playing on 192.168.1.20:4100")).toBeInTheDocument();
});

test("Another Couch address is entered inline in Play on", async () => {
  choice.mode = "local"; choice.localSetupComplete = true;
  await render();
  await user.click(button("Playing here"));
  await user.type(screen.getByRole("textbox", { name: "Another Couch address" }), "192.168.1.20:4100");
  await user.click(button("Connect"));
  expect(choice.address).toBe("192.168.1.20:4100");
});


test("an offline remote keeps this installation's update controls and shared-window activity", async () => {
  choice = { mode: "remote", address: "http://192.168.1.10:4100", targets: ["http://192.168.1.10:4100"], localSetupComplete: true };
  connectionError = "Cannot reach that Couch.";
  onlineManager.setOnline(false);
  let channel = "preview";
  let policy = "manual";
  request.mockImplementation((async (input, init) => {
    expect(String(input)).toStartWith("http://127.0.0.1:54321/");
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer own-installation");
    if (String(input).endsWith("/api/maintenance/frontend")) return new Response(null, { status: 204 });
    if (String(input).endsWith("/api/updates/channel")) channel = JSON.parse(String(init?.body)).channel;
    if (String(input).endsWith("/api/updates/policy")) policy = JSON.parse(String(init?.body)).policy;
    return Response.json({ channel, policy, status: "ready", currentCheck: true, running: { version: "0.1.0-preview.1", revision: "a".repeat(40) }, candidate: { id: "b".repeat(64), version: "0.2.0", revision: "c".repeat(40), notes: "Hosted update", bytes: 1024, publishedAt: 1 }, installation: { enabled: true, current: { candidateId: "d".repeat(64), version: "0.1.0-preview.1", revision: "a".repeat(40) }, repairAvailable: false, transaction: null } });
  }) as typeof fetch);
  await render();
  await act(async () => fireEvent.pointerDown(screen.getByText("Local installation")));
  expect(invoke.mock.calls.some(([name]) => name === "local_update_activity")).toBe(false);
  const activity = new Event("pointerdown", { bubbles: true });
  Object.defineProperty(activity, "isTrusted", { value: true });
  await act(async () => fireEvent(screen.getByText("Local installation"), activity));
  expect(invoke.mock.calls.some(([name]) => name === "local_update_activity")).toBe(true);
  expect(request.mock.calls.some(([input]: [unknown]) => String(input).endsWith("/api/activity"))).toBe(false);
  await openUpdates();
  expect(screen.getByRole("dialog", { name: "Update this app" })).toBeInTheDocument();
  expect(screen.getByText(/Only this app/)).toBeInTheDocument();
  expect(await screen.findByText("Hosted update")).toBeInTheDocument();
  expect(button("Install")).toBeEnabled();
  expect(screen.getByLabelText("Channel")).toBeInTheDocument();
  expect(screen.getByLabelText("Install updates")).toBeInTheDocument();
  await user.click(screen.getByLabelText("Channel"));
  await user.click(screen.getByRole("option", { name: "Stable" }));
  expect(request.mock.calls.some(([input, init]: [unknown, RequestInit?]) => String(input).endsWith("/api/updates/channel") && JSON.parse(String(init?.body)).channel === "stable")).toBe(true);
  await user.click(screen.getByLabelText("Install updates"));
  await user.click(screen.getByRole("option", { name: "Auto when idle" }));
  expect(request.mock.calls.some(([input, init]: [unknown, RequestInit?]) => String(input).endsWith("/api/updates/policy") && JSON.parse(String(init?.body)).policy === "idle")).toBe(true);
  expect(screen.queryByRole("heading", { name: "Tools" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Repair" })).toBeNull();
  expect(request.mock.calls.some(([input]: [unknown]) => String(input).includes("/api/tools"))).toBe(false);
  expect(invoke.mock.calls.some(([name]) => name === "select_playback_device")).toBe(false);
  expect(choice.mode).toBe("remote");
  cleanup();
  await render();
  await openUpdates();
  await waitFor(() => expect(screen.getByLabelText("Channel")).toHaveTextContent("Stable"));
  await waitFor(() => expect(screen.getByLabelText("Install updates")).toHaveTextContent("Auto when idle"));
  expect(choice.mode).toBe("remote");
});

test("this app gives recovery guidance without Linux appliance instructions", async () => {
  choice = { mode: "remote", address: "http://192.168.1.10:4100", targets: ["http://192.168.1.10:4100"], localSetupComplete: true };
  request.mockImplementation((async input => {
    if (String(input).endsWith("/api/maintenance/frontend")) return new Response(null, { status: 204 });
    return Response.json({ channel: "stable", policy: "manual", status: "unavailable", currentCheck: false, running: { version: "0.1.0", revision: "a".repeat(40) }, candidate: null, lastSuccessfulCheck: null, error: "Updates require the installed Debian AppImage.", installation: { enabled: false, repairAvailable: false, transaction: { updateId: "e".repeat(32), requestId: "f".repeat(32), candidateId: "b".repeat(64), version: "0.2.0", revision: "c".repeat(40), phase: "operator-required", error: null, createdAt: 1, updatedAt: 1 } } });
  }) as typeof fetch);
  await render();
  await openUpdates();
  expect(screen.getByRole("dialog", { name: "Update this app" })).toBeInTheDocument();
  expect(await screen.findByText("Needs repair")).toBeInTheDocument();
  expect(screen.getAllByText(/Reinstall Couch from its installer/)).toHaveLength(1);
  expect(screen.getByText("Update with the Couch installer. Your data stays.")).toBeInTheDocument();
  expect(screen.queryByText(/SSH|AppImage|journal|Debian/)).toBeNull();
});
