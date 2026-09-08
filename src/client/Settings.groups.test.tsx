import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { Window } from "happy-dom";
import { act } from "react";
import type { Root } from "react-dom/client";
import type { Settings as SettingsComponent } from "./Settings";

let Settings: typeof SettingsComponent, root: Root, window: Window, request: ReturnType<typeof spyOn>;
const originals = new Map<string, PropertyDescriptor | undefined>();
const calls: { path: string; method: string }[] = [];
const admin = { authority: "administrator" as const, controller: { id: "owner", name: "Owner's phone", role: "administrator" as const, createdAt: null, lastSeenAt: null }, claimAvailable: false };
const props: Parameters<typeof SettingsComponent>[0] = {
  videoQualityPreference: { quality: "auto", save: () => {}, error: null }, credentials: { origin: "http://localhost", token: "paired" },
  connected: true, status: "Ready", identity: admin, details: { name: "Couch", urls: [], player: "idle" }, pairingRequired: false, reachable: true, host: null,
  administratorClaimed: true, name: "Couch", version: 1, onReconnect: () => {}, onPairAgain: () => {}, onCommand: async () => true,
  initialOpen: true, jellyfinVersion: 1, radioVersion: 1, libraryVersion: 1, profile: { id: "household", name: "Household" },
  preferences: { profile: { audioLanguage: "", subtitleLanguage: "", subtitles: "auto", speed: 1, replayGain: "off" }, device: { audioDelay: 0 } },
};
const render = (override: Partial<typeof props> = {}) => act(async () => root.render(<Settings {...props} {...override} />));
const enter = (id: string) => act(async () => document.querySelector<HTMLButtonElement>(`[data-settings-group="${id}"]`)!.click());
const tab = (id: string) => document.querySelector<HTMLButtonElement>(`[role="tab"][id$="-trigger-${id}"]`);
const select = (id: string) => act(async () => { const control = tab(id)!; control.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 })); control.click(); });
const all = () => act(async () => { [...document.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === "All settings")!.click(); await new Promise(resolve => setTimeout(resolve, 30)); });

