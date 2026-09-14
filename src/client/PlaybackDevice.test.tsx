import { afterEach, beforeEach, expect, spyOn, test, type Mock } from "bun:test";
import { Window } from "happy-dom";
import { act } from "react";
import type { Root } from "react-dom/client";
import * as core from "@tauri-apps/api/core";
import { isNativeHost } from "./native-context";

let root: Root, window: Window, invoke: Mock<typeof core.invoke>, request: ReturnType<typeof spyOn>;
let choice = { mode: null as "local" | "remote" | null, address: null as string | null, targets: [] as string[], localSetupComplete: false };
let interruption: string | null = null;
let connectionError: string | null = null;
const originals = new Map<string, PropertyDescriptor | undefined>();
const button = (label: string) => [...document.querySelectorAll<HTMLButtonElement>("button")].find(node => node.textContent === label)!;
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
    if (command === "complete_local_setup") choice = { ...choice, targets: ["http://192.168.1.10:4100"], localSetupComplete: true };
    if (command === "retry_playback_device" && connectionError) throw connectionError;
    return { ...choice } as T;
  });
  request = spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ enabled: false }));
  const { createRoot } = await import("react-dom/client");
  root = createRoot(document.body.appendChild(document.createElement("div")));
});
afterEach(async () => {
  await act(async () => { root.unmount(); await new Promise(resolve => setTimeout(resolve, 0)); });
  invoke.mockRestore(); request.mockRestore(); await window.happyDOM.abort();
  for (const [key, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  originals.clear();
});
async function render(sharing = false) {
  const { NativeModeGate, PlaybackDevice, LocalSharingPrompt } = await import("./PlaybackDevice");
  await act(async () => root.render(<NativeModeGate><p>Local installation</p><PlaybackDevice />{sharing && <LocalSharingPrompt credentials={{ origin: "http://127.0.0.1:4100", token: "local-secret" }} />}</NativeModeGate>));
  await flush();
}

test("first launch chooses a device before requesting local startup", async () => {
  await render();
  expect(document.body.textContent).toContain("Where do you want to play?");
  expect(invoke.mock.calls.map(([name]) => name)).toEqual(["playback_device"]);
  expect(document.body.textContent).not.toContain("Local installation");
  await act(async () => button("This computer").click()); await flush();
  expect(invoke.mock.calls.some(([name, args]) => name === "select_playback_device" && (args as any).mode === "local")).toBe(true);
  expect(document.body.textContent).toContain("Local installation");
});

test("an external Tauri page uses browser UI without accessing local commands", async () => {
  Object.assign(window, { __COUCH_NATIVE_HOST__: undefined, isTauri: true });
  expect(isNativeHost()).toBe(false);
  await render();
  expect(document.body.textContent).toContain("Local installation");
  expect(invoke).not.toHaveBeenCalled();
  expect(button(`Play on: ${choice.mode === "local" ? "This computer" : choice.address}`)).toBeUndefined();
});

test("a native marker on an external origin never grants local presentation", () => {
  window.happyDOM.setURL("http://192.168.1.10:4100");
  expect(isNativeHost()).toBe(false);
});

test("an unavailable remembered target retains recovery and only switches after explicit choice", async () => {
  choice = { mode: "remote", address: "http://192.168.1.10:4100", targets: ["http://192.168.1.10:4100"], localSetupComplete: true };
  connectionError = "Cannot reach that Couch.";
  await render();
  expect(document.body.textContent).toContain("Cannot reach that Couch.");
  expect(button("Retry")).toBeDefined();
  expect(button("Use this computer")).toBeDefined();
  expect(invoke.mock.calls.some(([name]) => name === "select_playback_device")).toBe(false);
  await act(async () => button("Retry").click()); await flush();
  expect(choice.mode).toBe("remote");
  connectionError = null;
  await act(async () => button("Use this computer").click()); await flush();
  expect(choice.mode).toBe("local");
  expect(document.body.textContent).toContain("Local installation");
});

test("sharing-only interruption needs a deliberate confirmation and preserves the selected address", async () => {
  choice = { mode: "local", address: "http://192.168.1.10:4100", targets: ["http://192.168.1.10:4100"], localSetupComplete: true };
  interruption = "sharing";
  await render();
  await act(async () => button(`Play on: ${choice.mode === "local" ? "This computer" : choice.address}`).click()); await flush();
  await act(async () => button("http://192.168.1.10:4100").click()); await flush();
  expect(document.body.textContent).toContain("turns off this computer's remote control");
  expect(document.body.textContent).not.toContain("stops playback on this computer");
  expect(choice.mode).toBe("local");
  await act(async () => button("Stop and switch").click()); await flush();
  expect(choice.mode).toBe("remote");
  expect(choice.address).toBe("http://192.168.1.10:4100");
  expect(invoke.mock.calls.some(([name, args]) => name === "select_playback_device" && (args as any).confirmInterrupt)).toBe(true);
});

test("local first use records private choice after the host saves it", async () => {
  choice.mode = "local";
  await render(true);
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Allow remote control?");
  await act(async () => button("Keep private").click()); await flush();
  expect(request.mock.calls[0]?.[0]).toBe("http://127.0.0.1:4100/api/settings/sharing");
  expect(JSON.parse(String(request.mock.calls[0]?.[1]?.body))).toEqual({ enabled: false });
  expect(choice.localSetupComplete).toBe(true);
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});

test("failed local sharing save leaves the prompt available and does not mark setup complete", async () => {
  choice.mode = "local";
  request.mockResolvedValue(Response.json({ error: "Could not save sharing." }, { status: 500 }));
  await render(true);
  await act(async () => button("Keep private").click()); await flush();
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Could not save sharing.");
  expect(choice.localSetupComplete).toBe(false);
  expect(invoke.mock.calls.some(([name]) => name === "complete_local_setup")).toBe(false);
});

test("closing the device chooser reconnects the same remote and restores trigger focus", async () => {
  choice = { mode: "remote", address: "http://192.168.1.10:4100", targets: ["http://192.168.1.10:4100"], localSetupComplete: true };
  await render();
  const initial = invoke.mock.calls.filter(([name]) => name === "retry_playback_device").length;
  await act(async () => button(`Play on: ${choice.mode === "local" ? "This computer" : choice.address}`).click()); await flush();
  expect(invoke.mock.calls.filter(([name]) => name === "retry_playback_device")).toHaveLength(initial);
  await act(async () => button(`Play on: ${choice.address}`).click()); await flush();
  expect(invoke.mock.calls.filter(([name]) => name === "retry_playback_device")).toHaveLength(initial + 1);
  expect(choice.mode).toBe("remote");
  expect(document.activeElement?.textContent).toBe(`Play on: ${choice.address}`);
});

test("Play on marks the current computer and switches directly to a remembered Couch", async () => {
  choice = { mode: "local", address: "http://192.168.1.10:4100", targets: ["http://192.168.1.10:4100", "http://192.168.1.20:4100"], localSetupComplete: true };
  await render();
  await act(async () => button("Play on: This computer").click()); await flush();
  expect(document.querySelector('[data-slot="popover-content"]')).not.toBeNull();
  expect(button("This computer").getAttribute("aria-pressed")).toBe("true");
  expect(button("http://192.168.1.20:4100").getAttribute("aria-pressed")).toBe("false");
  await act(async () => button("http://192.168.1.20:4100").click()); await flush();
  expect(choice.address).toBe("http://192.168.1.20:4100");
  expect(button("Stop and switch")).toBeUndefined();
  expect(button("Play on: http://192.168.1.20:4100")).toBeDefined();
});

test("Another Couch opens focused address entry without a submenu", async () => {
  choice.mode = "local"; choice.localSetupComplete = true;
  await render();
  await act(async () => button("Play on: This computer").click()); await flush();
  await act(async () => button("Another Couch").click()); await flush();
  expect(document.querySelector('[data-slot="popover-content"]')).toBeNull();
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Another Couch");
  expect(document.activeElement?.id).toBe("another-couch-address");
  expect((document.activeElement as HTMLInputElement).value).toBe("");
});
