import { expect, spyOn, test } from "bun:test";
import { Window } from "happy-dom";
import { act, StrictMode } from "react";

test("General shows OS startup readback and clears stale state after a rejected write", async () => {
  const window = new Window({ url: "http://localhost" });
  const originals = new Map<string, PropertyDescriptor | undefined>();
  for (const key of ["window", "document", "navigator", "HTMLElement", "HTMLInputElement", "HTMLButtonElement", "Element", "Node", "NodeFilter", "DocumentFragment", "MutationObserver", "CustomEvent", "Event", "MouseEvent", "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame", "IS_REACT_ACT_ENVIRONMENT"]) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    const value = key === "IS_REACT_ACT_ENVIRONMENT" ? true : key === "window" ? window : Reflect.get(window, key);
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: typeof value === "function" && /^[a-z]/.test(key) ? value.bind(window) : value });
  }
  const request = spyOn(globalThis, "fetch").mockImplementation((async (_url, options) => options?.method === "POST" ? Response.json({ error: "OS permission denied. Inspect couch-autostart logs." }, { status: 503 }) : Response.json({ enabled: true, fullscreenAtLaunch: true, fullscreenNow: false, applies: "next-session" })) as typeof fetch);
  const { createRoot } = await import("react-dom/client");
  const { StartupSettings } = await import("./StartupSettings");
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container);
  const button = (text: string) => [...document.querySelectorAll<HTMLButtonElement>("button")].find(node => node.textContent === text)!;
  try {
    await act(async () => root.render(<StrictMode><StartupSettings credentials={{ origin: "http://localhost", token: "admin" }} connected /></StrictMode>));
    expect(document.body.textContent).toContain("Couch starts automatically");
    expect(document.body.textContent).toContain("Current TV window: windowed");
    expect(document.body.textContent).toContain("without a login prompt");
    expect(document.body.textContent).toContain("sudo couch-session autostart enable");
    await act(async () => button("Disable automatic startup").click());
    const sent = request.mock.calls.find(([, options]) => options?.method === "POST")![1]!;
    expect(sent.body).toBe(JSON.stringify({ enabled: false }));
    expect(sent.headers).toMatchObject({ Authorization: "Bearer admin" });
    expect(document.body.textContent).toContain("OS permission denied");
    expect(document.body.textContent).not.toContain("Saved. Applies at the next startup.");
    expect(document.querySelector("[data-startup-mode]")).toBeNull();
    await act(async () => button("Refresh startup").click());
    expect(document.body.textContent).toContain("Couch starts automatically");

  } finally {
    await act(async () => {
      root.unmount();
      // Radix restores focus in a timer that still needs this window's Event constructors.
      await new Promise(resolve => setTimeout(resolve, 0));
    });
    request.mockRestore(); window.happyDOM.abort();
    for (const [key, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  }
});
