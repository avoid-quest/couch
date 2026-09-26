import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { Window } from "happy-dom";
import { act } from "react";
import { toast } from "sonner";
import type { Root } from "react-dom/client";
import type { QueryClient } from "@tanstack/react-query";
import { fireEvent, screen } from "../../testing";
import { SessionGateContext } from "@/session/gate-context";

let root: Root, window: Window, client: QueryClient, fetchSpy: ReturnType<typeof spyOn>, forLaterOrder: typeof import("./ForLaterSection").forLaterOrder;
const originals = new Map<string, PropertyDescriptor | undefined>();
const calls: Array<{ path: string; method: string; body: unknown }> = [];
let missing = false, canceled = false, undoResponses = false;
let items: Array<{ id: string; title: string; kind?: "radio"; live?: boolean }> = [{ id: "saved", title: "Evening movie" }, { id: "second", title: "Evening song" }];
const flush = () => act(async () => { await Bun.sleep(15); });
const button = (label: string) => screen.getByRole("button", { name: label });
const click = async (label: string) => { await act(async () => fireEvent.click(button(label))); await flush(); };
const toasts = () => toast.getToasts().map(item => "title" in item ? item.title : "");
// The session's Undo toast, as SessionGate offers it.
const session = { state: null, offerUndo: (text: string, undo: () => Promise<void>, duration = 6_000) => toast(text, { duration, action: { label: "Undo", onClick: () => void undo() } }) };
const undo = async () => {
  const latest = toast.getToasts().at(-1);
  const action = latest && "action" in latest ? latest.action : undefined;
  expect(latest && "duration" in latest ? latest.duration : null).toBe(6_000);
  expect(action && typeof action === "object" && "label" in action ? action.label : null).toBe("Undo");
  await act(async () => { if (action && typeof action === "object" && "onClick" in action) action.onClick({} as React.MouseEvent<HTMLButtonElement>); });
  await flush();
};
async function render(connected = true, canPlay = true, onFind?: () => void, mediaOnly = false) {
  const { ForLaterSection, forLaterOrder: order } = await import("./ForLaterSection");
  forLaterOrder = order;
  const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => root.render(<QueryClientProvider client={client}><SessionGateContext.Provider value={session as never}><ForLaterSection origin="http://localhost" token="paired" connected={connected} canPlay={canPlay} onFind={onFind} mediaOnly={mediaOnly} /></SessionGateContext.Provider></QueryClientProvider>));
  await flush();
}
beforeEach(async () => {
  calls.length = 0; missing = canceled = undoResponses = false; items = [{ id: "saved", title: "Evening movie" }, { id: "second", title: "Evening song" }];
  window = new Window({ url: "http://localhost" });
  for (const key of ["CSS", "window", "document", "navigator", "HTMLElement", "HTMLInputElement", "HTMLButtonElement", "Element", "Node", "NodeFilter", "DocumentFragment", "MutationObserver", "ResizeObserver", "CustomEvent", "Event", "MouseEvent", "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame", "IS_REACT_ACT_ENVIRONMENT"]) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    const value = key === "IS_REACT_ACT_ENVIRONMENT" ? true : key === "window" ? window : Reflect.get(window, key);
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: typeof value === "function" && /^[a-z]/.test(key) ? value.bind(window) : value });
  }
  fetchSpy = spyOn(globalThis, "fetch").mockImplementation((async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(String(input)).pathname, method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ path, method, body });
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer paired");
    if (method === "GET") return Response.json({ items });
    if (path.endsWith("/load") && missing) return Response.json({ error: "Source unavailable. Retry or remove it from For later." }, { status: 409 });
    if (path.endsWith("/load") && canceled) return Response.json({ ok: true, notice: "Queued." });
    if (path === "/api/for-later/restore") { items.unshift({ id: "saved", title: "Evening movie" }); return Response.json({ ok: true }); }
    if (method === "DELETE") items = items.filter(item => path !== `/api/for-later/${item.id}`);
    return Response.json({ ok: true, ...(method === "DELETE" && undoResponses ? { undoToken: "restore-token" } : {}) });
  }) as typeof fetch);
  const { createRoot } = await import("react-dom/client");
  const container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount()); toast.dismiss(); fetchSpy.mockRestore(); await window.happyDOM.abort();
  for (const [key, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  originals.clear();
});

test("saved shared items display without queue writes; explicit actions retain the saved entry", async () => {
  await render();
  expect(calls).toEqual([{ path: "/api/for-later", method: "GET", body: undefined }]);
  const firstRow = button("Queue Evening movie").closest("li");
  expect(firstRow?.hasAttribute("data-nav-row")).toBe(true);
  expect(firstRow?.contains(button("Queue Evening song"))).toBe(false);
  await click("Queue Evening movie"); await click("Play Evening movie");
  expect(calls.slice(1).map(call => call.body)).toEqual([{ mode: "append" }, { mode: "play" }]);
  expect(toasts()).toEqual(["Queued Evening movie."]);
  expect(screen.getAllByRole("listitem")).toHaveLength(2);
});

