import { expect, spyOn, test } from "bun:test";
import { Window } from "happy-dom";
import { act } from "react";
import { useIdleCursor } from "./useIdleCursor";

test("TV cursor hides once the pointer goes idle and returns on movement", async () => {
  const window = new Window({ url: "http://localhost" });
  const invokes: { cmd: string; args?: Record<string, unknown> }[] = [];
  (window as unknown as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
    invoke: async (cmd: string, args?: Record<string, unknown>) => { invokes.push({ cmd, args }); },
  };
  const originals = new Map<string, PropertyDescriptor | undefined>();
  for (const key of ["window", "document", "HTMLElement", "Event", "IS_REACT_ACT_ENVIRONMENT"]) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    const value = key === "IS_REACT_ACT_ENVIRONMENT" ? true : key === "window" ? window : Reflect.get(window, key);
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: typeof value === "function" && /^[a-z]/.test(key) ? value.bind(window) : value });
  }
  const originalTimer = globalThis.setTimeout;
  let idleHide: (() => void) | undefined;
  const timers = spyOn(globalThis, "setTimeout").mockImplementation(((...args: Parameters<typeof setTimeout>) => {
    const [callback, delay] = args;
    if (typeof callback === "function" && delay === 4_000) { idleHide = callback; return idleHide; }
    return originalTimer(...args);
  }) as typeof setTimeout);
  const { createRoot } = await import("react-dom/client");
  const root = createRoot(document.body.appendChild(document.createElement("div")));
  try {
    await act(async () => root.render(<Idle />));
    expect(invokes).toEqual([]);
    await act(async () => idleHide?.());
    expect(invokes).toEqual([{ cmd: "plugin:window|set_cursor_visible", args: { label: "main", value: false } }]);
    await act(async () => window.dispatchEvent(new window.Event("pointermove")));
    expect(invokes.at(-1)).toEqual({ cmd: "plugin:window|set_cursor_visible", args: { label: "main", value: true } });
    const shown = invokes.length;
    await act(async () => window.dispatchEvent(new window.Event("pointermove")));
    expect(invokes).toHaveLength(shown);
    await act(async () => idleHide?.());
    expect(invokes.at(-1)).toEqual({ cmd: "plugin:window|set_cursor_visible", args: { label: "main", value: false } });
    await act(async () => root.unmount());
    expect(invokes.at(-1)).toEqual({ cmd: "plugin:window|set_cursor_visible", args: { label: "main", value: true } });
  } finally {
    timers.mockRestore();
    window.happyDOM.abort();
    for (const [key, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  }
});

function Idle() {
  useIdleCursor(true);
  return null;
}
