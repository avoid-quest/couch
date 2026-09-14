import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { Window } from "happy-dom";
import { act } from "react";
import type { Root } from "react-dom/client";
import type { ToolHealth } from "../shared/tool-health";
let ToolsSettings: typeof import("./ToolsSettings")["ToolsSettings"];

let root: Root, window: Window, request: ReturnType<typeof spyOn>, report: ToolHealth;
const originals = new Map<string, PropertyDescriptor | undefined>();
const calls: { url: string; method: string | undefined; body: unknown; signal: AbortSignal }[] = [];
const button = () => document.querySelector<HTMLButtonElement>("button")!;
const render = async (connected = true, token = "admin", revision?: string) => act(async () => root.render(<ToolsSettings credentials={{ origin: "http://localhost", token }} connected={connected} revision={revision} />));
beforeEach(async () => {
  report = { checkedAt: "2026-09-06T22:00:00Z", cacheSeconds: 10, tools: [
    { name: "yt-dlp", expectedVersion: "2026.08.19", installed: { status: "ready", version: "2026.08.19", error: null }, effective: { source: "environment", status: "ready", version: "2026.01.01", error: null } },
    { name: "Deno", expectedVersion: "2.9.6", installed: { status: "ready", version: "2.9.6", error: null }, effective: { source: "package", status: "ready", version: "2.9.6", error: null } },
  ], ffprobe: { status: "ready", version: "6.1.1", error: null } };
  calls.length = 0; window = new Window({ url: "http://localhost" });
  for (const key of ["window", "document", "navigator", "HTMLElement", "Element", "Node", "MutationObserver", "Event", "MouseEvent", "IS_REACT_ACT_ENVIRONMENT"]) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: key === "IS_REACT_ACT_ENVIRONMENT" ? true : key === "window" ? window : Reflect.get(window, key) });
  }
  request = spyOn(globalThis, "fetch").mockImplementation((async (input, init) => {
    calls.push({ url: String(input), method: init?.method, body: init?.body, signal: init?.signal as AbortSignal });
    expect(init?.headers).toEqual({ Authorization: "Bearer admin" });
    return Response.json(report);
  }) as typeof fetch);
  const { createRoot } = await import("react-dom/client");
  ({ ToolsSettings } = await import("./ToolsSettings"));
  const container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount()); request.mockRestore(); window.happyDOM.abort();
  for (const [key, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  originals.clear();
});

test("shows release versions, package integrity, an effective override and separate runtime status", async () => {
  await render();
  for (const value of ["Expected version", "Installed version", "2026.08.19", "2026.01.01", "Verified for this release", "Environment override", "Shipped package", "Runtime dependency: Available, version 6.1.1", "System package and security updates", "website or network failure", "10 seconds"]) expect(document.body.textContent).toContain(value);
  expect(calls).toHaveLength(2);
  expect(calls.map(call => call.url)).toEqual(["http://localhost/api/tools/packages", "http://localhost/api/tools"]);
  expect(calls[0]!.method).toBeUndefined(); expect(calls[0]!.body).toBeUndefined();
  expect([...document.querySelectorAll("button")].map(node => node.textContent)).toEqual(["Check tools"]);
  expect(button().disabled).toBe(false);
});

test("damage to the shipped copy stays visible when an override works, and unknown is not success", async () => {
  report.tools[0]!.installed = { status: "corrupt", version: null, error: "The package tool does not match this Couch release. It was not executed." };
  report.tools[1]!.installed = { status: "unknown", version: null, error: "Package integrity is unknown for this build." };
  report.ffprobe = { status: "missing", version: null, error: "The executable was not found." };
  await render();
  for (const value of ["Does not match release", "It was not executed", "Environment override", "2026.01.01", "Not verified", "Unknown", "Runtime dependency: Missing"]) expect(document.body.textContent).toContain(value);
  expect(document.body.textContent).not.toContain("Verified for this release");
});

test("Check tools refreshes the observations and a failed request preserves an explicitly dated previous result", async () => {
  await render();
  report.tools[0]!.installed = { status: "missing", version: null, error: "The package tool is missing." };
  await act(async () => button().click());
  expect(calls).toHaveLength(4); expect(document.body.textContent).toContain("The package tool is missing");
  request.mockResolvedValue(Response.json({ error: "private path /home/secret" }, { status: 403 }));
  await act(async () => button().click());
  expect(document.body.textContent).toContain("Could not check media tools");
  expect(document.body.textContent).toContain("Last completed check:");
  expect(document.body.textContent).not.toContain("private"); expect(document.body.textContent).not.toContain("/home/secret");
  expect(button().disabled).toBe(false);
});

test("disconnect aborts pending checks and ignores late success", async () => {
  const gate = Promise.withResolvers<Response>(); let signal: AbortSignal | undefined;
  request.mockImplementation((async (_input, init) => { signal = init?.signal as AbortSignal; return gate.promise.then(response => response.clone()); }) as typeof fetch);
  await render(); expect(button().disabled).toBe(true);
  await render(false); expect(signal!.aborted).toBe(true);
  await act(async () => gate.resolve(Response.json(report)));
  expect(document.body.textContent).not.toContain("2026.08.19");
  expect(document.body.textContent).toContain("Connect to the TV"); expect(button().disabled).toBe(true);
});

test("changing credentials clears old observations before the new check finishes", async () => {
  await render();
  const gate = Promise.withResolvers<Response>();
  request.mockImplementation((async (_input, init) => { expect(init?.headers).toEqual({ Authorization: "Bearer replacement" }); return gate.promise.then(response => response.clone()); }) as typeof fetch);
  await render(true, "replacement");
  expect(document.body.textContent).not.toContain("2026.08.19");
  await act(async () => gate.resolve(Response.json(report)));
  expect(document.body.textContent).toContain("2026.08.19");
});


test("System cached security/package status is distinct from release updates and never offers an upgrade", async () => {
  request.mockImplementation((async input => Response.json(String(input).endsWith("/packages") ? { available: 4, security: 2, broken: 1, indexUpdatedAt: null, checkedAt: "2026-09-07", error: null } : report)) as typeof fetch);
  await render();
  expect(document.body.textContent).toContain("4 actionable distribution upgrades");
  expect(document.body.textContent).toContain("2 from security repositories");
  expect(document.body.textContent).toContain("broken dependencies: 1");
  expect(document.body.textContent).toContain("index refresh: Unknown");
  expect([...document.querySelectorAll("button")].some(button => /upgrade|install/i.test(button.textContent || ""))).toBe(false);
});

test("a completed repair clears prior tool and package observations while its fresh check is pending", async () => {
  request.mockImplementation((async input => Response.json(String(input).endsWith("/packages") ? { available: 4, security: 2, broken: 0, indexUpdatedAt: null } : report)) as typeof fetch);
  await render(true, "admin", "old");
  expect(document.body.textContent).toContain("2026.08.19");
  expect(document.body.textContent).toContain("4 actionable distribution upgrades");
  const gate = Promise.withResolvers<Response>();
  request.mockImplementation((async (_input, _init) => gate.promise.then(response => response.clone())) as typeof fetch);
  await render(true, "admin", "repaired");
  expect(document.body.textContent).not.toContain("2026.08.19");
  expect(document.body.textContent).not.toContain("4 actionable distribution upgrades");
  expect(document.body.textContent).toContain("Checking local media tools");
  await act(async () => gate.resolve(Response.json(report)));
});
