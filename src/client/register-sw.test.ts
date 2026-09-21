import { afterEach, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { registerAppShellWorker } from "./register-sw";

const originals = new Map<string, PropertyDescriptor | undefined>();
let window: Window | undefined;

for (const ready of ["loading", "complete"] as const) {
  test.each([
    ["http://localhost:4100/settings/connection", true, false, true],
    ["https://couch.example/saved", true, false, true],
    ["http://192.168.1.20:4100/find", false, false, false],
    ["tauri://localhost/", true, true, false],
  ] as const)(`worker registration from %s when document is ${ready}`, async (url, secure, native, allowed) => {
    window = new Window({ url });
    Object.assign(window, { __COUCH_NATIVE_HOST__: native || undefined });
    Object.defineProperty(window, "isSecureContext", { configurable: true, value: secure });
    Object.defineProperty(window.document, "readyState", { configurable: true, value: ready });
    for (const key of ["window", "document", "navigator", "location"]) {
      originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
      Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: key === "window" ? window : Reflect.get(window, key) });
    }
    const registered: unknown[] = [];
    Object.defineProperty(window.navigator, "serviceWorker", { configurable: true, value: {
      register: async (script: string, options: RegistrationOptions) => { registered.push([script, options]); },
    } });
    const loadListeners: Array<() => void> = [];
    Object.defineProperty(window, "addEventListener", { configurable: true, value: (type: string, listener: () => void, options: AddEventListenerOptions) => {
      if (type === "load") { expect(options.once).toBe(true); loadListeners.push(listener); }
    } });
    expect(registerAppShellWorker(window.document as unknown as Document)).toBe(allowed);
    expect(loadListeners).toHaveLength(allowed && ready === "loading" ? 1 : 0);
    for (const listener of loadListeners) listener();
    await Promise.resolve();
    expect(registered).toEqual(allowed ? [["/sw.js", { scope: "/" }]] : []);
  });
}

afterEach(async () => {
  await window?.happyDOM.abort();
  window = undefined;
  for (const [key, descriptor] of originals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
  originals.clear();
});
