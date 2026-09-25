import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as core from "@tauri-apps/api/core";
import { Window } from "happy-dom";
import { act } from "react";
import type { Root } from "react-dom/client";
import { toast } from "sonner";
import { fireEvent, screen } from "@/testing";

const lastToast = () => { const item = toast.getToasts().at(-1); return item && "title" in item ? item.title : undefined; };
import type { Diagnostics } from "../../../../shared/diagnostics";

const report: Diagnostics = {
  formatVersion: 2, sessionId: "session", sessionStartedAt: "2026-09-23T10:00:00Z", historyError: null,
  collectedAt: "2026-09-23T10:00:00Z", collectionMs: 1,
  build: { version: "test", revision: "revision", target: "mac", packaged: false },
  system: [], native: null, nativeError: null, helpers: [], configuration: [], sources: [], recent: [],
  limits: { recentEntries: 80, retentionDays: 7, historyBytes: 65536, messageCharacters: 500, exportBytes: 131072, snapshotSeconds: 5, helperSeconds: 300 },
};
const bytes = new TextEncoder().encode(JSON.stringify(report));
const originals = new Map<string, PropertyDescriptor | undefined>();
let window: Window, root: Root, request: ReturnType<typeof spyOn>, invoke: ReturnType<typeof spyOn>;
let saveResult: boolean | string, denied: boolean, interrupted: boolean;
const flush = () => act(async () => { await Bun.sleep(20); });

beforeEach(async () => {
  window = new Window({ url: "http://tauri.localhost" });
  Object.assign(window, { __COUCH_NATIVE_HOST__: true });
  for (const key of ["window", "document", "navigator", "location", "HTMLElement", "HTMLButtonElement", "Element", "Node", "DocumentFragment", "MutationObserver", "ResizeObserver", "Event", "MouseEvent", "getComputedStyle", "IS_REACT_ACT_ENVIRONMENT"]) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    const value = key === "IS_REACT_ACT_ENVIRONMENT" ? true : key === "window" ? window : Reflect.get(window, key);
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  saveResult = true; denied = false; interrupted = false;
  invoke = spyOn(core, "invoke").mockImplementation(async <T,>(): Promise<T> => {
    if (typeof saveResult === "string") throw saveResult;
    return saveResult as T;
  });
  request = spyOn(globalThis, "fetch").mockImplementation((async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.pathname === "/api/diagnostics/export") {
      expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer selected-token");
      if (denied) return Response.json({ error: "Administrator access is no longer available." }, { status: 403 });
      if (interrupted) return new Response(new ReadableStream({ start(controller) { controller.error(new Error("Transfer interrupted")); } }));
      return new Response(bytes, { headers: { "Content-Type": "application/json" } });
    }
    if (url.pathname === "/api/diagnostics") return Response.json(report);
    return Response.json({ error: "Unavailable" }, { status: 503 });
  }) as typeof fetch);
  const { createRoot } = await import("react-dom/client");
  root = createRoot(document.body.appendChild(document.createElement("div")));
});

afterEach(async () => {
  await act(async () => root.unmount());
  toast.dismiss(); request.mockRestore(); invoke.mockRestore();
  await window.happyDOM.abort();
  for (const [key, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  originals.clear();
});

async function render(origin = "http://local-installation") {
  const { AdvancedSettings } = await import("./AdvancedSettings");
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => root.render(<QueryClientProvider client={client}><AdvancedSettings credentials={{ origin, token: "selected-token" }} connected /></QueryClientProvider>));
  await flush();
  await screen.findByRole("button", { name: "Export" });
}

async function save(label = "Export") {
  await act(async () => fireEvent.click(screen.getByRole("button", { name: label })));
  await flush();
}

test("local owner saves the selected installation's sanitized JSON", async () => {
  await render(); await save();
  expect((request.mock.calls as Array<[RequestInfo | URL]>).some(call => String(call[0]) === "http://local-installation/api/diagnostics/export")).toBe(true);
  expect(invoke).toHaveBeenCalledWith("save_diagnostics_export", bytes);
  expect(JSON.parse(new TextDecoder().decode(invoke.mock.calls[0]?.[1] as Uint8Array))).toEqual(report);
  expect(lastToast()).toBe("Exported.");
});

test("bundled remote Administrator saves the selected remote installation", async () => {
  await render("http://selected-remote:4100"); await save();
  expect((request.mock.calls as Array<[RequestInfo | URL]>).some(call => String(call[0]) === "http://selected-remote:4100/api/diagnostics/export")).toBe(true);
  expect(invoke).toHaveBeenCalledWith("save_diagnostics_export", bytes);
});

test("cancel and denied destination give distinct feedback", async () => {
  saveResult = false;
  await render(); await save();
  expect(lastToast()).toBe("Canceled.");
  saveResult = "Could not save the diagnostics report: Permission denied. No complete file was saved.";
  await save();
  expect(screen.getByText(/Permission denied/)).toBeDefined();
});

test("revoked Administrator access and interrupted transfers never open the save dialog", async () => {
  denied = true;
  await render(); await save();
  expect(screen.getByText(/Administrator access is no longer available/)).toBeDefined();
  expect(invoke).not.toHaveBeenCalled();
  denied = false; interrupted = true;
  await save();
  expect(screen.getByText("Export interrupted. Nothing saved.")).toBeDefined();
  expect(invoke).not.toHaveBeenCalled();
});

test("browser retains a JSON download", async () => {
  Object.assign(window, { __COUCH_NATIVE_HOST__: undefined });
  const create = spyOn(URL, "createObjectURL").mockReturnValue("blob:diagnostics");
  const click = spyOn(window.HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  try {
    await render(); await save();
    expect(create).toHaveBeenCalledTimes(1);
    expect(click).toHaveBeenCalledTimes(1);
    expect(invoke).not.toHaveBeenCalled();
    expect(lastToast()).toBe("Downloaded.");
  } finally {
    create.mockRestore(); click.mockRestore();
  }
});
