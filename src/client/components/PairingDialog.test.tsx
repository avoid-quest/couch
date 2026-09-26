import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { Window } from "happy-dom";
import { act, useRef, useState } from "react";
import type { Root } from "react-dom/client";
import * as session from "@/session/session";
import { screen, fireEvent } from "@/testing";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

let root: Root, window: Window, request: ReturnType<typeof spyOn>;
let sessionMock: ReturnType<typeof spyOn> | undefined;
const originals = new Map<string, PropertyDescriptor | undefined>();
const host = { origin: "http://localhost", token: "host-secret", pairingCode: "123456", urls: ["http://couch.local:4100", "http://192.168.1.10:4100"] };
const button = (label: string) => screen.getByRole("button", { name: label });
const qr = (code = "123456") => screen.queryByRole("img", { name: `Pair another device with code ${code}` });
const flush = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
async function renderDialog(connected = true, info = host) {
  const { PairingDialog } = await import("./PairingDialog");
  await act(async () => root.render(<QueryClientProvider client={queryClient}><PairingDialog credentials={info} urls={info.urls} connected={connected} open onOpenChange={() => {}} /></QueryClientProvider>));
  await flush();
}
beforeEach(async () => {
  window = new Window({ url: "http://localhost" });
  for (const key of ["CSS", "window", "document", "navigator", "location", "history", "localStorage", "sessionStorage", "HTMLElement", "HTMLInputElement", "HTMLButtonElement", "HTMLFormElement", "Element", "Node", "NodeFilter", "DocumentFragment", "MutationObserver", "ResizeObserver", "CustomEvent", "Event", "MouseEvent", "PointerEvent", "KeyboardEvent", "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame", "IS_REACT_ACT_ENVIRONMENT"]) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    const value = key === "IS_REACT_ACT_ENVIRONMENT" ? true : key === "window" ? window : Reflect.get(window, key);
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: typeof value === "function" && /^[a-z]/.test(key) ? value.bind(window) : value });
  }
  request = spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ code: "123456" }));
  const { createRoot } = await import("react-dom/client");
  root = createRoot(document.body.appendChild(document.createElement("div")));
});
afterEach(async () => { queryClient.clear();
  await act(async () => { root.unmount(); await new Promise(resolve => setTimeout(resolve, 0)); });
  sessionMock?.mockRestore(); sessionMock = undefined; request.mockRestore();
  await window.happyDOM.abort();
  for (const [key, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  originals.clear();
});

test("native shortcut renders a pairing QR and matching visible code", async () => {
  await renderDialog();
  expect(qr()).not.toBeNull();
  expect(screen.getByText("123456")).toBeDefined();
  expect(screen.getAllByRole("link").map((link: HTMLAnchorElement) => link.href)).toEqual(host.urls.map(url => `${url}/`));
  expect(button("Close")).toBeDefined();
  expect(screen.queryByText(host.token)).toBeNull();
  expect(request.mock.calls[0]?.[0]).toBe("http://localhost/api/controllers/pairing-code");
  expect(new Headers(request.mock.calls[0]?.[1]?.headers).get("Authorization")).toBe(`Bearer ${host.token}`);
});

test("loading, failure and retry retain manual recovery without an address-only QR", async () => {
  let resolve!: (response: Response) => void;
  request.mockImplementation(() => new Promise(done => { resolve = done; }));
  await renderDialog();
  expect(qr()).toBeNull(); expect(screen.getByText("Loading…")).toBeDefined();
  expect(button("Close")).toBeDefined();
  await act(async () => resolve(Response.json({ error: "Unavailable" }, { status: 503 }))); await flush();
  expect(qr()).toBeNull(); expect(screen.getByRole("alert").textContent).toContain("Couldn't load the code.");
  request.mockResolvedValue(Response.json({ code: "123456" }));
  await act(async () => button("Try again").click()); await flush();
  expect(qr()).not.toBeNull();
});

test("disconnect removes a valid QR, ignores late responses and reconnect fetches again", async () => {
  await renderDialog(); expect(qr()).not.toBeNull();
  await renderDialog(false); expect(qr()).toBeNull();
  expect(screen.getByRole("status").textContent).toContain("Offline. Reconnecting to Couch…");
  let resolve!: (response: Response) => void;
  request.mockImplementation(() => new Promise(done => { resolve = done; }));
  await renderDialog(); expect(qr()).toBeNull();
  const signal = request.mock.calls.at(-1)?.[1]?.signal;
  await renderDialog(false);
  expect(signal?.aborted).toBe(true);
  await act(async () => resolve(Response.json({ code: "654321" }))); await flush();
  expect(qr()).toBeNull();
  request.mockResolvedValue(Response.json({ code: "123456" }));
  await renderDialog(); expect(qr()).not.toBeNull();
});

test("no advertised address leaves Close and manual recovery available", async () => {
  await renderDialog(true, { ...host, urls: [] });
  expect(qr()).toBeNull(); expect(request).not.toHaveBeenCalled();
  expect(screen.getByRole("status").textContent).toContain("No network. Connect Couch to Wi-Fi or Ethernet.");
  expect(button("Close")).toBeDefined();
});

for (const close of ["Close", "Escape"] as const) test(`${close} restores focus to the native shortcut and reopening refreshes the QR`, async () => {
  const { PairingDialog } = await import("./PairingDialog");
  function Shortcut() {
    const [open, setOpen] = useState(false);
    const openerRef = useRef<HTMLButtonElement>(null);
    return <><button ref={openerRef} className="pair-shortcut" onClick={() => setOpen(true)}>Pair a remote</button><QueryClientProvider client={queryClient}><PairingDialog credentials={host} urls={host.urls} connected open={open} onOpenChange={setOpen} openerRef={openerRef} /></QueryClientProvider></>;
  }
  await act(async () => root.render(<QueryClientProvider client={queryClient}><Shortcut /></QueryClientProvider>));
  expect(request).not.toHaveBeenCalled();
  await act(async () => button("Pair a remote").click()); await flush();
  expect(qr()).not.toBeNull();
  await act(async () => { if (close === "Close") fireEvent.click(button("Close")); else fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape", code: "Escape" }); }); await flush();
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(document.activeElement).toBe(button("Pair a remote"));
  await act(async () => button("Pair a remote").click());
  expect(request).toHaveBeenCalledTimes(2);
});
