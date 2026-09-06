import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { Window } from "happy-dom";
import { act } from "react";
import type { Root } from "react-dom/client";
import type { Diagnostics } from "../shared/diagnostics";
let AdvancedSettings: typeof import("./AdvancedSettings").AdvancedSettings;

let root: Root, window: Window;
const originals = new Map<string, PropertyDescriptor | undefined>();
let request: ReturnType<typeof spyOn>;
const calls: { url: string; signal: AbortSignal }[] = [];
const report: Diagnostics = {
  formatVersion: 1, collectedAt: "2026-09-06T12:00:00Z", collectionMs: 2,
  build: { version: "0.1.0", revision: "abcdef1", target: "x86_64-unknown-linux-gnu", packaged: true },
  system: [{ name: "Available storage", value: null, source: "Filesystem unavailable" }],
  native: null, nativeError: "Native host is not connected.", helpers: [], configuration: [], sources: [], recent: [],
  limits: { recentEntries: 80, messageCharacters: 500, exportBytes: 131072, snapshotSeconds: 5, helperSeconds: 300 },
};
const button = (label: string) => [...document.querySelectorAll("button")].find(node => node.textContent === label)!;
const render = async (connected = true, token = "admin") => act(async () => root.render(<AdvancedSettings credentials={{ origin: "http://localhost", token }} connected={connected} />));

beforeEach(async () => {
  window = new Window({ url: "http://localhost" }); calls.length = 0;
  for (const key of ["window", "document", "navigator", "HTMLElement", "Element", "Node", "MutationObserver", "Event", "MouseEvent", "IS_REACT_ACT_ENVIRONMENT"]) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: key === "IS_REACT_ACT_ENVIRONMENT" ? true : key === "window" ? window : Reflect.get(window, key) });
  }
  request = spyOn(globalThis, "fetch").mockImplementation((async (input: RequestInfo | URL, init: RequestInit) => {
    calls.push({ url: String(input), signal: init.signal! });
    expect(init.headers).toEqual({ Authorization: "Bearer admin" });
    return Response.json(report);
  }) as typeof fetch);
  ({ AdvancedSettings } = await import("./AdvancedSettings"));
  const { createRoot } = await import("react-dom/client");
  const container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount()); request.mockRestore(); window.happyDOM.abort();
  for (const [key, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  originals.clear();
});

test("Advanced loads a read-only snapshot with honest unknown and disconnected player details", async () => {
  await render();
  expect(calls.map(call => call.url)).toEqual(["http://localhost/api/diagnostics"]);
  expect(document.body.textContent).toContain("Unknown");
  expect(document.body.textContent).toContain("Native host is not connected.");
  expect(document.body.textContent).toContain("abcdef1");
  expect(document.body.textContent).toContain("No recent errors recorded.");
  expect(button("Export diagnostics").disabled).toBe(false);
  await render(false);
  expect(document.body.textContent).not.toContain("abcdef1");
  expect(button("Export diagnostics").disabled).toBe(true);
  expect(calls).toHaveLength(1);
});

test("export only starts after a click and reports failure without echoing a credential-bearing URL", async () => {
  await render();
  request.mockRejectedValue(new Error("https://user:secret@host/private"));
  await act(async () => button("Export diagnostics").click());
  expect(document.body.textContent).toContain("Could not export diagnostics.");
  expect(document.body.textContent).not.toContain("secret");
  expect(button("Export diagnostics").disabled).toBe(false);
});

test("successful export downloads the bounded server response with a fixed filename", async () => {
  await render();
  let filename = "";
  const click = spyOn(window.HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) { filename = this.download; });
  try {
    await act(async () => button("Export diagnostics").click());
    expect(calls.map(call => call.url)).toEqual(["http://localhost/api/diagnostics", "http://localhost/api/diagnostics/export"]);
    expect(filename).toBe("couch-diagnostics.json");
    expect(document.body.textContent).toContain("Diagnostic download started.");
  } finally { click.mockRestore(); }
});

test("disconnect aborts an in-flight snapshot and ignores its late response", async () => {
  const gate = Promise.withResolvers<Response>();
  let signal: AbortSignal | undefined;
  request.mockImplementation((async (_input, init) => { signal = init?.signal as AbortSignal; return gate.promise; }) as typeof fetch);
  await render(); await render(false);
  expect(signal!.aborted).toBe(true);
  await act(async () => gate.resolve(Response.json(report)));
  expect(document.body.textContent).not.toContain("abcdef1");
  expect(document.body.textContent).toContain("Connect to the TV");
});


test("leaving Advanced aborts an export and prevents a late download", async () => {
  await render();
  const gate = Promise.withResolvers<Response>();
  let signal: AbortSignal | undefined;
  request.mockImplementation((async (_input, init) => { signal = init?.signal as AbortSignal; return gate.promise; }) as typeof fetch);
  const click = spyOn(window.HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  try {
    await act(async () => button("Export diagnostics").click());
    await act(async () => root.render(null));
    expect(signal!.aborted).toBe(true);
    await act(async () => gate.resolve(Response.json(report)));
    expect(click).not.toHaveBeenCalled();
  } finally { click.mockRestore(); }
});
