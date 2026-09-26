import { setupUiTests, render as renderUI, act, screen, within, userEvent, createTestQueryClient } from "@/testing/react";
import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { toast } from "sonner";
import type { QueryClient } from "@tanstack/react-query";
import type { ForLaterItem } from "../../../shared/for-later";
import type { ProviderItem } from "../../../shared/providers";
import { SessionGateContext } from "@/session/gate-context";

setupUiTests();

let view: ReturnType<typeof renderUI>, client: QueryClient, forLaterOrder: typeof import("./ForLaterSection").forLaterOrder;
const calls: Array<{ path: string; method: string; body: unknown }> = [];
let missing = false, canceled = false, undoResponses = false;
let items: ForLaterItem[] = [{ id: "saved", title: "Evening movie" }, { id: "second", title: "Evening song" }];
const button = (label: string) => screen.getByRole("button", { name: label });
const click = async (label: string) => userEvent.click(await screen.findByRole("button", { name: label }));
const toasts = () => toast.getToasts().map(item => "title" in item ? item.title : "");
// The session's Undo toast, as SessionGate offers it.
const session = { state: null, offerUndo: (text: string, undo: () => Promise<void>, duration = 6_000) => toast(text, { duration, action: { label: "Undo", onClick: () => void undo() } }) };
const undo = async () => {
  const latest = toast.getToasts().at(-1);
  const action = latest && "action" in latest ? latest.action : undefined;
  expect(latest && "duration" in latest ? latest.duration : null).toBe(6_000);
  expect(action && typeof action === "object" && "label" in action ? action.label : null).toBe("Undo");
  await act(async () => { if (action && typeof action === "object" && "onClick" in action) action.onClick({} as React.MouseEvent<HTMLButtonElement>); });

};
async function render(connected = true, canPlay = true, onFind?: () => void, mediaOnly = false, onOpenProvider?: (item: ProviderItem, returnFocusLabel?: string) => void) {
  const { ForLaterSection, forLaterOrder: order } = await import("./ForLaterSection");
  forLaterOrder = order;
  const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
  client = createTestQueryClient();
  await act(async () => view.rerender(<QueryClientProvider client={client}><SessionGateContext.Provider value={session as never}><ForLaterSection origin="http://localhost" token="paired" connected={connected} canPlay={canPlay} onFind={onFind} mediaOnly={mediaOnly} onOpenProvider={onOpenProvider} /></SessionGateContext.Provider></QueryClientProvider>));

  if (connected) await screen.findByText(items.length ? items[0]!.title : "Nothing saved yet. Use Save on anything in Find.");
}
beforeEach(async () => {
  client = createTestQueryClient();
  calls.length = 0; missing = canceled = undoResponses = false; items = [{ id: "saved", title: "Evening movie" }, { id: "second", title: "Evening song" }];
  spyOn(globalThis, "fetch").mockImplementation((async (input: RequestInfo | URL, init?: RequestInit) => {
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
  view = renderUI(<></>);
});
afterEach(async () => {
  toast.dismiss();
});

test("saved shared items display without queue writes; explicit actions retain the saved entry", async () => {
  await render();
  expect(calls).toEqual([{ path: "/api/for-later", method: "GET", body: undefined }]);
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
  expect(document.activeElement).toBe(button("Artwork details for Evening song"));
  await click("Remove Evening song");
  expect(screen.getByRole("heading", { name: "For later" })).toHaveFocus();
  expect(document.body.textContent).toContain("Nothing saved yet. Use Save on anything in Find.");
});

test("removed For later item offers Undo and restores the original row", async () => {
  undoResponses = true;
  await render();
  await click("Remove Evening movie");
  expect(screen.getAllByRole("listitem")).toHaveLength(1);
  expect(toasts().at(-1)).toBe("Removed Evening movie from Saved.");
  await undo();
  await screen.findByRole("button", { name: "Play Evening movie" });
  expect(calls.at(-2)).toEqual({ path: "/api/for-later/restore", method: "POST", body: { token: "restore-token" } });
  expect(screen.getAllByRole("listitem")).toHaveLength(2);
});

test("unavailable native playback still allows append and remove; disconnected controllers cannot mutate", async () => {
  await render(true, false);
  expect((button("Play Evening movie") as HTMLButtonElement).disabled).toBe(true);
  expect(button("Queue Evening movie")).toBeEnabled();
  expect(button("Remove Evening movie")).toBeEnabled();
  const count = calls.length; await render(false);
  expect(document.body.textContent).toContain("Offline. Reconnecting to Couch…");
  expect(screen.queryAllByRole("listitem")).toHaveLength(0); expect(calls).toHaveLength(count);
});

test("another controller's socket revision refreshes shared saved items", async () => {
  await render(); items = [{ id: "new", title: "New shared item" }];
  await act(async () => { await client.invalidateQueries({ queryKey: ["for-later"] }); });
  expect(await screen.findByRole("button", { name: "Play New shared item" })).toBeEnabled();
  expect(document.body.textContent).not.toContain("Evening movie");
});

test("saving a library result posts only its catalog identity and never a queue operation", async () => {
  const { SaveForLater } = await import("@/components/SaveForLater");
  const { QueryClientProvider } = await import("@tanstack/react-query");
  await act(async () => view.rerender(<QueryClientProvider client={client}><SaveForLater origin="http://localhost" token="paired" connected reference={{ kind: "library", id: "movie" }} title="Evening movie" /></QueryClientProvider>));
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

test("saved title and artwork open full details without playing, and Close returns to the exact opener", async () => {
  const description = "A full episode synopsis.\n".repeat(20) + "<script>Not executable</script>";
  items = [{ id: "episode", title: "S11E07 · Puntata 7", url: "https://streamingcommunityz.photos/it/watch/1955?e=17207", subtitle: "MasterChef Italia", description, thumbnail: "https://example.com/episode.jpg" }];
  await render();
  for (const label of ["Details S11E07 · Puntata 7", "Artwork details for S11E07 · Puntata 7"]) {
    const opener = button(label);
    await userEvent.click(opener);
    const dialog = await screen.findByRole("dialog", { name: items[0]!.title });
    expect(dialog.textContent).toContain(description);
    expect(dialog.querySelector("script")).toBeNull();
    expect(within(dialog).getByText("MasterChef Italia · StreamingCommunity")).toBeVisible();
    expect(calls.filter(call => call.method !== "GET")).toHaveLength(0);
    await userEvent.keyboard("{Escape}");
    expect(opener).toHaveFocus();
  }
});

test("details offers explicit playback and browsing the saved item's parent without modifying it", async () => {
  const collection = { title: "Artist — Album", url: "https://artist.bandcamp.com/album/album" };
  items = [{ id: "track", title: "Track", url: "https://artist.bandcamp.com/track/one", subtitle: "Artist", description: "Album notes", collection }];
  const opened: Array<[ProviderItem, string | undefined]> = [];
  await render(true, true, undefined, false, (item, label) => opened.push([item, label]));
  await click("Details Track");
  const dialog = await screen.findByRole("dialog", { name: "Track" });
  await userEvent.click(within(dialog).getByRole("button", { name: `Browse ${collection.title}` }));
  expect(opened).toEqual([[expect.objectContaining({ provider: "bandcamp", kind: "collection", title: collection.title, url: collection.url }), '[data-saved-details="track"] [data-play]']]);
  expect(calls.filter(call => call.method !== "GET")).toHaveLength(0);
  await userEvent.click(within(dialog).getByRole("button", { name: "Play Track" }));
  expect(calls.at(-1)).toEqual({ path: "/api/for-later/track/load", method: "POST", body: { mode: "play" } });
});

test("a failed Play from details exposes the source error inside the dialog", async () => {
  await render(); missing = true;
  await click("Details Evening movie");
  const dialog = await screen.findByRole("dialog", { name: "Evening movie" });
  await userEvent.click(within(dialog).getByRole("button", { name: "Play Evening movie" }));
  expect((await within(dialog).findByRole("alert")).textContent).toContain("Source unavailable");
  expect(items).toHaveLength(2);
});
