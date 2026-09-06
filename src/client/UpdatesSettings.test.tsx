import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { Window } from "happy-dom";
import { act } from "react";
import type { Root } from "react-dom/client";
import type { UpdateState } from "../shared/updates";
let UpdatesSettings: typeof import("./UpdatesSettings")["UpdatesSettings"];

let root: Root, window: Window, request: ReturnType<typeof spyOn>;
const originals = new Map<string, PropertyDescriptor | undefined>();
const calls: { url: string; body: unknown; signal: AbortSignal }[] = [];
let report: UpdateState;
const button = (label: string) => [...document.querySelectorAll("button")].find(node => node.textContent === label)!;
const render = async (connected = true) => act(async () => root.render(<UpdatesSettings credentials={{ origin: "http://localhost", token: "admin" }} connected={connected} />));
beforeEach(async () => {
  report = { channel: "stable", policy: "manual", running: { version: "0.1.0+build.1.1", revision: "abc123" }, status: "available", currentCheck: true, lastSuccessfulCheck: Date.now(), candidate: { id: "a".repeat(64), version: "0.1.0+build.2.1", revision: "def456", releaseId: "2.1", notes: "Second release notes", bytes: 5_000_000, publishedAt: Date.now(), expiresAt: Date.now() + 60_000 }, error: null };
  calls.length = 0; window = new Window({ url: "http://localhost" });
  for (const key of ["window", "document", "navigator", "HTMLElement", "HTMLInputElement", "HTMLSelectElement", "HTMLButtonElement", "HTMLFormElement", "Element", "Node", "NodeFilter", "DocumentFragment", "MutationObserver", "ResizeObserver", "CustomEvent", "Event", "MouseEvent", "PointerEvent", "KeyboardEvent", "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame", "IS_REACT_ACT_ENVIRONMENT"]) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    const value = key === "IS_REACT_ACT_ENVIRONMENT" ? true : key === "window" ? window : Reflect.get(window, key);
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: typeof value === "function" && /^[a-z]/.test(key) ? value.bind(window) : value });
  }
  request = spyOn(globalThis, "fetch").mockImplementation((async (input, init) => {
    calls.push({ url: String(input), body: init?.body ? JSON.parse(String(init.body)) : undefined, signal: init?.signal as AbortSignal });
    expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer admin");
    return Response.json(report);
  }) as typeof fetch);
  const { createRoot } = await import("react-dom/client");
  ({ UpdatesSettings } = await import("./UpdatesSettings"));
  const container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount()); request.mockRestore(); window.happyDOM.abort();
  for (const [key, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  originals.clear();
});

test("shows running identity, separate manual policy, notes and only exact-candidate staging", async () => {
  await render();
  for (const value of ["abc123", "0.1.0+build.1.1", "Manual", "Stable", "Second release notes", "Last successful check"]) expect(document.body.textContent).toContain(value);
  expect(button("Check now").disabled).toBe(false);
  await act(async () => button("Download update").click());
  expect(calls.find(call => call.url.endsWith("/stage"))?.body).toEqual({ candidateId: report.candidate!.id });
  expect([...document.querySelectorAll("button")].some(node => /install/i.test(node.textContent || ""))).toBe(false);
});

test("stale or expired candidates cannot download, while Check now remains available", async () => {
  report.currentCheck = false; report.status = "failed"; report.error = "Feed offline. Keep the Mac awake.";
  await render();
  expect(document.body.textContent).toContain("Last known release");
  expect(document.body.textContent).toContain("Feed offline");
  expect(button("Download update").disabled).toBe(true);
  await act(async () => button("Check now").click());
  expect(calls.find(call => call.url.endsWith("/check"))?.body).toEqual({ check: true });
});

test("ready packages have honest status and no nonfunctional install action", async () => {
  report.status = "ready";
  await render();
  expect(document.body.textContent).toContain("Verified download ready");
  expect(button("Download update")).toBeUndefined();
  expect([...document.querySelectorAll("button")].some(node => /install/i.test(node.textContent || ""))).toBe(false);
});

test("disconnect clears build details and aborts in-flight reads", async () => {
  const gate = Promise.withResolvers<Response>(); let signal: AbortSignal | undefined;
  request.mockImplementation((async (_input, init) => { signal = init?.signal as AbortSignal; return gate.promise; }) as typeof fetch);
  await render(); await render(false);
  expect(signal!.aborted).toBe(true);
  await act(async () => gate.resolve(Response.json(report)));
  expect(document.body.textContent).not.toContain("abc123");
  expect(document.body.textContent).toContain("Connect to the TV");
});

test("a rejected mutation remains visible after background status refresh", async () => {
  await render();
  request.mockImplementation((async (_input, init) => init?.method === "POST" ? Response.json({ error: "This candidate is no longer current." }, { status: 409 }) : Response.json(report)) as typeof fetch);
  await act(async () => button("Download update").click());
  expect(document.body.textContent).toContain("This candidate is no longer current.");
});


test("channel picker sends Preview separately from the manual installation policy", async () => {
  await render();
  await act(async () => document.querySelector("#release-channel")!.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerType: "mouse" })));
  const preview = [...document.querySelectorAll('[role="option"]')].find(node => node.textContent === "Preview")!;
  expect(preview).toBeDefined();
  await act(async () => { preview.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerType: "mouse" })); preview.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
  expect(calls.find(call => call.url.endsWith("/channel"))?.body).toEqual({ channel: "preview" });
});