test("Find home limits For later to video and music", async () => {
  items.push({ id: "station", title: "Evening station", kind: "radio", live: true }, { id: "live", title: "Live stream", live: true });
  await render(true, true, undefined, true);
  expect(screen.getAllByRole("listitem")).toHaveLength(2);
  expect(document.body.textContent).not.toContain("Evening station");
  expect(document.body.textContent).not.toContain("Live stream");
});

test("failed source keeps its saved item removable and removal returns focus to the next item", async () => {
  await render(); missing = true; await click("Play Evening movie");
  expect(screen.getByRole("alert").textContent).toContain("Source unavailable");
  expect(screen.getAllByRole("listitem")).toHaveLength(2);
  await click("Remove Evening movie");
  expect(screen.getAllByRole("listitem")).toHaveLength(1);
  expect(document.activeElement).toBe(button("Play Evening song"));
  await click("Remove Evening song");
  expect(document.activeElement?.id).toBe("for-later-title");
  expect(document.body.textContent).toContain("Nothing saved yet. Use Save on anything in Find.");
});

test("removed For later item offers Undo and restores the original row", async () => {
  undoResponses = true;
  await render();
  await click("Remove Evening movie");
  expect(screen.getAllByRole("listitem")).toHaveLength(1);
  expect(toasts().at(-1)).toBe("Removed Evening movie from Saved.");
  await undo();
  expect(calls.at(-2)).toEqual({ path: "/api/for-later/restore", method: "POST", body: { token: "restore-token" } });
  expect(screen.getAllByRole("listitem")).toHaveLength(2);
});

test("unavailable native playback still allows append and remove; disconnected controllers cannot mutate", async () => {
  await render(true, false);
  expect((button("Play Evening movie") as HTMLButtonElement).disabled).toBe(true);
  expect(button("Queue Evening movie").disabled).toBe(false);
  expect(button("Remove Evening movie").disabled).toBe(false);
  const count = calls.length; await render(false);
  expect(document.body.textContent).toContain("Offline. Reconnecting to Couch…");
  expect(screen.queryAllByRole("listitem")).toHaveLength(0); expect(calls).toHaveLength(count);
});

test("another controller's socket revision refreshes shared saved items", async () => {
  await render(); items = [{ id: "new", title: "New shared item" }];
  await act(async () => { await client.invalidateQueries({ queryKey: ["for-later"] }); }); await flush();
  expect(document.body.textContent).toContain("New shared item");
  expect(document.body.textContent).not.toContain("Evening movie");
});

test("saving a library result posts only its catalog identity and never a queue operation", async () => {
  const { SaveForLater } = await import("@/components/SaveForLater");
  const { QueryClientProvider } = await import("@tanstack/react-query");
  await act(async () => root.render(<QueryClientProvider client={client}><SaveForLater origin="http://localhost" token="paired" connected reference={{ kind: "library", id: "movie" }} title="Evening movie" /></QueryClientProvider>));
  await click("Save Evening movie");
  expect(calls).toEqual([{ path: "/api/for-later", method: "POST", body: { reference: { kind: "library", id: "movie" } } }]);
  expect(toasts()).toEqual(["Saved Evening movie."]);
});

test("a successful append whose Play was canceled reports that outcome instead of a source error or retry", async () => {
  await render(); canceled = true;
  await click("Play Evening movie");
  expect(toasts()).toEqual(["Queued."]);
  expect(screen.queryByRole("alert")).toBeNull();
  expect(calls.filter(call => call.method === "POST")).toHaveLength(1);
  expect(screen.getAllByRole("listitem")).toHaveLength(2);
});

test("reorder handles are always available and a drop computes the persisted order", async () => {
  await render();
  expect(screen.getAllByRole("button", { name: /^Reorder/ }).map((node: HTMLElement) => node.getAttribute("aria-label"))).toEqual(["Reorder Evening movie", "Reorder Evening song"]);
  expect(forLaterOrder(items, "second", "saved")).toEqual(["second", "saved"]);
  expect(forLaterOrder(items, "saved", "saved")).toBeNull();
  expect(forLaterOrder(items, "elsewhere", "saved")).toBeNull();
});

test("an empty For later leads to Find", async () => {
  items = [];
  let found = 0;
  await render(true, true, () => found++);
  expect(screen.queryAllByRole("listitem")).toHaveLength(0);
  expect(document.body.textContent).toContain("Nothing saved yet. Use Save on anything in Find.");
  await click("Find");
  expect(found).toBe(1);
});
