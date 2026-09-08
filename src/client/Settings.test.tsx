import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { Window } from "happy-dom";
import { act } from "react";
import type { Root } from "react-dom/client";
import type { ControllerIdentity } from "../shared/controllers";
import type { SetupStep } from "../shared/setup";
let Settings: typeof import("./Settings")["Settings"];
let root: Root, window: Window, request: ReturnType<typeof spyOn>;
const originals = new Map<string, PropertyDescriptor | undefined>();
const calls: { url: string; body: unknown }[] = [];
const admin: ControllerIdentity = { authority: "administrator", controller: { id: "owner", name: "Phone", role: "administrator", createdAt: 1, lastSeenAt: 1 }, claimAvailable: false };
const render = async (step: SetupStep, identity = admin, connected = true) => act(async () => root.render(<Settings
  setupStep={step} credentials={{ origin: "http://localhost", token: "admin" }} connected={connected} identity={identity}
  videoQualityPreference={{ quality: "auto", save: () => {}, error: null }} status="Connected" details={null} pairingRequired={false} reachable={true}
  host={null} administratorClaimed={true} name="Living room" version={0} onReconnect={() => {}} onPairAgain={() => {}} onCommand={async () => true}
  libraryVersion={0} jellyfinVersion={0} radioVersion={0}
/>));
beforeEach(async () => {
  calls.length = 0;
  window = new Window({ url: "http://localhost" });
  for (const key of ["window", "document", "navigator", "location", "HTMLElement", "HTMLInputElement", "HTMLButtonElement", "Element", "Node", "NodeFilter", "DocumentFragment", "MutationObserver", "ResizeObserver", "Event", "CustomEvent", "MouseEvent", "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame", "IS_REACT_ACT_ENVIRONMENT"]) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: key === "IS_REACT_ACT_ENVIRONMENT" ? true : key === "window" ? window : Reflect.get(window, key) });
  }
  request = spyOn(globalThis, "fetch").mockImplementation((async (input, init) => {
    calls.push({ url: String(input), body: init?.body });
    if (String(input).endsWith("/api/controllers")) return Response.json({ controllers: [admin.controller] });
    if (String(input).endsWith("/api/settings")) return Response.json({ name: "Living room" });
    return Response.json({});
  }) as typeof fetch);
  const { createRoot } = await import("react-dom/client");
  ({ Settings } = await import("./Settings"));
  const container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount()); request.mockRestore(); window.happyDOM.abort();
  for (const [key, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  originals.clear();
});
test("a paired administrator resumes setup automatically and completion returns to normal Settings", async () => {
  await render("general");
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Claim and name");
  expect(document.querySelector('[aria-label="Settings sections"]')).toBeNull();
  const next = [...document.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === "Continue to screen")!;
  expect(next.disabled).toBe(false);
  await act(async () => next.click());
  expect(calls.find(call => call.url.endsWith("/api/settings/setup"))?.body).toBe('{"step":"general"}');
  await render("complete");
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="Settings"]')!.click());
  expect(document.querySelector('[aria-label="Settings sections"]')).not.toBeNull();
});
test("a second controller cannot advance the owner's setup", async () => {
  await render("sound", { ...admin, authority: "controller", controller: { ...admin.controller!, role: "controller" } });
  expect(document.body.textContent).toContain("Your administrator is setting up this TV");
  expect(document.body.textContent).not.toContain("I heard the test sound");
  expect(calls.some(call => call.url.includes("/api/sound"))).toBe(false);
});
test("failed progress saves remain retryable and disconnected setup cannot advance", async () => {
  await render("general");
  request.mockImplementation((async (_input: RequestInfo | URL) => Response.json({ error: "Storage is full." }, { status: 503 })) as typeof fetch);
  await act(async () => [...document.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === "Continue to screen")!.click());
  expect(document.body.textContent).toContain("Storage is full.");
  expect([...document.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === "Continue to screen")!.disabled).toBe(false);
  await render("general", admin, false);
  expect([...document.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === "Continue to screen")!.disabled).toBe(true);
});
