import { setupUiTests, testWindow } from "./testing/react";
import { afterEach, expect, spyOn, test } from "bun:test";
import { registerAppShellWorker } from "./register-sw";

setupUiTests();

for (const ready of ["loading", "complete"] as const) {
  test.each([
    ["http://localhost:4100/settings/connection", true, false, true],
    ["https://couch.example/saved", true, false, true],
    ["http://192.168.1.20:4100/find", false, false, false],
    ["tauri://localhost/", true, true, false],
  ] as const)(`worker registration from %s when document is ${ready}`, async (url, secure, native, allowed) => {
    testWindow.happyDOM.setURL(url);
    Object.assign(window, { __COUCH_NATIVE_HOST__: native || undefined });
    Object.defineProperty(window, "isSecureContext", { configurable: true, value: secure });
    Object.defineProperty(window.document, "readyState", { configurable: true, value: ready });
    const registered: unknown[] = [];
    Object.defineProperty(window.navigator, "serviceWorker", { configurable: true, value: {
      register: async (script: string, options: RegistrationOptions) => { registered.push([script, options]); },
    } });
    const loadListeners: Array<() => void> = [];
    spyOn(window, "addEventListener").mockImplementation((type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions) => {
      if (type === "load") { expect(options).toEqual({ once: true }); loadListeners.push(listener as () => void); }
    });
    expect(registerAppShellWorker(window.document as unknown as Document)).toBe(allowed);
    expect(loadListeners).toHaveLength(allowed && ready === "loading" ? 1 : 0);
    for (const listener of loadListeners) listener();
    await Promise.resolve();
    expect(registered).toEqual(allowed ? [["/sw.js", { scope: "/" }]] : []);
  });
}

afterEach(() => {
  Reflect.deleteProperty(window, "isSecureContext");
  Reflect.deleteProperty(document, "readyState");
  Reflect.deleteProperty(navigator, "serviceWorker");
});
