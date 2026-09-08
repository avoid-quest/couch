import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { Window } from "happy-dom";
import { act } from "react";
import type { Root } from "react-dom/client";
import type { StreamingCommunitySettings as Component } from "./StreamingCommunitySettings";

let Settings: typeof Component, root: Root, window: Window, request: ReturnType<typeof spyOn>;
const originals = new Map<string, PropertyDescriptor | undefined>();
const props = { credentials: { origin: "http://localhost", token: "paired" }, connected: true, canManage: true };
const calls: { path: string; method: string; body: unknown }[] = [];
const render = async (changes: Partial<typeof props> = {}) => { await act(async () => { root.render(<Settings {...props} {...changes} />); await new Promise(resolve => setTimeout(resolve, 0)); }); };
beforeEach(async () => {
  window = new Window({ url: "http://localhost" });
  for (const key of ["window", "document", "navigator", "HTMLElement", "HTMLInputElement", "Event", "MouseEvent", "IS_REACT_ACT_ENVIRONMENT"]) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: key === "IS_REACT_ACT_ENVIRONMENT" ? true : key === "window" ? window : (window as unknown as Record<string, unknown>)[key] });
  }
  calls.length = 0;
  request = spyOn(globalThis, "fetch").mockImplementation((async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ path: String(input), method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : null });
    return Response.json({ origin: init?.method === "POST" ? JSON.parse(String(init.body)).origin : "https://streamingcommunityz.taxi" });
  }) as unknown as typeof fetch);
  const { createRoot } = await import("react-dom/client"); ({ StreamingCommunitySettings: Settings } = await import("./StreamingCommunitySettings"));
  root = createRoot(document.body.appendChild(document.createElement("div")));
});
afterEach(async () => {
  await act(async () => root.unmount()); request.mockRestore(); await window.happyDOM.abort();
  for (const [key, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); } originals.clear();
});

test("administrator can save the exact current origin and demotion removes the form", async () => {
  await render();
  const input = document.querySelector("input")!;
  expect(input.value).toBe("https://streamingcommunityz.taxi");
  await act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!.call(input, "https://streamingcommunity.example/");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => { document.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); await new Promise(resolve => setTimeout(resolve, 0)); });
  expect(calls.at(-1)).toMatchObject({ method: "POST", body: { origin: "https://streamingcommunity.example" } });
  expect(document.body.textContent).toContain("saved links keep their original address");
  await render({ canManage: false }); expect(document.querySelector("form")).toBeNull();
  const count = calls.length; await render({ canManage: false }); expect(calls).toHaveLength(count);
});

test("a failed settings read keeps saving disabled and an obsolete reply cannot restore administrator fields", async () => {
  request.mockImplementation((async () => Response.json({ error: "Unavailable" }, { status: 503 })) as unknown as typeof fetch);
  await render(); expect(document.querySelector("button")!.disabled).toBeTrue(); expect(document.querySelector('[role="alert"]')?.textContent).toBe("Unavailable");
  const delayed = Promise.withResolvers<Response>(); request.mockImplementation((() => delayed.promise) as unknown as typeof fetch);
  await render({ connected: false }); await render();
  await render({ canManage: false });
  await act(async () => { delayed.resolve(Response.json({ origin: "https://streamingcommunity.example" })); await new Promise(resolve => setTimeout(resolve, 0)); });
  expect(document.querySelector("form")).toBeNull(); expect(document.body.textContent).not.toContain("https://streamingcommunity.example");
});
