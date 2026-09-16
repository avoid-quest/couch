import { expect, spyOn, test } from "bun:test";
import { Window } from "happy-dom";
import { act } from "react";
import { useIdleCursor } from "./useIdleCursor";

test("TV cursor hides once the pointer goes idle and returns on movement", async () => {
  const window = new Window({ url: "http://localhost" });
  const originals = new Map<string, PropertyDescriptor | undefined>();
  for (const key of ["window", "document", "HTMLElement", "Event", "IS_REACT_ACT_ENVIRONMENT"]) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    const value = key === "IS_REACT_ACT_ENVIRONMENT" ? true : key === "window" ? window : Reflect.get(window, key);
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: typeof value === "function" && /^[a-z]/.test(key) ? value.bind(window) : value });
  }
  const originalTimer = globalThis.setTimeout;
  const originalClear = globalThis.clearTimeout;
  let idleHide: (() => void) | undefined;
  const timers = spyOn(globalThis, "setTimeout").mockImplementation(((...args: Parameters<typeof setTimeout>) => {
    const [callback, delay] = args;
    if (typeof callback === "function" && delay === 4_000) { idleHide = callback; return idleHide; }
    return originalTimer(...args);
  }) as typeof setTimeout);
  const cleared: unknown[] = [];
  const clear = spyOn(globalThis, "clearTimeout").mockImplementation((timer => { cleared.push(timer); }) as typeof clearTimeout);
  const { createRoot } = await import("react-dom/client");
  const root = createRoot(document.body.appendChild(document.createElement("div")));
  try {
    await act(async () => root.render(<Idle />));
    expect(document.documentElement.style.cursor).toBe("");
    await act(async () => idleHide?.());
    expect(document.documentElement.style.cursor).toBe("none");
    await act(async () => window.dispatchEvent(new window.Event("pointermove")));
    expect(document.documentElement.style.cursor).toBe("");
    await act(async () => idleHide?.());
    expect(document.documentElement.style.cursor).toBe("none");
    await act(async () => root.unmount());
    expect(document.documentElement.style.cursor).toBe("");
    expect(cleared).toContain(idleHide);
  } finally {
    timers.mockRestore();
    clear.mockRestore();
    window.happyDOM.abort();
    for (const [key, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  }
});

function Idle() {
  useIdleCursor(true);
  return null;
}
