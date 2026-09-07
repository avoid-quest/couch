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
    if (String(input).endsWith("/api/tools")) return Response.json({ checkedAt: new Date().toISOString(), cacheSeconds: 10, tools: [], ffprobe: { status: "missing", version: null, error: "Executable was not found." } });
    return Response.json(report);
  }) as typeof fetch);
  const { createRoot } = await import("react-dom/client");
  ({ UpdatesSettings } = await import("./UpdatesSettings"));
  const container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => {
  await act(async () => { root.unmount(); await new Promise(resolve => setTimeout(resolve, 0)); }); request.mockRestore(); window.happyDOM.abort();
  for (const [key, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  originals.clear();
});

test("shows running identity, separate manual policy, notes and only exact-candidate staging", async () => {
  await render();
  for (const value of ["abc123", "0.1.0+build.1.1", "Manual", "Stable", "Second release notes", "Last successful check"]) expect(document.body.textContent).toContain(value);
  expect(button("Check now").disabled).toBe(false);
  expect(button("Check tools").disabled).toBe(false);
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

test("install persists its identity before sending and requires an explicit restart action", async () => {
  report.status = "ready";
  report.installation = { enabled: true, transaction: null };
  request.mockImplementation((async (input, init) => {
    if (String(input).endsWith("/api/tools")) return Response.json({}, { status: 503 });
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url: String(input), body, signal: init?.signal as AbortSignal });
    if (String(input).endsWith("/install")) {
      const saved = JSON.parse(window.localStorage.getItem("couch.update-request:http://localhost")!);
      expect(saved.requestId).toBe(body.install.requestId);
      return Response.json({ transaction: { updateId: "c".repeat(32), requestId: saved.requestId, candidateId: saved.candidateId, version: saved.version, revision: saved.revision, phase: "accepted", error: null, createdAt: 1, updatedAt: 1 } });
    }
    return Response.json(report);
  }) as typeof fetch);
  await render();
  await act(async () => button("Install update").click());
  expect(calls.filter(call => call.url.endsWith("/install"))).toHaveLength(0);
  expect(document.body.textContent).toContain("Other remotes will disconnect");
  await act(async () => button("Install and restart").click());
  const sent = calls.find(call => call.url.endsWith("/install"))!.body as { install: { requestId: string; candidateId: string; confirmInterrupt: boolean } };
  expect(sent.install.requestId).toMatch(/^[a-f0-9]{32}$/);
  expect(sent.install.candidateId).toBe(report.candidate!.id);
  expect(sent.install.confirmInterrupt).toBe(false);
});

test("a lost install reply keeps its retry identity through disconnect without replaying installation", async () => {
  report.status = "ready";
  report.installation = { enabled: true, transaction: null };
  const installed: unknown[] = [];
  request.mockImplementation((async (input, init) => {
    if (String(input).endsWith("/api/tools")) return Response.json({}, { status: 503 });
    if (String(input).endsWith("/install")) { installed.push(JSON.parse(String(init?.body))); throw new Error("disconnected"); }
    return Response.json(report);
  }) as typeof fetch);
  await render();
  await act(async () => button("Install update").click());
  await act(async () => button("Install and restart").click());
  await render(false);
  expect(document.body.textContent).toContain("The TV is restarting or offline");
  await render(true);
  expect(installed).toHaveLength(1);
  await act(async () => button("Retry same request").click());
  expect(installed).toHaveLength(2);
  expect(installed[0]).toEqual(installed[1]);
});


test("an older finished transaction cannot erase a newly saved request whose delivery is unknown", async () => {
  const saved = { candidateId: report.candidate!.id, requestId: "b".repeat(32), confirmInterrupt: false, version: report.candidate!.version, revision: report.candidate!.revision };
  window.localStorage.setItem("couch.update-request:http://localhost", JSON.stringify(saved));
  report.installation = { enabled: true, transaction: { updateId: "c".repeat(32), requestId: "d".repeat(32), candidateId: "e".repeat(64), version: "old", revision: "old", phase: "succeeded", error: null, createdAt: 1, updatedAt: 1 } };
  await render(false);
  expect(JSON.parse(window.localStorage.getItem("couch.update-request:http://localhost")!)).toEqual(saved);
  expect(button("Retry same request")).toBeTruthy();
  expect(calls.some(call => call.url.endsWith("/install"))).toBe(false);
});


test("a refreshed administrator page reopens Updates for its durable pending request", async () => {
  const { Settings } = await import("./Settings");
  window.localStorage.setItem("couch.update-request:http://localhost", JSON.stringify({ candidateId: report.candidate!.id, requestId: "b".repeat(32), confirmInterrupt: false, version: report.candidate!.version, revision: report.candidate!.revision }));
  await act(async () => root.render(<Settings credentials={{ origin: "http://localhost", token: "admin" }} connected={false} status="reconnecting" identity={{ authority: "administrator", controller: null, claimAvailable: false }} host={null} details={null} administratorClaimed pairingRequired={false} reachable={false} name="TV" version={0} onReconnect={() => {}} onPairAgain={() => {}} onCommand={async () => false} videoQualityPreference={{ quality: "best", error: null, save: () => {} }} jellyfinVersion={0} radioVersion={0} libraryVersion={0} />));
  expect(document.querySelector('[role="dialog"]')).toBeTruthy();
  expect(document.querySelector('[role="tab"][data-state="active"]')?.textContent).toBe("Updates");
  expect(document.body.textContent).toContain("Retry same request");
  expect(calls.some(call => call.url.endsWith("/install"))).toBe(false);
});


test("definitive pre-acceptance expiry clears the saved request so checks and downloads remain usable", async () => {
  report.status = "ready"; report.installation = { enabled: true, transaction: null };
  request.mockImplementation((async (input, init) => {
    calls.push({ url: String(input), body: init?.body ? JSON.parse(String(init.body)) : undefined, signal: init?.signal as AbortSignal });
    if (String(input).endsWith("/install")) { report.status = "available"; return Response.json({ accepted: false, error: "Candidate expired" }, { status: 409 }); }
    if (String(input).endsWith("/api/tools")) return Response.json({}, { status: 503 });
    return Response.json(report);
  }) as typeof fetch);
  await render();
  await act(async () => button("Install update").click());
  await act(async () => button("Install and restart").click());
  expect(window.localStorage.getItem("couch.update-request:http://localhost")).toBeNull();
  expect(button("Check now").disabled).toBe(false);
  expect(button("Download update").disabled).toBe(false);
});

test("request-specific completion clears a saved request superseded by another remote", async () => {
  const saved = { candidateId: report.candidate!.id, requestId: "b".repeat(32), confirmInterrupt: false, version: report.candidate!.version, revision: report.candidate!.revision };
  window.localStorage.setItem("couch.update-request:http://localhost", JSON.stringify(saved));
  const own = { updateId: "c".repeat(32), requestId: saved.requestId, candidateId: saved.candidateId, version: saved.version, revision: saved.revision, phase: "failed" as const, error: null, createdAt: 1, updatedAt: 1 };
  report.installation = { enabled: true, transaction: { ...own, requestId: "d".repeat(32), phase: "succeeded" }, requestedTransaction: own };
  await render();
  expect(calls.some(call => call.url.endsWith(`?requestId=${saved.requestId}`))).toBe(true);
  expect(window.localStorage.getItem("couch.update-request:http://localhost")).toBeNull();
  expect(button("Check now").disabled).toBe(false);
});

test("a terminal install retry receipt clears its saved identity even when latest status is empty", async () => {
  const saved = { candidateId: report.candidate!.id, requestId: "b".repeat(32), confirmInterrupt: false, version: report.candidate!.version, revision: report.candidate!.revision };
  window.localStorage.setItem("couch.update-request:http://localhost", JSON.stringify(saved));
  report.installation = { enabled: true, transaction: null };
  request.mockImplementation((async input => {
    if (String(input).endsWith("/install")) return Response.json({ transaction: { updateId: "c".repeat(32), requestId: saved.requestId, candidateId: saved.candidateId, version: saved.version, revision: saved.revision, phase: "failed", error: "Expired", createdAt: 1, updatedAt: 1 } }, { status: 202 });
    if (String(input).endsWith("/api/tools")) return Response.json({}, { status: 503 });
    return Response.json(report);
  }) as typeof fetch);
  await render();
  await act(async () => button("Retry same request").click());
  expect(window.localStorage.getItem("couch.update-request:http://localhost")).toBeNull();
  expect(button("Check now").disabled).toBe(false);
});

test("Auto when idle persists separately from the release channel", async () => {
  report.installation = { enabled: true, transaction: null };
  await render();
  await act(async () => document.querySelector("#update-policy")!.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerType: "mouse" })));
  const auto = [...document.querySelectorAll('[role="option"]')].find(node => node.textContent === "Auto when idle")!;
  await act(async () => { auto.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerType: "mouse" })); auto.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
  expect(calls.find(call => call.url.endsWith("/policy"))?.body).toEqual({ policy: "idle" });
  expect(calls.some(call => call.url.endsWith("/channel") || call.url.endsWith("/install"))).toBe(false);
});