beforeEach(async () => {
  calls.length = 0;
  window = new Window({ url: "http://localhost" });
  for (const key of ["window", "document", "navigator", "location", "localStorage", "HTMLElement", "HTMLInputElement", "HTMLButtonElement", "HTMLFormElement", "HTMLSelectElement", "Element", "Node", "NodeFilter", "DocumentFragment", "MutationObserver", "ResizeObserver", "CustomEvent", "Event", "MouseEvent", "PointerEvent", "KeyboardEvent", "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame", "IS_REACT_ACT_ENVIRONMENT"]) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    const value = key === "IS_REACT_ACT_ENVIRONMENT" ? true : key === "window" ? window : Reflect.get(window, key);
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: typeof value === "function" && /^[a-z]/.test(key) ? value.bind(window) : value });
  }
  request = spyOn(globalThis, "fetch").mockImplementation((async (input, init) => {
    const path = new URL(String(input)).pathname;
    calls.push({ path, method: init?.method ?? "GET" });
    if (path === "/api/controllers") return Response.json({ controllers: [admin.controller] });
    if (path === "/api/settings/startup") return Response.json({ enabled: true, fullscreenAtLaunch: true, fullscreenNow: true, applies: "next-session" });
    if (path.startsWith("/api/library/") || path === "/api/radio/sources") return Response.json({ sources: [] });
    return Response.json({ name: "Couch", configured: false });
  }) as typeof fetch);
  const { createRoot } = await import("react-dom/client");
  ({ Settings } = await import("./Settings"));
  root = createRoot(document.body.appendChild(document.createElement("div")));
});
afterEach(async () => {
  await act(async () => { root.unmount(); await new Promise(resolve => setTimeout(resolve, 0)); });
  request.mockRestore(); await window.happyDOM.abort();
  for (const [key, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  originals.clear();
});

test("three groups lead to profile defaults and preserve entry and back focus without changing playback", async () => {
  const command = spyOn(props, "onCommand");
  try {
    await render();
    expect([...document.querySelectorAll<HTMLElement>("[data-settings-group]")].map(button => button.dataset.settingsGroup)).toEqual(["profile", "device", "tv"]);
    expect(document.querySelectorAll('[role="tab"]')).toHaveLength(0);
    expect(document.querySelector("#default-video-quality")?.textContent).toBe("1080p (recommended)");
    await enter("profile");
    expect(document.activeElement).toBe(tab("playback"));
    expect(document.body.textContent).toContain("Profile: Default profile");
    expect(document.body.textContent).toContain("Open Profiles in the header to switch profiles after stopping playback.");
    expect(tab("general")).toBeNull();
    await all();
    expect(document.activeElement).toBe(document.querySelector('[data-settings-group="profile"]'));
    expect(command).not.toHaveBeenCalled();
    expect(calls.some(call => call.method !== "GET")).toBe(false);
  } finally { command.mockRestore(); }
});

test("device appearance and connection exclude shared TV appearance and administrator remotes", async () => {
  await render(); await enter("device");
  expect(document.querySelector("#remote-interface-size")).not.toBeNull();
  expect(document.querySelector("#tv-interface-size")).toBeNull();
  await select("connection");
  expect(document.body.textContent).toContain("Owner's phone");
  expect(document.querySelector('[aria-label="Paired remotes"]')).toBeNull();
  await select("remote");
  expect(document.querySelector("#default-video-quality")).not.toBeNull();
  await all(); await enter("tv"); await select("tv-appearance");
  expect(document.querySelector("#tv-interface-size")).not.toBeNull();
  expect(document.querySelector("#remote-interface-size")).toBeNull();
});

test("administrator TV controls remain gated and an open remotes page recovers after demotion", async () => {
  await render(); await enter("tv");
  for (const id of ["general", "sources", "bluetooth", "sound", "display", "tv-appearance", "remotes", "updates", "advanced"]) expect(tab(id)).not.toBeNull();
  await select("remotes");
  expect(document.querySelector('[aria-label="Paired remotes"]')).not.toBeNull();
  await render({ identity: { ...admin, authority: "controller", controller: { ...admin.controller, role: "controller" } } });
  for (const id of ["bluetooth", "sound", "display", "remotes", "advanced"]) expect(tab(id)).toBeNull();
  expect(tab("general")?.getAttribute("data-state")).toBe("active");
  expect(document.querySelector('[aria-label="Paired remotes"]')).toBeNull();
  expect(document.querySelector("#tv-name")).toBeNull();
  expect(calls.some(call => call.method !== "GET")).toBe(false);
});

test("source deep links select the TV group and native sources remain local-only", async () => {
  await render({ sourcesRequest: 1 });
  expect(tab("sources")?.getAttribute("data-state")).toBe("active");
  expect(document.body.textContent).toContain("Jellyfin");
  expect(calls.some(call => call.path === "/api/library/folders")).toBe(true);
  await render({ sourcesRequest: 2, host: { origin: "http://localhost", token: "host", urls: [], pairingCode: "123456" }, identity: { authority: "host", controller: null, claimAvailable: false } });
  expect(tab("sources")?.hasAttribute("data-tv-local-only")).toBe(true);
  expect(document.querySelector('[role="dialog"]')?.hasAttribute("data-tv-local-only")).toBe(true);
  await all(); await enter("device");
  expect(document.querySelector("#tv-interface-size")?.closest("[data-tv-local-only]")).not.toBeNull();
  expect(document.querySelector("#remote-interface-size")).toBeNull();
});


test("the landing quality control preserves an unrestricted choice and saves a new default", async () => {
  const save = spyOn(props.videoQualityPreference, "save");
  try {
    await render({ videoQualityPreference: { ...props.videoQualityPreference, quality: "best" } });
    expect(document.querySelectorAll("#default-video-quality")).toHaveLength(1);
    const control = document.querySelector<HTMLButtonElement>("#default-video-quality")!;
    expect(control.textContent).toBe("Unrestricted quality");
    expect(save).not.toHaveBeenCalled();
    await act(async () => control.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    await act(async () => [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(option => option.textContent === "Up to 720p")!.click());
    expect(save).toHaveBeenCalledWith("720p");
  } finally { save.mockRestore(); }
});
