import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { Window } from "happy-dom";
import { act } from "react";
import type { Root } from "react-dom/client";
import { fireEvent, screen } from "@/testing";

let window: Window, root: Root, request: ReturnType<typeof spyOn>;
const originals = new Map<string, PropertyDescriptor | undefined>();

beforeEach(async () => {
  window = new Window({ url: "http://localhost" });
  for (const key of ["window", "document", "navigator", "HTMLElement", "Element", "Node", "Event", "localStorage", "IS_REACT_ACT_ENVIRONMENT"]) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: key === "IS_REACT_ACT_ENVIRONMENT" ? true : key === "window" ? window : Reflect.get(window, key) });
  }
  request = spyOn(globalThis, "fetch").mockImplementation((async () => Response.json({})) as unknown as typeof fetch);
  const { createRoot } = await import("react-dom/client");
  root = createRoot(document.body.appendChild(document.createElement("div")));
});

afterEach(async () => {
  await act(async () => root.unmount());
  request.mockRestore();
  await window.happyDOM.abort();
  for (const [key, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  originals.clear();
});

test("desktop size changes this client without touching the selected host's TV size", async () => {
  const { AppearanceSettings } = await import("./AppearanceSettings");
  await act(async () => root.render(<AppearanceSettings scope="device" tvPresentation={false} credentials={{ origin: "http://localhost", token: "admin" }} connected administrator />));
  expect(screen.queryByRole("group", { name: "TV interface size" })).toBeNull();
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Larger" })));
  expect(screen.getByRole("button", { name: "Larger" }).getAttribute("aria-pressed")).toBe("true");
  expect(localStorage.getItem("couch.remote-interface-size")).toBe("1.15");
  expect(request).not.toHaveBeenCalled();
});

test("TV presentation keeps its preview request separate from client storage", async () => {
  const { AppearanceSettings } = await import("./AppearanceSettings");
  await act(async () => root.render(<AppearanceSettings scope="device" tvPresentation credentials={{ origin: "http://localhost", token: "admin" }} connected administrator />));
  expect(screen.queryByRole("group", { name: "This client interface size" })).toBeNull();
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Larger" })));
  expect(request).toHaveBeenCalledTimes(1);
  expect((request.mock.calls[0] as unknown[])[0]).toBe("http://localhost/api/appearance");
  expect(localStorage.getItem("couch.remote-interface-size")).toBeNull();
});
