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
const page = (id: string) => document.querySelector<HTMLElement>(`[data-settings-page="${id}"]`);
const select = (id: string) => act(async () => page(id)!.click());
const all = () => act(async () => { document.querySelector<HTMLElement>("[data-back]")!.click(); });

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
    if (path === "/api/controllers/pairing-code") return Response.json({ code: "123456" });
    if (path === "/api/display") return Response.json({ outputs: [], current: null, saved: null, preview: null });
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

test("settings opens a flat page index without tabs, cards or a quality control", async () => {
  const command = spyOn(props, "onCommand");
  try {
    await render();
    expect([...document.querySelectorAll<HTMLElement>("[data-settings-page]")].map(button => button.dataset.settingsPage)).toEqual(["playback", "appearance", "connection", "general", "sources", "bluetooth", "sound", "display", "tv-appearance", "updates", "advanced"]);
    expect(document.querySelector('[role="tablist"]')).toBeNull();
    expect(document.querySelector('[data-settings-group]')).toBeNull();
    expect(document.querySelector("#default-video-quality")).toBeNull();
    await select("playback");
    expect(document.activeElement?.textContent).toBe("Playback");
    expect(document.querySelector("#default-video-quality")?.textContent).toBe("1080p (recommended)");
    expect(document.querySelector("#preferred-audio-language")).not.toBeNull();
    await all();
    expect(document.activeElement).toBe(page("playback"));
    expect(command).not.toHaveBeenCalled();
    expect(calls.some(call => call.method !== "GET")).toBe(false);
  } finally { command.mockRestore(); }
});

test("device appearance, TV appearance and connection have separate pages", async () => {
  await render(); await select("appearance");
  expect(document.querySelector("#remote-interface-size")).not.toBeNull();
  expect(document.querySelector("#tv-interface-size")).toBeNull();
  await select("connection");
  expect(document.body.textContent).toContain("Owner's phone");
  expect(document.querySelector('[aria-label="Paired remotes"]')).not.toBeNull();
  expect(document.querySelector("#default-video-quality")).toBeNull();
  await select("tv-appearance");
  expect(document.querySelector("#tv-interface-size")).not.toBeNull();
  expect(document.querySelector("#remote-interface-size")).toBeNull();
});

test("administrator pages stay gated and demotion removes remote management", async () => {
  await render(); await select("connection");
  expect(document.querySelector('[aria-label="Paired remotes"]')).not.toBeNull();
  await render({ identity: { ...admin, authority: "controller", controller: { ...admin.controller, role: "controller" } } });
  for (const id of ["bluetooth", "sound", "display", "advanced"]) expect(page(id)).toBeNull();
  expect(page("connection")?.getAttribute("aria-current")).toBe("page");
  expect(document.querySelector('[aria-label="Paired remotes"]')).toBeNull();
  expect(document.querySelector("#tv-name")).toBeNull();
  expect(calls.some(call => call.method !== "GET")).toBe(false);
});

test("source requests open Sources and native sources remain local-only", async () => {
  await render({ sourcesRequest: 1 });
  expect(page("sources")?.getAttribute("aria-current")).toBe("page");
  expect(document.body.textContent).toContain("Jellyfin");
  expect(calls.some(call => call.path === "/api/library/folders")).toBe(false);
  await select("source-folders");
  expect(calls.some(call => call.path === "/api/library/folders")).toBe(true);
  await render({ sourcesRequest: 2, host: { origin: "http://localhost", token: "host", urls: [], pairingCode: "123456" }, identity: { authority: "host", controller: null, claimAvailable: false } });
  expect(page("sources")?.hasAttribute("data-tv-local-only")).toBe(true);
  expect(document.querySelector('[role="dialog"]')?.hasAttribute("data-tv-local-only")).toBe(true);
  expect(page("tv-appearance")).toBeNull();
  await select("appearance");
  expect(document.querySelector("#tv-interface-size")?.closest("[data-tv-local-only]")).not.toBeNull();
  expect(document.querySelector("#remote-interface-size")).toBeNull();
});

