import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { Window } from "happy-dom";
import { act } from "react";
import type { Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, screen } from "@/testing";
import type { UpdateState } from "../../../../shared/updates";

let window: Window, root: Root, client: QueryClient, request: ReturnType<typeof spyOn>, state: UpdateState;
const originals = new Map<string, PropertyDescriptor | undefined>();
const mismatch = "The signature was created with a different key than the one provided";
const flush = () => act(async () => { await Bun.sleep(20); });

beforeEach(async () => {
  window = new Window({ url: "http://localhost" });
  for (const key of ["window", "document", "navigator", "HTMLElement", "HTMLInputElement", "HTMLButtonElement", "HTMLFormElement", "Element", "Node", "NodeFilter", "DocumentFragment", "MutationObserver", "ResizeObserver", "CustomEvent", "Event", "MouseEvent", "PointerEvent", "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame", "localStorage", "IS_REACT_ACT_ENVIRONMENT"]) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    const value = key === "IS_REACT_ACT_ENVIRONMENT" ? true : key === "window" ? window : Reflect.get(window, key);
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: typeof value === "function" && /^[a-z]/.test(key) ? value.bind(window) : value });
  }
  state = { running: { version: "0.2.0-preview.13", revision: "a".repeat(40) }, channel: "preview", policy: "manual", status: "failed", currentCheck: true, lastSuccessfulCheck: 1, error: mismatch,
    candidate: { id: "b".repeat(64), releaseId: "0.2.0-preview.15", version: "0.2.0-preview.15", revision: "c".repeat(40), notes: "Long release notes\n".repeat(100), bytes: 123, publishedAt: 1 },
    installation: { enabled: true, transaction: null } };
  request = spyOn(globalThis, "fetch").mockImplementation((async (_input, init) => {
    if (init?.method === "POST") state = { ...state, error: null, status: "available" };
    return Response.json(state);
  }) as typeof fetch);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { createRoot } = await import("react-dom/client");
  root = createRoot(document.body.appendChild(document.createElement("div")));
});

afterEach(async () => {
  await act(async () => root.unmount());
  client.clear(); request.mockRestore(); await window.happyDOM.abort();
  for (const [key, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  originals.clear();
});

async function render(target: "this app" | "selected host" = "this app") {
  const { UpdatesSettings } = await import("./UpdatesSettings");
  await act(async () => root.render(<QueryClientProvider client={client}><UpdatesSettings credentials={{ origin: "http://localhost", token: "admin" }} connected target={target} hostName="Living room" /></QueryClientProvider>));
  await flush();
}

test("a signing-key mismatch explains recovery before long release notes and stops a futile download retry", async () => {
  await render();
  const alert = screen.getByRole("alert");
  expect(alert.textContent).toContain("Reinstall Couch from the official installer. Your data stays.");
  expect(alert.compareDocumentPosition(screen.getByText("New version")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect((screen.getByRole("button", { name: "Download" }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.queryByRole("button", { name: "Install" })).toBeNull();
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Check for updates" })));
  await flush();
  expect(request.mock.calls.some(([input, init]: Parameters<typeof fetch>) => String(input).endsWith("/api/updates/check") && init?.method === "POST")).toBe(true);
  expect(screen.queryByRole("alert")).toBeNull();
  expect((screen.getByRole("button", { name: "Download" }) as HTMLButtonElement).disabled).toBe(false);
});

test("remote signing-key recovery names the installation that needs reinstalling", async () => {
  await render("selected host");
  expect(screen.getByRole("alert").textContent).toContain("Reinstall Couch on Living room from the official installer. Your data stays.");
});

test("other download failures stay visible and allow retry", async () => {
  state.error = "The download was interrupted. Try again.";
  await render();
  const alert = screen.getByRole("alert");
  expect(alert.textContent).toBe(state.error);
  expect(alert.compareDocumentPosition(screen.getByText("New version")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Download" })));
  await flush();
  expect(request.mock.calls.some(([input, init]: Parameters<typeof fetch>) => String(input).endsWith("/api/updates/stage") && JSON.parse(String(init?.body)).candidateId === state.candidate!.id)).toBe(true);
});

test("a verified download still enables installation", async () => {
  state.status = "ready"; state.error = null;
  await render();
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.queryByRole("button", { name: "Download" })).toBeNull();
  expect((screen.getByRole("button", { name: "Install" }) as HTMLButtonElement).disabled).toBe(false);
});
