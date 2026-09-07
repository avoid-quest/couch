import { expect, spyOn, test } from "bun:test";
import { Window } from "happy-dom";
import { act, StrictMode } from "react";

test("General requires explicit interruption confirmation and keeps a checkpoint rejection visible", async () => {
  const window = new Window({ url: "http://localhost" });
  const originals = new Map<string, PropertyDescriptor | undefined>();
  for (const key of ["window", "document", "navigator", "HTMLElement", "HTMLInputElement", "HTMLButtonElement", "Element", "Node", "NodeFilter", "DocumentFragment", "MutationObserver", "CustomEvent", "Event", "MouseEvent", "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame", "IS_REACT_ACT_ENVIRONMENT"]) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    const value = key === "IS_REACT_ACT_ENVIRONMENT" ? true : key === "window" ? window : Reflect.get(window, key);
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: typeof value === "function" && /^[a-z]/.test(key) ? value.bind(window) : value });
  }
  const request = spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ error: "Could not save viewing progress. Check the TV's storage." }, { status: 409 }));
  const { createRoot } = await import("react-dom/client");
  const { RestartSettings } = await import("./RestartSettings");
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container);
  const button = (text: string) => [...document.querySelectorAll<HTMLButtonElement>("button")].find(node => node.textContent === text)!;
  try {
    await act(async () => root.render(<StrictMode><RestartSettings credentials={{ origin: "http://localhost", token: "admin" }} connected /></StrictMode>));
    await act(async () => button("Restart Couch").click());
    expect(request).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("This interrupts current playback");
    await act(async () => button("Confirm restart").click());
    expect(request).toHaveBeenCalledTimes(1);
    const sent = request.mock.calls[0]![1]!;
    expect(sent.body).toBe(JSON.stringify({ confirmInterrupt: true }));
    expect(sent.headers).toMatchObject({ Authorization: "Bearer admin" });
    expect(sent.signal?.aborted).toBe(false);
    expect(document.body.textContent).toContain("Could not save viewing progress");
    expect(button("Restart Couch").disabled).toBe(false);
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