test("Playback preserves an unrestricted quality choice and saves a new default", async () => {
  const save = spyOn(props.videoQualityPreference, "save");
  try {
    await render({ videoQualityPreference: { ...props.videoQualityPreference, quality: "best" } });
    await select("playback");
    expect(document.querySelectorAll("#default-video-quality")).toHaveLength(1);
    const control = document.querySelector<HTMLButtonElement>("#default-video-quality")!;
    expect(control.textContent).toBe("Unrestricted quality");
    expect(save).not.toHaveBeenCalled();
    await act(async () => control.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    await act(async () => [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(option => option.textContent === "Up to 720p")!.click());
    expect(save).toHaveBeenCalledWith("720p");
  } finally { save.mockRestore(); }
});

test("live state renders preserve unsaved profile defaults and the focused control", async () => {
  await render(); await select("playback");
  const control = document.querySelector<HTMLButtonElement>("#preferred-subtitle-mode")!;
  await act(async () => control.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
  await act(async () => [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(option => option.textContent === "Off")!.click());
  await act(async () => control.focus());
  await render({ status: "Playing" });
  expect(document.querySelector("#preferred-subtitle-mode")).toBe(control);
  expect(control.textContent).toBe("Off");
  expect(document.activeElement).toBe(control);
  expect(calls.some(call => call.method !== "GET")).toBe(false);
});

test("setup keeps its required screen step without settings navigation", async () => {
  await render({ setupStep: "display" });
  expect(document.querySelector('[aria-label="Settings pages"]')).toBeNull();
  expect(document.body.textContent).toContain("I can see Couch on the right screen");
  expect(document.querySelector("#default-video-quality")).toBeNull();
});


test("linked settings pages preserve URLs, Back focus and hidden-page focus", async () => {
  const { BrowserRouter, useLocation, useNavigate } = await import("react-router");
  const { settingsPageForPath, settingsPagePath } = await import("../shared/settings-pages");
  function Pages({ active = true }: { active?: boolean }) {
    const location = useLocation();
    const navigate = useNavigate();
    return <Settings {...props} inline active={active} section={settingsPageForPath(location.pathname)} onSectionChange={section => void navigate(settingsPagePath(section))} />;
  }
  await act(async () => root.render(<BrowserRouter><Pages /></BrowserRouter>));
  expect(page("playback")?.tagName).toBe("A");
  expect(page("playback")?.getAttribute("href")).toBe("/settings/playback");
  await select("playback");
  expect(window.location.pathname).toBe("/settings/playback");
  expect(document.activeElement?.textContent).toBe("Playback");
  expect(document.querySelector(".settings-back")).toBeNull();
  const category = document.querySelector<HTMLSelectElement>(".settings-category select")!;
  expect(category.value).toBe("playback");
  await act(async () => { category.value = "appearance"; category.dispatchEvent(new Event("change", { bubbles: true })); });
  expect(window.location.pathname).toBe("/settings/appearance");
  await act(async () => { window.history.back(); await new Promise(resolve => setTimeout(resolve, 20)); });
  expect(window.location.pathname).toBe("/settings/playback");
  expect(document.querySelector("#default-video-quality")).not.toBeNull();
  await select("sources");
  await select("source-jellyfin");
  await all();
  expect(window.location.pathname).toBe("/settings/sources");
  expect(document.activeElement).toBe(page("source-jellyfin"));
  expect(page("source-jellyfin")?.tagName).toBe("A");
  expect(page("source-jellyfin")!.tabIndex).toBeGreaterThanOrEqual(0);
  const outside = document.body.appendChild(document.createElement("button"));
  await act(async () => { outside.focus(); root.render(<BrowserRouter><Pages active={false} /></BrowserRouter>); });
  expect(document.activeElement).toBe(outside);
});

test("direct protected pages wait for identity before redirecting", async () => {
  const navigate = spyOn({ navigate: (_section: string | null) => {} }, "navigate");
  const { MemoryRouter } = await import("react-router");
  await act(async () => root.render(<MemoryRouter><Settings {...props} section="bluetooth" identity={null} connected={false} onSectionChange={navigate} /></MemoryRouter>));
  expect(navigate).not.toHaveBeenCalled();
  await act(async () => root.render(<MemoryRouter><Settings {...props} section="bluetooth" identity={{ ...admin, authority: "controller" }} onSectionChange={navigate} /></MemoryRouter>));
  expect(navigate).toHaveBeenCalledWith("general");
});


test("Sources links to one form at a time instead of piling every source into one page", async () => {
  await render(); await select("sources");
  expect([...document.querySelectorAll<HTMLElement>("[data-settings-page^='source-']")].map(control => control.dataset.settingsPage)).toEqual(["source-folders", "source-jellyfin", "source-radio", "source-metadata", "source-streaming-community"]);
  expect(document.querySelector('[aria-label="Jellyfin settings"]')).toBeNull();
  await select("source-jellyfin");
  expect(document.querySelector('[aria-label="Jellyfin settings"]')).not.toBeNull();
  expect(document.querySelector('[aria-label="TV folder settings"]')).toBeNull();
  expect(document.querySelector('[aria-label="StreamingCommunity settings"]')).toBeNull();
  expect(document.activeElement?.textContent).toBe("Jellyfin");
  await all();
  expect(page("sources")?.getAttribute("aria-current")).toBe("page");
  expect(document.activeElement).toBe(page("source-jellyfin"));
  expect(page("source-jellyfin")!.tabIndex).toBeGreaterThanOrEqual(0);
});


test("Connections QR includes the pairing code and disappears when administration is removed", async () => {
  const { QRCodeSVG } = await import("qrcode.react");
  const { renderToStaticMarkup } = await import("react-dom/server");
  const details = { name: "Couch", urls: ["http://couch.local:4100"], player: "idle" as const };
  await render({ details }); await select("connection");
  expect(document.querySelector("#remote-owner")).not.toBeNull();
  expect(page("remotes")).toBeNull();
  const svg = document.querySelector('svg[role="img"]') ?? document.querySelector("svg:has(title)");
  expect(svg?.textContent).toBe("Pair another device");
  const expected = document.createElement("div");
  expected.innerHTML = renderToStaticMarkup(<QRCodeSVG value="http://couch.local:4100/#pair=123456" size={160} marginSize={4} level="M" />);
  expect([...svg!.querySelectorAll("path")].map(path => path.getAttribute("d"))).toEqual([...expected.querySelectorAll("path")].map(path => path.getAttribute("d")));
  expect(document.body.innerHTML).not.toContain("Bearer paired");
  expect(calls.filter(call => call.path === "/api/controllers/pairing-code")).toHaveLength(1);
  await render({ details, identity: { ...admin, authority: "controller", controller: { ...admin.controller, role: "controller" } } });
  expect(document.querySelector("svg:has(title)")).toBeNull();
  expect(document.querySelector("#remote-owner")).not.toBeNull();
  expect(document.querySelector('[aria-label="Paired remotes"]')).toBeNull();
});

test("a failed pairing code request never shows an address-only QR", async () => {
  request.mockImplementation((async input => String(input).endsWith("/pairing-code") ? Response.json({ error: "Unavailable" }, { status: 503 }) : String(input).endsWith("/controllers") ? Response.json({ controllers: [admin.controller] }) : Response.json({ name: "Couch" })) as typeof fetch);
  await render({ details: { name: "Couch", urls: ["http://couch.local:4100"], player: "idle" } }); await select("connection");
  expect(document.querySelector("svg:has(title)")).toBeNull();
  expect(document.body.textContent).toContain("Retry pairing QR");
});

test("native qualification navigates current Settings links and the phone category select", async () => {
  const { UiDriver } = await import("../../tests/linux/ui");
  const { BrowserRouter, useLocation, useNavigate } = await import("react-router");
  const { settingsPageForPath, settingsPagePath } = await import("../shared/settings-pages");
  function Pages() {
    const location = useLocation(), navigate = useNavigate();
    return <Settings {...props} inline section={settingsPageForPath(location.pathname)} onSectionChange={section => void navigate(settingsPagePath(section))} />;
  }
  await act(async () => root.render(<BrowserRouter><Pages /></BrowserRouter>));
  const nativeClicks: string[] = [];
  const ui = new UiDriver(async path => {
    const selector = path.slice("/session/dom/element/".length, -"/click".length);
    const option = document.querySelector<HTMLOptionElement>(selector)!;
    expect(option.tagName).toBe("OPTION");
    nativeClicks.push(option.value);
    await act(async () => {
      const select = option.parentElement as HTMLSelectElement;
      select.value = option.value;
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
  }, () => "dom");
  ui.element = async selector => selector;
  ui.execute = async (script, args = []) => new Function("document", "args", `return (function () { ${script} }).apply(null, args)`)(document, args);
  ui.clickElement = async selector => { await act(async () => document.querySelector<HTMLElement>(selector)!.click()); };
  ui.waitFor = async (_description, predicate) => { expect(await predicate()).toBe(true); };
  const category = document.querySelector<HTMLSelectElement>(".settings-category select")!;
  Object.defineProperty(category, "getClientRects", { configurable: true, value: () => [] });
  await ui.settingsSection("general");
  expect(window.location.pathname).toBe("/settings/tv");
  expect(document.querySelector("#tv-name")).not.toBeNull();
  Object.defineProperty(category, "getClientRects", { value: () => [{ width: 360, height: 44 }] });
  await ui.settingsSection("remotes");
  expect(window.location.pathname).toBe("/settings/connection");
  expect(document.querySelector("#remote-owner")).not.toBeNull();
  await ui.settingsSection("remote");
  expect(window.location.pathname).toBe("/settings/playback");
  expect(document.querySelector("#default-video-quality")).not.toBeNull();
  expect(nativeClicks).toEqual(["connection", "playback"]);
});

test("the local host manages settings and the last remote without an administrator claim", async () => {
  await render({ host: { origin: "http://localhost", token: "host", urls: ["http://192.168.1.2:4100"], pairingCode: "123456" }, identity: { authority: "host", controller: null, claimAvailable: true }, administratorClaimed: false });
  await select("general");
  expect(document.querySelector("#tv-name")).not.toBeNull();
  expect(document.body.textContent).not.toContain("administrator code");
  for (const id of ["bluetooth", "sound", "display", "advanced"]) expect(page(id)).not.toBeNull();
  await select("connection");
  expect(document.querySelector('[aria-label="Paired remotes"]')).not.toBeNull();
  for (const text of ["Remove administration", "Revoke access"]) expect([...document.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === text)!.disabled).toBe(false);
  expect(document.body.textContent).not.toContain("Keep this administrator");
});

test("sharing can only be changed locally and failed saves preserve its value and focus", async () => {
  let enabled = true, reject = true;
  const previous = request.getMockImplementation()!;
  request.mockImplementation((async (input, init) => {
    if (String(input).endsWith("/sharing")) {
      if (init?.method === "POST") {
        if (reject) return Response.json({ error: "Could not save remote control settings." }, { status: 500 });
        enabled = JSON.parse(String(init.body)).enabled;
      }
      return Response.json({ enabled });
    }
    return previous(input, init);
  }) as typeof fetch);
  await render(); await select("connection");
  expect(document.querySelector<HTMLButtonElement>("#allow-remote-control")!.disabled).toBe(true);
  const changed = spyOn({ changed: (_enabled: boolean) => {} }, "changed");
  await render({ host: { origin: "http://localhost", token: "host", urls: ["http://192.168.1.2:4100"], pairingCode: "123456" }, identity: { authority: "host", controller: null, claimAvailable: false }, onRemoteControlChange: changed });
  const control = document.querySelector<HTMLButtonElement>("#allow-remote-control")!;
  expect(control.disabled).toBe(false);
  expect(control.getAttribute("aria-checked")).toBe("true");
  await act(async () => { control.focus(); control.click(); });
  expect(document.body.textContent).toContain("Could not save remote control settings.");
  expect(control.getAttribute("aria-checked")).toBe("true");
  expect(document.activeElement).toBe(control);
  expect(changed).not.toHaveBeenCalled();
  reject = false;
  await act(async () => control.click());
  expect(control.getAttribute("aria-checked")).toBe("false");
  expect(document.querySelector("[data-pairing-code]")).toBeNull();
  expect(document.body.textContent).toContain("Playback continues and pairings are remembered.");
  expect(changed).toHaveBeenCalledWith(false);
});
