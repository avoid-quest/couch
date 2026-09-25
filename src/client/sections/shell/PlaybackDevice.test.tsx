import { afterEach, beforeEach, expect, spyOn, test, type Mock } from "bun:test";
import { Window } from "happy-dom";
import { act } from "react";
import type { Root } from "react-dom/client";
import * as core from "@tauri-apps/api/core";
import { onlineManager } from "@tanstack/react-query";
import { screen, fireEvent, within } from "@/testing";
import { isNativeHost } from "@/session/native-context";
import { buildInfo } from "../../../shared/build";

let root: Root, window: Window, invoke: Mock<typeof core.invoke>, request: ReturnType<typeof spyOn>;
let client: import("@tanstack/react-query").QueryClient | null = null;
let choice = { mode: null as "local" | "remote" | null, address: null as string | null, targets: [] as string[], localSetupComplete: false };
let interruption: string | null = null;
let connectionError: string | null = null;
const originals = new Map<string, PropertyDescriptor | undefined>();
const button = (label: string) => screen.getByRole("button", { name: label, exact: true }) as HTMLButtonElement;
const flush = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });

beforeEach(async () => {
  window = new Window({ url: "http://tauri.localhost" });
  Object.assign(window, { __COUCH_NATIVE_HOST__: true });
  for (const key of ["CSS", "window", "document", "navigator", "location", "history", "localStorage", "sessionStorage", "HTMLElement", "HTMLInputElement", "HTMLButtonElement", "HTMLFormElement", "Element", "Node", "NodeFilter", "DocumentFragment", "MutationObserver", "ResizeObserver", "CustomEvent", "Event", "MouseEvent", "PointerEvent", "KeyboardEvent", "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame", "IS_REACT_ACT_ENVIRONMENT"]) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    const value = key === "IS_REACT_ACT_ENVIRONMENT" ? true : key === "window" ? window : Reflect.get(window, key);
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: typeof value === "function" && /^[a-z]/.test(key) ? value.bind(window) : value });
  }
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
  const { createRoot } = await import("react-dom/client");
  root = createRoot(document.body.appendChild(document.createElement("div")));
});
afterEach(async () => {
  buildInfo.clientOnly = false;
  Reflect.deleteProperty(globalThis, "COUCH_DEV_ORIGIN");
  await act(async () => { root.unmount(); await new Promise(resolve => setTimeout(resolve, 0)); });
  invoke.mockRestore(); request.mockRestore(); onlineManager.setOnline(true); await window.happyDOM.abort();
  for (const [key, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  originals.clear();
});
async function render(sharing = false) {
  const { NativeModeGate, PlaybackDevice, InstallationUpdates, LocalSharingPrompt, usePlaybackDevice } = await import("./PlaybackDevice");
  const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
  function Controls() {
    const device = usePlaybackDevice();
    return <><p>Local installation</p><PlaybackDevice />{device?.mode === "remote" && <InstallationUpdates />}{sharing && <LocalSharingPrompt credentials={{ origin: "http://127.0.0.1:4100", token: "local-secret" }} />}</>;
  }
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => root.render(<NativeModeGate><QueryClientProvider client={client!}><Controls /></QueryClientProvider></NativeModeGate>));
  await flush();
}

test("first launch chooses a device before requesting local startup", async () => {
  await render();
  expect(screen.getByRole("heading", { name: "Where do you want to play?" })).toBeDefined();
  expect(invoke.mock.calls.map(([name]) => name)).toEqual(["playback_device"]);
  expect(screen.queryByText("Local installation")).toBeNull();
  await act(async () => fireEvent.click(button("This computer"))); await flush();
  expect(invoke.mock.calls.some(([name, args]) => name === "select_playback_device" && (args as any).mode === "local")).toBe(true);
  expect(screen.getByText("Local installation")).toBeDefined();
});

test("Client-only Windows offers remote playback and keeps offline recovery remote", async () => {
  buildInfo.clientOnly = true;
  await render();
  expect(screen.getByRole("heading", { name: "Connect to another Couch" })).toBeDefined();
  expect(screen.getByText(/Local playback is unavailable/)).toBeDefined();
  expect(screen.queryByRole("button", { name: "This computer" })).toBeNull();
  await act(async () => fireEvent.change(screen.getByRole("textbox", { name: "Couch address" }), { target: { value: "192.168.1.10:4100" } }));
  await act(async () => fireEvent.click(button("Connect"))); await flush();
  expect(choice.mode).toBe("remote");
  connectionError = "Cannot reach that Couch.";
  await act(async () => root.unmount());
  const { createRoot } = await import("react-dom/client");
  root = createRoot(document.body.appendChild(document.createElement("div")));
  await render();
  expect(button("Retry")).toBeDefined();
  expect(screen.queryByRole("button", { name: "Use this computer" })).toBeNull();
  await act(async () => fireEvent.click(button("Playing on 192.168.1.10:4100"))); await flush();
  expect(screen.queryByRole("button", { name: "This computer" })).toBeNull();
  expect(invoke.mock.calls.some(([name, args]) => name === "select_playback_device" && (args as any).mode === "local")).toBe(false);
});

test("an external Tauri page uses browser UI without accessing local commands", async () => {
  Object.assign(window, { __COUCH_NATIVE_HOST__: undefined, isTauri: true });
  expect(isNativeHost()).toBe(false);
  await render();
  expect(screen.getByText("Local installation")).toBeDefined();
  expect(invoke).not.toHaveBeenCalled();
  expect(screen.queryByRole("button", { name: /^Playing (here|on)/ })).toBeNull();
});

test("a native marker on an external origin never grants local presentation", () => {
  window.happyDOM.setURL("http://192.168.1.10:4100");
  expect(isNativeHost()).toBe(false);
});

test("the configured dev origin opens the native chooser only with the native marker", async () => {
  Object.assign(globalThis, { COUCH_DEV_ORIGIN: "http://localhost:1420" });
  window.happyDOM.setURL("http://localhost:1420");
  await render();
  expect(screen.getByRole("heading", { name: "Where do you want to play?" })).toBeDefined();
  expect(invoke.mock.calls.map(([name]) => name)).toEqual(["playback_device"]);
  Object.assign(window, { __COUCH_NATIVE_HOST__: undefined });
  expect(isNativeHost()).toBe(false);
});

test("development presentation rejects other origins and is absent from production", () => {
  Object.assign(globalThis, { COUCH_DEV_ORIGIN: "http://localhost:1420" });
  for (const url of ["http://localhost:1421", "https://localhost:1420", "http://localhost.evil:1420", "http://192.168.1.10:4100"]) {
    window.happyDOM.setURL(url);
    expect(isNativeHost()).toBe(false);
  }
  Object.assign(globalThis, { COUCH_DEV_ORIGIN: null });
  window.happyDOM.setURL("http://localhost:1420");
  expect(isNativeHost()).toBe(false);
});

test("an unavailable remembered target retains recovery and only switches after explicit choice", async () => {
  choice = { mode: "remote", address: "http://192.168.1.10:4100", targets: ["http://192.168.1.10:4100"], localSetupComplete: true };
  connectionError = "Cannot reach that Couch.";
  await render();
  expect(screen.getByText("Cannot reach that Couch.")).toBeDefined();
  expect(button("Retry")).toBeDefined();
  expect(button("Use this computer")).toBeDefined();
  expect(invoke.mock.calls.some(([name]) => name === "select_playback_device")).toBe(false);
  await act(async () => fireEvent.click(button("Retry"))); await flush();
  expect(choice.mode).toBe("remote");
  connectionError = null;
  await act(async () => fireEvent.click(button("Use this computer"))); await flush();
  expect(choice.mode).toBe("local");
  expect(screen.getByText("Local installation")).toBeDefined();
});

test("a selected remote stays in the bundled app shell with one playback device control", async () => {
  choice = { mode: "remote", address: "http://192.168.1.10:4100", targets: ["http://192.168.1.10:4100"], localSetupComplete: true };
  connectionError = "Cannot reach that Couch.";
  await render();
  expect(screen.getByText("Local installation")).toBeDefined();
  expect(screen.getAllByRole("button", { name: `Playing on ${choice.address}` })).toHaveLength(1);
  expect(screen.queryByRole("banner", { name: "App playback device controls" })).toBeNull();
});

test("sharing-only interruption needs a deliberate confirmation and preserves the selected address", async () => {
  choice = { mode: "local", address: "http://192.168.1.10:4100", targets: ["http://192.168.1.10:4100"], localSetupComplete: true };
  interruption = "sharing";
  await render();
  await act(async () => fireEvent.click(button("Playing here"))); await flush();
  await act(async () => fireEvent.click(screen.getByRole("radio", { name: "http://192.168.1.10:4100" }))); await flush();
  expect(screen.getByText(/turns off this computer's remote control/)).toBeDefined();
  expect(screen.getByRole("dialog").hasAttribute("data-tv-local-only")).toBe(true);
  expect(screen.queryByText(/stops playback on this computer/)).toBeNull();
  expect(choice.mode).toBe("local");
  await act(async () => fireEvent.click(button("Stop and switch"))); await flush();
  expect(choice.mode).toBe("remote");
  expect(choice.address).toBe("http://192.168.1.10:4100");
  expect(invoke.mock.calls.some(([name, args]) => name === "select_playback_device" && (args as any).confirmInterrupt)).toBe(true);
});

test("local first use records private choice after the host saves it", async () => {
  choice.mode = "local";
  await render(true);
  expect(within(screen.getByRole("dialog")).getByText("Allow remote control?")).toBeDefined();
  await act(async () => fireEvent.click(button("Keep private"))); await flush();
  expect(request.mock.calls[0]?.[0]).toBe("http://127.0.0.1:4100/api/settings/sharing");
  expect(JSON.parse(String(request.mock.calls[0]?.[1]?.body))).toEqual({ enabled: false });
  expect(choice.localSetupComplete).toBe(true);
  expect(screen.queryByRole("dialog")).toBeNull();
});

test("failed local sharing save leaves the prompt available and does not mark setup complete", async () => {
  choice.mode = "local";
  request.mockResolvedValue(Response.json({ error: "Could not save sharing." }, { status: 500 }));
  await render(true);
  await act(async () => fireEvent.click(button("Keep private"))); await flush();
  expect(within(screen.getByRole("dialog")).getByText("Could not save sharing.")).toBeDefined();
  expect(choice.localSetupComplete).toBe(false);
  expect(invoke.mock.calls.some(([name]) => name === "complete_local_setup")).toBe(false);
});

test("closing the device chooser reconnects the same remote and restores trigger focus", async () => {
  choice = { mode: "remote", address: "http://192.168.1.10:4100", targets: ["http://192.168.1.10:4100"], localSetupComplete: true };
  await render();
  const initial = invoke.mock.calls.filter(([name]) => name === "retry_playback_device").length;
  await act(async () => fireEvent.click(button(`Playing on ${choice.address}`))); await flush();
  expect(invoke.mock.calls.filter(([name]) => name === "retry_playback_device")).toHaveLength(initial);
  await act(async () => fireEvent.click(button(`Playing on ${choice.address}`))); await flush();
  expect(invoke.mock.calls.filter(([name]) => name === "retry_playback_device")).toHaveLength(initial + 1);
  expect(choice.mode).toBe("remote");
  expect(document.activeElement).toBe(button(`Playing on ${choice.address}`));
});

test("a route change closes Play on and resumes the selected remote connection", async () => {
  choice = { mode: "remote", address: "http://192.168.1.10:4100", targets: ["http://192.168.1.10:4100"], localSetupComplete: true };
  const { NativeModeGate, PlaybackDevice } = await import("./PlaybackDevice");
  const screenFor = (path: string) => <NativeModeGate><PlaybackDevice key={path} /></NativeModeGate>;
  await act(async () => root.render(screenFor("/find"))); await flush();
  const attempts = () => invoke.mock.calls.filter(([name]) => name === "retry_playback_device").length;
  const initial = attempts();
  await act(async () => fireEvent.click(button(`Playing on ${choice.address}`))); await flush();
  expect(attempts()).toBe(initial);
  await act(async () => root.render(screenFor("/now"))); await flush();
  expect(attempts()).toBe(initial + 1);
});

test("the native Play on control and its portal stay local to this computer", async () => {
  choice.mode = "local";
  await render();
  const trigger = button("Playing here");
  expect(trigger.hasAttribute("data-tv-local-only")).toBe(true);
  await act(async () => fireEvent.click(trigger)); await flush();
  expect(document.querySelector('[data-slot="popover-content"]')?.hasAttribute("data-tv-local-only")).toBe(true);
});

test("Play on marks the current computer and switches directly to a remembered Couch", async () => {
  choice = { mode: "local", address: "http://192.168.1.10:4100", targets: ["http://192.168.1.10:4100", "http://192.168.1.20:4100"], localSetupComplete: true };
  await render();
  await act(async () => fireEvent.click(button("Playing here"))); await flush();
  expect(screen.getByRole("radio", { name: "This computer" }).getAttribute("aria-checked")).toBe("true");
  expect(screen.getByRole("radio", { name: "http://192.168.1.20:4100" }).getAttribute("aria-checked")).toBe("false");
  await act(async () => fireEvent.click(screen.getByRole("radio", { name: "http://192.168.1.20:4100" }))); await flush();
  expect(choice.address).toBe("http://192.168.1.20:4100");
  expect(screen.queryByRole("button", { name: "Stop and switch" })).toBeNull();
  expect(button("Playing on http://192.168.1.20:4100")).toBeDefined();
});

test("Another Couch address is entered inline in Play on", async () => {
  choice.mode = "local"; choice.localSetupComplete = true;
  await render();
  await act(async () => fireEvent.click(button("Playing here"))); await flush();
  const address = screen.getByRole("textbox", { name: "Another Couch address" }) as HTMLInputElement;
  await act(async () => fireEvent.change(address, { target: { value: "192.168.1.20:4100" } }));
  await act(async () => fireEvent.click(button("Connect"))); await flush();
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
  await act(async () => fireEvent.pointerDown(screen.getByText("Local installation"))); await flush();
  expect(invoke.mock.calls.some(([name]) => name === "local_update_activity")).toBe(false);
  const activity = new Event("pointerdown", { bubbles: true });
  Object.defineProperty(activity, "isTrusted", { value: true });
  await act(async () => fireEvent(screen.getByText("Local installation"), activity)); await flush();
  expect(invoke.mock.calls.some(([name]) => name === "local_update_activity")).toBe(true);
  expect(request.mock.calls.some(([input]: [unknown]) => String(input).endsWith("/api/activity"))).toBe(false);
  await act(async () => fireEvent.click(button("Update this app")));
  await flush();
  expect(screen.getByRole("dialog", { name: "Updates for this computer" })).toBeDefined();
  expect(screen.getByText(/This computer updates itself. The selected playback computer has separate updates/)).toBeDefined();
  expect(screen.getByText(/Updates and recovery for this app/)).toBeDefined();
  expect(screen.getByText("Hosted update")).toBeDefined();
  expect(button("Install update on this app").disabled).toBe(false);
  expect(screen.getByLabelText("Release channel for this app")).toBeDefined();
  expect(screen.getByLabelText("Install updates on this app")).toBeDefined();
  await act(async () => fireEvent.click(screen.getByLabelText("Release channel for this app"))); await flush();
  await act(async () => fireEvent.click(screen.getByRole("option", { name: "Stable" }))); await flush();
  expect(request.mock.calls.some(([input, init]: [unknown, RequestInit?]) => String(input).endsWith("/api/updates/channel") && JSON.parse(String(init?.body)).channel === "stable")).toBe(true);
  await act(async () => fireEvent.click(screen.getByLabelText("Install updates on this app"))); await flush();
  await act(async () => fireEvent.click(screen.getByRole("option", { name: "Auto when idle" }))); await flush();
  expect(request.mock.calls.some(([input, init]: [unknown, RequestInit?]) => String(input).endsWith("/api/updates/policy") && JSON.parse(String(init?.body)).policy === "idle")).toBe(true);
  expect(screen.queryByRole("heading", { name: "Tools" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Repair current release on this app" })).toBeNull();
  expect(request.mock.calls.some(([input]: [unknown]) => String(input).includes("/api/tools"))).toBe(false);
  expect(invoke.mock.calls.some(([name]) => name === "select_playback_device")).toBe(false);
  expect(choice.mode).toBe("remote");
  await act(async () => root.unmount());
  const { createRoot } = await import("react-dom/client");
  root = createRoot(document.body.appendChild(document.createElement("div")));
  await render();
  await act(async () => fireEvent.click(button("Update this app"))); await flush();
  expect(screen.getByLabelText("Release channel for this app").textContent).toContain("Stable");
  expect(screen.getByLabelText("Install updates on this app").textContent).toContain("Auto when idle");
  expect(choice.mode).toBe("remote");
});

test("this app gives recovery guidance without Linux appliance instructions", async () => {
  choice = { mode: "remote", address: "http://192.168.1.10:4100", targets: ["http://192.168.1.10:4100"], localSetupComplete: true };
  request.mockImplementation((async input => {
    if (String(input).endsWith("/api/maintenance/frontend")) return new Response(null, { status: 204 });
    return Response.json({ channel: "stable", policy: "manual", status: "unavailable", currentCheck: false, running: { version: "0.1.0", revision: "a".repeat(40) }, candidate: null, lastSuccessfulCheck: null, error: "Updates require the installed Debian AppImage.", installation: { enabled: false, repairAvailable: false, transaction: { updateId: "e".repeat(32), requestId: "f".repeat(32), candidateId: "b".repeat(64), version: "0.2.0", revision: "c".repeat(40), phase: "operator-required", error: null, createdAt: 1, updatedAt: 1 } } });
  }) as typeof fetch);
  await render();
  await act(async () => fireEvent.click(button("Update this app"))); await flush();
  expect(screen.getByRole("dialog", { name: "Updates for this computer" })).toBeDefined();
  expect(screen.getByText("Update needs recovery")).toBeDefined();
  expect(screen.getAllByText(/Reinstall a verified compatible Couch release for this computer/)).toHaveLength(2);
  expect(screen.getByText(/In-app updates are unavailable on this installation/)).toBeDefined();
  expect(screen.queryByText(/SSH|AppImage|journal|Debian/)).toBeNull();
});
