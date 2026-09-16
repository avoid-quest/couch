import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { Window } from "happy-dom";
import { act } from "react";
import type { Root } from "react-dom/client";
import type { RadioStation } from "../shared/radio";

let root: Root, window: Window, request: ReturnType<typeof spyOn>;
const originals = new Map<string, PropertyDescriptor | undefined>();
const station: RadioStation = { id: "station", name: "Evening radio", url: "https://radio.example/stream", homepage: null, countryCode: "IT", codec: "MP3", bitrate: 128 };
let catalogueFailures = 0;
const flush = () => act(async () => { await Bun.sleep(20); });
async function render() {
  const { LiveNow } = await import("./LiveNow");
  await act(async () => root.render(<LiveNow origin="http://localhost" token="paired" connected canPlay version={1} onEnqueue={async () => true} />));
  await flush();
}
beforeEach(async () => {
  catalogueFailures = 0;
  window = new Window({ url: "http://localhost" });
  for (const key of ["CSS", "window", "document", "navigator", "HTMLElement", "HTMLInputElement", "HTMLButtonElement", "Element", "Node", "NodeFilter", "DocumentFragment", "MutationObserver", "ResizeObserver", "CustomEvent", "Event", "MouseEvent", "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame", "IS_REACT_ACT_ENVIRONMENT"]) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    const value = key === "IS_REACT_ACT_ENVIRONMENT" ? true : key === "window" ? window : Reflect.get(window, key);
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: typeof value === "function" && /^[a-z]/.test(key) ? value.bind(window) : value });
  }
  request = spyOn(globalThis, "fetch").mockImplementation((async (input: RequestInfo | URL) => {
    const path = new URL(String(input)).pathname;
    if (path === "/api/radio/avoid" && catalogueFailures > 0) { catalogueFailures -= 1; return new Response(JSON.stringify({ error: "catalogue unavailable" }), { status: 503 }); }
    if (path === "/api/radio/avoid") return Response.json({ playlist: { error: null }, stations: [station] });
    if (path === "/api/radio/avoid/programmes") return Response.json({ programmes: {} });
    throw new Error(`Unexpected request: ${path}`);
  }) as typeof fetch);
  const { createRoot } = await import("react-dom/client");
  root = createRoot(document.body.appendChild(document.createElement("div")));
});
afterEach(async () => {
  await act(async () => root.unmount());
  request.mockRestore();
  for (const [key, descriptor] of originals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else delete (globalThis as Record<string, unknown>)[key];
  }
  originals.clear();
});
test("a failed catalogue load offers a retry that reloads it", async () => {
  catalogueFailures = 1;
  await render();
  const alert = () => document.querySelector("[role=alert]")?.textContent ?? "";
  expect(alert()).toContain("catalogue unavailable");
  const retry = [...document.querySelectorAll("button")].find(node => node.textContent === "Retry")!;
  await act(async () => retry.click());
  await flush();
  expect(alert()).toBe("");
  expect(document.body.textContent).toContain("Evening radio");
});
