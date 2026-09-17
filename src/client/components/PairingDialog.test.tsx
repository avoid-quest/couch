import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { Window } from "happy-dom";
import { act, useState } from "react";
import type { Root } from "react-dom/client";
import * as session from "@/session/session";

let root: Root, window: Window, request: ReturnType<typeof spyOn>;
let sessionMock: ReturnType<typeof spyOn> | undefined;
const originals = new Map<string, PropertyDescriptor | undefined>();
const host = { origin: "http://localhost", token: "host-secret", pairingCode: "123456", urls: ["http://couch.local:4100", "http://192.168.1.10:4100"] };
const button = (label: string) => [...document.querySelectorAll<HTMLButtonElement>("button")].find(node => node.textContent === label)!;
const qr = () => document.querySelector("svg:has(title)");
const flush = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
async function renderDialog(connected = true, info = host) {
  const { PairingDialog } = await import("./PairingDialog");
  await act(async () => root.render(<PairingDialog host={info} connected={connected} open onOpenChange={() => {}} />));
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
afterEach(async () => {
  await act(async () => { root.unmount(); await new Promise(resolve => setTimeout(resolve, 0)); });
  sessionMock?.mockRestore(); sessionMock = undefined; request.mockRestore();
  await window.happyDOM.abort();
  for (const [key, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  originals.clear();
});

test("native shortcut renders the advertised pairing QR, manual addresses/code and visible Close", async () => {
  await renderDialog();
  const { QRCodeSVG } = await import("qrcode.react");
  const { renderToStaticMarkup } = await import("react-dom/server");
  const expected = document.createElement("div");
  expected.innerHTML = renderToStaticMarkup(<QRCodeSVG value="http://couch.local:4100/#pair=123456" size={160} marginSize={4} level="M" />);
  expect([...qr()!.querySelectorAll("path")].map(path => path.getAttribute("d"))).toEqual([...expected.querySelectorAll("path")].map(path => path.getAttribute("d")));
  expect([...document.querySelectorAll<HTMLAnchorElement>(".address-list a")].map(a => a.href)).toEqual(host.urls.map(url => `${url}/`));
  expect(document.querySelector(".pairing-display strong")?.textContent).toBe("123456");
  expect(button("Close")).toBeDefined();
  expect(button("Close").querySelector(".sr-only")).toBeNull();
  expect(document.body.innerHTML).not.toContain(host.token);
  expect(request.mock.calls[0]?.[0]).toBe("http://localhost/api/controllers/pairing-code");
  expect(new Headers(request.mock.calls[0]?.[1]?.headers).get("Authorization")).toBe(`Bearer ${host.token}`);
});

test("loading, failure and retry retain manual recovery without an address-only QR", async () => {
  let resolve!: (response: Response) => void;
  request.mockImplementation(() => new Promise(done => { resolve = done; }));
  await renderDialog();
  expect(qr()).toBeNull(); expect(document.body.textContent).toContain("Loading pairing QR");
  expect(button("Close")).toBeDefined();
  await act(async () => resolve(Response.json({ error: "Unavailable" }, { status: 503 })));
  expect(qr()).toBeNull(); expect(document.body.textContent).toContain("Use the address and TV code");
  expect(document.querySelector(".pairing-display strong")?.textContent).toBe("123456");
  request.mockResolvedValue(Response.json({ code: "123456" }));
  await act(async () => button("Retry pairing QR").click());
  expect(qr()).not.toBeNull();
});

test("disconnect removes a valid QR, ignores late responses and reconnect fetches again", async () => {
  await renderDialog(); expect(qr()).not.toBeNull();
  await renderDialog(false); expect(qr()).toBeNull();
  expect(document.body.textContent).toContain("Reconnecting to the TV");
  let resolve!: (response: Response) => void;
  request.mockImplementation(() => new Promise(done => { resolve = done; }));
  await renderDialog(); expect(qr()).toBeNull();
  const signal = request.mock.calls.at(-1)?.[1]?.signal;
  await renderDialog(false);
  expect(signal?.aborted).toBe(true);
  await act(async () => resolve(Response.json({ code: "654321" })));
  expect(qr()).toBeNull();
  request.mockResolvedValue(Response.json({ code: "123456" }));
  await renderDialog(); expect(qr()).not.toBeNull();
});

test("no advertised address leaves Close and manual recovery available", async () => {
  await renderDialog(true, { ...host, urls: [] });
  expect(qr()).toBeNull(); expect(request).not.toHaveBeenCalled();
  expect(document.body.textContent).toContain("Connect the TV to the network");
  expect(button("Close")).toBeDefined();
});

test("closing restores focus to the native shortcut and reopening refreshes the QR", async () => {
  const { PairingDialog } = await import("./PairingDialog");
  function Shortcut() {
    const [open, setOpen] = useState(false);
    return <><button className="pair-shortcut" onClick={() => setOpen(true)}>Pair a remote</button><PairingDialog host={host} connected open={open} onOpenChange={setOpen} /></>;
  }
  await act(async () => root.render(<Shortcut />));
  expect(request).not.toHaveBeenCalled();
  await act(async () => button("Pair a remote").click());
  expect(qr()).not.toBeNull();
  await act(async () => button("Close").click()); await flush();
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(document.activeElement).toBe(button("Pair a remote"));
  await act(async () => button("Pair a remote").click());
  expect(request).toHaveBeenCalledTimes(2);
});
