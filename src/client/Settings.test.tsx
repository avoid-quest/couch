import { expect, spyOn, test } from "bun:test";
import { Window } from "happy-dom";
import { act } from "react";

test("General keeps one startup control across navigation and identity loss", async () => {
  const window = new Window({ url: "http://localhost" });
  const originals = new Map<string, PropertyDescriptor | undefined>();
  for (const key of ["window", "document", "navigator", "HTMLElement", "HTMLFormElement", "HTMLInputElement", "HTMLButtonElement", "Element", "Node", "NodeFilter", "DocumentFragment", "MutationObserver", "CustomEvent", "Event", "MouseEvent", "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame", "localStorage", "location", "IS_REACT_ACT_ENVIRONMENT"]) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    const value = key === "IS_REACT_ACT_ENVIRONMENT" ? true : key === "window" ? window : Reflect.get(window, key);
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: typeof value === "function" && /^[a-z]/.test(key) ? value.bind(window) : value });
  }
  const request = spyOn(globalThis, "fetch").mockImplementation((async input => Response.json(String(input).endsWith("/startup") ? { enabled: true, fullscreenAtLaunch: true, fullscreenNow: true, applies: "next-session" } : String(input).endsWith("/controllers") ? { controllers: [] } : { name: "Couch" })) as typeof fetch);
  const { createRoot } = await import("react-dom/client");
  const { Settings } = await import("./Settings");
  const root = createRoot(document.body.appendChild(document.createElement("div")));
  const props: Parameters<typeof Settings>[0] = {
    videoQualityPreference: { quality: "auto", save: () => {}, error: null },
    credentials: { origin: "http://localhost", token: "test-administrator" },
    connected: true, status: "Ready", identity: { authority: "administrator", controller: { id: "test-admin", name: "Test remote", role: "administrator", createdAt: null, lastSeenAt: null }, claimAvailable: false },
    details: { name: "Couch", urls: [], player: "idle" }, pairingRequired: false, reachable: true, host: null,
    administratorClaimed: true, name: "Couch", version: 1, onReconnect: () => {}, onPairAgain: () => {},
    onCommand: async () => true, initialOpen: true, jellyfinVersion: 1, radioVersion: 1, libraryVersion: 1,
  };
  const render = (identity = props.identity) => act(async () => root.render(<Settings {...props} identity={identity} connected={!!identity} />));
  const startupCount = () => document.querySelectorAll("[data-startup-mode]").length;
  try {
    await render();
    await act(async () => document.querySelector<HTMLButtonElement>('[data-settings-group="tv"]')!.click());
    expect(startupCount()).toBe(1);
    await act(async () => [...document.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === "Manage remotes")!.click());
    await act(async () => document.querySelector('[role="tab"][id$="-trigger-general"]')!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 })));
    expect(startupCount()).toBe(1);
    await render(null);
    expect(startupCount()).toBe(0);
    await render();
    expect(startupCount()).toBe(1);
  } finally {
    await act(async () => {
      root.unmount();
      // Let Radix's focus-restoration timer finish before restoring DOM globals.
      await new Promise(resolve => setTimeout(resolve, 0));
    });
    request.mockRestore(); window.happyDOM.abort();
    for (const [key, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  }
});
