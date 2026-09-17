import { afterEach, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { registerAppShellWorker } from "./register-sw";

const originals = new Map<string, PropertyDescriptor | undefined>();

async function workerEnvironment(native: boolean) {
  const window = new Window({ url: native ? "tauri://localhost/" : "http://192.168.1.20:4100/" });
  Object.assign(window, { __COUCH_NATIVE_HOST__: native || undefined });
  for (const key of ["window", "document", "navigator", "location"]) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: key === "window" ? window : Reflect.get(window, key) });
  }
  const registered: unknown[] = [];
  Object.defineProperty(window.navigator, "serviceWorker", { configurable: true, value: { register: async (script: string) => registered.push(script) } });
  const loadListeners: Array<() => void> = [];
  Object.defineProperty(window, "addEventListener", { configurable: true, value: (type: string, listener: () => void) => { if (type === "load") loadListeners.push(listener); } });
  expect(registerAppShellWorker(window.document as unknown as Document)).toBe(!native);
  expect(loadListeners).toHaveLength(!native ? 1 : 0);
  for (const listener of loadListeners) await listener();
  await new Promise(resolve => setTimeout(resolve, 0));
  return registered;
}

test("browser clients register the app shell worker on load; native hosts never do", async () => {
  expect(await workerEnvironment(false)).toEqual(["sw.js"]);
  expect(await workerEnvironment(true)).toEqual([]);
});

afterEach(() => {
  for (const [key, descriptor] of originals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
  originals.clear();
});