test("idle waiting keeps Install now behind the restart and playback warning", async () => {
  report.status = "ready"; report.policy = "idle";
  report.waiting = "Waiting for playback to stop. Paused playback is still active.";
  report.installation = { enabled: true, transaction: null };
  await render();
  expect(document.body.textContent).toContain(report.waiting);
  await act(async () => button("Install now").click());
  expect(document.body.textContent).toContain("Other remotes will disconnect");
  expect(document.body.textContent).toContain("Stop playback if it is running");
  expect(calls.some(call => call.url.endsWith("/install"))).toBe(false);
});

test("an unattended failed trial displays the authenticated restored release", async () => {
  report.policy = "idle";
  report.installation = { enabled: true, transaction: { updateId: "c".repeat(32), requestId: "d".repeat(32), candidateId: report.candidate!.id, version: report.candidate!.version, revision: report.candidate!.revision, phase: "restored", restoredVersion: "0.1.0+build.1.1", restoredRevision: "abc123", error: "The trial failed; previous release restored.", createdAt: 1, updatedAt: 1 } };
  await render();
  const outcome = [...document.querySelectorAll("p")].find(node => node.textContent === "Previous release restored")!;
  expect(outcome.nextElementSibling!.textContent).toBe("0.1.0+build.1.1");
});

test("controller pointer and keyboard input report activity, with no idle heartbeat", async () => {
  const { useUpdateActivity } = await import("./update-activity");
  const Activity = () => { useUpdateActivity({ origin: "http://localhost", token: "admin" }, true); return null; };
  await act(async () => root.render(<Activity />));
  expect(calls).toHaveLength(0);
  await act(async () => document.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })));
  await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowDown" })));
  expect(calls.map(call => [call.url, call.body])).toEqual(Array(2).fill(["http://localhost/api/activity", { activity: true }]));
  await act(async () => root.render(null));
  document.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowDown" }));
  expect(calls).toHaveLength(2);
});
