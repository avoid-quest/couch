import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { Window } from "happy-dom";
import { act, useState } from "react";
import type { Root } from "react-dom/client";
import * as session from "./session";

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
  for (const key of ["CSS", "window", "document", "navigator", "location", "history", "localStorage", "sessionStorage", "HTMLElement", "HTMLInputElement", "HTMLButtonElement", "HTMLFormElement", "Element", "Node", "NodeFilter", "DocumentFragment", "MutationObserver", "ResizeObserver", "CustomEvent", "Event", "MouseEvent", "PointerEvent", "KeyboardEvent", "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame", "scrollTo", "IS_REACT_ACT_ENVIRONMENT"]) {
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

async function renderPhone(token?: string) {
  window.history.replaceState(null, "", "/#pair=123456");
  if (token) { localStorage.setItem("couch.remote-token", token); localStorage.setItem("couch.remote-installation-id", "living-room"); }
  sessionMock = spyOn(session, "useSession").mockImplementation(credentials => ({
    state: credentials ? { activeProfile: { id: "household", name: "Household", createdAt: 1 }, queue: [], currentEntryId: null, administratorClaimed: true, setupStep: "complete", player: { playbackId: null, status: "idle", position: 0, duration: 0, volume: 30, seekable: false, error: null } } : null,
    status: credentials ? "connected" : "pairing-required", details: null, identity: credentials ? { authority: "controller", controller: { id: "phone", name: "Guest phone", role: "controller", createdAt: 1, lastSeenAt: 1 }, claimAvailable: false } : null,
    playerStatus: undefined, pairingRequired: !credentials, reachable: true, connected: !!credentials, command: async () => {}, reconnect: () => {},
  }));
  const { App } = await import("./App");
  const { RouterProvider, createBrowserHistory, createRouter } = await import("@tanstack/react-router");
  const { routeTree } = await import("./routeTree.gen");
  const router = createRouter({ routeTree, history: createBrowserHistory(), scrollRestoration: false });
  await act(async () => root.render(<RouterProvider router={router} />));
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); });
}
const submit = () => act(async () => { document.querySelector("form.pair-form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
const input = (id: string, value: string) => act(async () => {
  const node = document.querySelector<HTMLInputElement>(id)!;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(node, value);
  node.dispatchEvent(new Event("input", { bubbles: true }));
});

test("the QR opens the actual phone form with its code, then device submission reaches the session", async () => {
  await renderPhone();
  expect(document.querySelector<HTMLInputElement>("#pairing-code")?.value).toBe("123456");
  expect(document.activeElement?.id).toBe("remote-name"); expect(location.hash).toBe("");
  await input("#remote-name", "Guest phone");
  request.mockImplementation((async (url, init) => {
    if (String(url).endsWith("/api/pair")) {
      expect(JSON.parse(String(init?.body))).toEqual({ code: "123456", name: "Guest phone" });
      return Response.json({ token: "new-controller", installationId: "living-room" });
    }
    if (String(url).endsWith("/api/radio/avoid")) return Response.json({ playlist: { error: null }, stations: [] });
    return Response.json({ items: [], favorites: [] });
  }) as typeof fetch);
  await submit();
  expect(localStorage.getItem("couch.remote-token")).toBe("new-controller");
  expect(localStorage.getItem("couch.remote-installation-id")).toBe("living-room");
  expect(sessionMock?.mock.calls.at(-1)?.[0]).toEqual({ origin: "http://localhost", token: "new-controller", installationId: "living-room" });
  expect(document.querySelector(".pair-form")).toBeNull();
  expect(document.querySelector('[data-page="Now"]')).not.toBeNull();
  expect(document.querySelector(".controller-name")?.textContent).toBe("Guest phone");
});

test("stale codes and failed connections keep the name, editable code and Connect retry", async () => {
  await renderPhone(); await input("#remote-name", "Guest phone");
  request.mockResolvedValue(Response.json({ error: "The pairing code is incorrect." }, { status: 401 }));
  await submit();
  expect(document.body.textContent).toContain("Scan the QR again or enter the code currently shown on the playback computer");
  expect(document.querySelector<HTMLInputElement>("#remote-name")?.value).toBe("Guest phone");
  expect(button("Connect").disabled).toBe(false);
  await input("#pairing-code", "654321");
  request.mockRejectedValue(new TypeError("Failed to fetch"));
  await submit();
  expect(document.body.textContent).toContain("same network, then try Connect again");
  expect(document.querySelector<HTMLInputElement>("#pairing-code")?.value).toBe("654321");
  expect(button("Connect").disabled).toBe(false);
  expect(localStorage.getItem("couch.remote-token")).toBeNull();
});

test("scanning on an already paired browser preserves its stored pairing", async () => {
  request.mockImplementation((async url => String(url).endsWith("/api/radio/avoid") ? Response.json({ playlist: { error: null }, stations: [] }) : Response.json({ items: [], favorites: [] })) as typeof fetch);
  await renderPhone("existing-controller");
  expect(document.querySelector(".pair-form")).toBeNull();
  expect(localStorage.getItem("couch.remote-token")).toBe("existing-controller");
  expect(localStorage.getItem("couch.remote-installation-id")).toBe("living-room");
  expect(request.mock.calls.some((call: Parameters<typeof fetch>) => String(call[0]).endsWith("/api/pair"))).toBe(false);
});
