import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { Window } from "happy-dom";
import { act } from "react";
import type { Root } from "react-dom/client";
import { useSession, type Credentials } from "./session";
import { rememberConnection } from "./connection";

let root: Root, window: Window, request: ReturnType<typeof spyOn>;
const originals = new Map<string, PropertyDescriptor | undefined>();
function Remote({ credentials }: { credentials: Credentials | null }) {
  const { status } = useSession(credentials);
  return <output>{status}</output>;
}

beforeEach(async () => {
  window = new Window({ url: "http://192.168.1.20:4100" });
  for (const key of ["window", "document", "navigator", "location", "localStorage", "sessionStorage", "IS_REACT_ACT_ENVIRONMENT"]) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: key === "IS_REACT_ACT_ENVIRONMENT" ? true : key === "window" ? window : Reflect.get(window, key) });
  }
  request = spyOn(globalThis, "fetch").mockRejectedValue(new Error("Selected computer is offline"));
  const { createRoot } = await import("react-dom/client");
  root = createRoot(document.body.appendChild(document.createElement("div")));
});
afterEach(async () => {
  await act(async () => root.unmount());
  request.mockRestore();
  await window.happyDOM.abort();
  for (const [key, descriptor] of originals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
  originals.clear();
});

test("an unavailable target never sends its pairing to advertised aliases", async () => {
  rememberConnection(location.origin, { name: "Living room", player: "idle", urls: ["http://192.168.1.99:4100"] });
  await act(async () => root.render(<Remote credentials={{ origin: location.origin, token: "paired-only-here" }} />));
  expect(request).toHaveBeenCalledTimes(1);
  expect(String(request.mock.calls[0]![0])).toStartWith(location.origin + "/api/");
  expect(new Headers(request.mock.calls[0]![1]?.headers).has("Authorization")).toBe(false);
  expect(document.querySelector("output")?.textContent).toBe("server-unavailable");
});

test("an unpaired page checks its own origin despite cached connection addresses", async () => {
  rememberConnection("http://192.168.1.99:4100", { name: "Old address", player: "idle", urls: ["http://192.168.1.98:4100"] });
  await act(async () => root.render(<Remote credentials={null} />));
  expect(request).toHaveBeenCalledTimes(1);
  expect(request.mock.calls[0]![0]).toBe(location.origin + "/api/connection");
  expect(new Headers(request.mock.calls[0]![1]?.headers).has("Authorization")).toBe(false);
});


test("a replaced installation at the same origin requires pairing before any credential is sent", async () => {
  request.mockImplementation(async () => Response.json({ name: "Different Couch", player: "idle", urls: [location.origin], installationId: "different-installation" }));
  await act(async () => root.render(<Remote credentials={{ origin: location.origin, token: "old-pairing", installationId: "remembered-installation" }} />));
  expect(document.querySelector("output")?.textContent).toBe("pairing-required");
  expect(request.mock.calls.length).toBeGreaterThan(0);
  for (const [url, options] of request.mock.calls) {
    expect(url).toBe(location.origin + "/api/connection");
    expect(new Headers(options?.headers).has("Authorization")).toBe(false);
  }
});
