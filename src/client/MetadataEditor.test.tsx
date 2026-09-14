import { afterEach, beforeEach, expect, mock, spyOn, test } from "bun:test";
import { Window } from "happy-dom";
import { act } from "react";
import type { Root } from "react-dom/client";
import type { MetadataPreview, MetadataView } from "../shared/metadata";

let root: Root, window: Window, Editor: typeof import("./MetadataEditor").MetadataEditor;
let request: ReturnType<typeof spyOn>;
const originals = new Map<string, PropertyDescriptor | undefined>();
const calls: Array<{ path: string; body: any; signal: AbortSignal }> = [];
const values = { title: "Imported movie", originalTitle: null, showTitle: null, plot: "Original plot", year: 2020, premiered: "2020-01-01", genres: ["Drama, mystery"], season: null, episode: null, artworkId: null };
const initial: MetadataView = { id: "item", type: "movie", revision: "revision-1", values, origins: Object.fromEntries(Object.keys(values).map(key => [key, "Imported/local"])) as MetadataView["origins"], match: null };
const preview: MetadataPreview = { id: "preview", expiresAt: Date.now() + 300_000, values: { ...values, title: "Chosen movie" }, match: { kind: "movie", id: 12, title: "Chosen movie" }, artwork: null };
const button = (label: string) => [...document.querySelectorAll("button")].find(node => node.textContent === label)!;
const click = (label: string) => act(async () => button(label).click());
const input = async (selector: string, value: string) => act(async () => {
  const field = document.querySelector<HTMLInputElement>(selector)!;
  Object.getOwnPropertyDescriptor((field.tagName === "TEXTAREA" ? window.HTMLTextAreaElement : window.HTMLInputElement).prototype, "value")!.set!.call(field, value);
  field.dispatchEvent(new window.Event("input", { bubbles: true }) as unknown as Event);
});
const render = async (connected = true) => act(async () => root.render(<Editor origin="http://localhost" token="administrator-token" id="item" connected={connected} onSaved={() => {}} />));
beforeEach(async () => {
  window = new Window({ url: "http://localhost", settings: { disableErrorCapturing: true } }); calls.length = 0;
  for (const key of ["window", "document", "navigator", "HTMLElement", "HTMLInputElement", "FileReader", "Element", "Node", "MutationObserver", "NodeFilter", "DocumentFragment", "CustomEvent", "HTMLButtonElement", "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame", "Event", "MouseEvent", "setTimeout", "clearTimeout", "IS_REACT_ACT_ENVIRONMENT"]) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    const value = key === "IS_REACT_ACT_ENVIRONMENT" ? true : key === "window" ? window : Reflect.get(window, key);
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: typeof value === "function" && /^[a-z]/.test(key) ? value.bind(window) : value });
  }
  request = spyOn(globalThis, "fetch").mockImplementation((async (url, init) => {
    const path = new URL(String(url)).pathname;
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    calls.push({ path, body, signal: init?.signal as AbortSignal });
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer administrator-token");
    if (path.endsWith("/search")) return Response.json({ items: [{ id: 12, title: "Chosen movie", year: "2020", description: "Candidate" }] });
    if (path.endsWith("/preview")) return Response.json(preview);
    if (path.endsWith("/edit")) return Response.json({ ...initial, revision: "revision-2", values: { ...values, ...body.changes } });
    if (path.endsWith("/match")) return Response.json({ ...initial, revision: "revision-2", values: preview.values, match: preview.match });
    if (path.endsWith("/export")) return new Response("bounded generated archive");
    return Response.json(initial);
  }) as typeof fetch);
  const { createRoot } = await import("react-dom/client");
  Editor = (await import("./MetadataEditor")).MetadataEditor;
  const container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => {
  const content = document.querySelector('[role="dialog"]');
  const onUnmount = mock();
  content?.addEventListener("focusScope.autoFocusOnUnmount", onUnmount);
  try {
    await act(async () => root.unmount());
    // Radix defers focus cleanup to a timeout; finish it before replacing DOM globals.
    await window.happyDOM.waitUntilComplete();
    if (content) expect(onUnmount).toHaveBeenCalledTimes(1);
  } finally {
    request.mockRestore(); await window.happyDOM.abort();
    for (const [key, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
    originals.clear();
  }
});

test("editor is local-only on the TV and saves only changed fields with the loaded revision", async () => {
  await render(); expect(calls).toHaveLength(0);
  expect(button("Edit metadata").closest("[data-tv-local-only]")).not.toBeNull();
  await click("Edit metadata");
  expect(document.body.textContent).toContain("Origin: Imported/local");
  await input('[data-metadata-field="title"]', "Manual movie"); await click("Save corrections");
  expect(calls.at(-1)?.body).toEqual({ revision: "revision-1", changes: { title: "Manual movie" } });
  expect(document.body.textContent).toContain("Metadata saved.");
});

test("a rejected stale edit keeps the draft and tells the owner to reload", async () => {
  await render(); await click("Edit metadata");
  await input('[data-metadata-field="title"]', "Keep my draft");
  request.mockResolvedValue(Response.json({ error: "This metadata changed on another device. Reload before saving." }, { status: 409 }));
  await click("Save corrections");
  expect(document.querySelector<HTMLInputElement>('[data-metadata-field="title"]')?.value).toBe("Keep my draft");
  expect(document.body.textContent).toContain("Reload before saving.");
  expect(button("Close and reopen to reload")).toBeDefined();
});

test("search and preview never apply a match until its explicit confirmation", async () => {
  await render(); await click("Edit metadata"); await click("Search TMDB");
  expect(calls.some(call => call.path.endsWith("/match"))).toBe(false);
  await click("Preview Chosen movie 2020");
  expect(document.body.textContent).toContain("Applying replaces all previewed fields");
  expect(calls.some(call => call.path.endsWith("/match"))).toBe(false);
  await click("Apply this match");
  expect(calls.at(-1)?.body).toEqual({ revision: "revision-1", previewId: "preview" });
  expect(document.querySelector<HTMLInputElement>('[data-metadata-field="title"]')?.value).toBe("Chosen movie");
});

test("browser export requires an explicit click and states its destination", async () => {
  await render(); await click("Edit metadata");
  expect(document.body.textContent).toContain("this browser's download destination");
  const download = spyOn(window.HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  try {
    expect(calls.some(call => call.path.endsWith("/export"))).toBe(false);
    await click("Download saved metadata");
    expect(calls.at(-1)?.body).toEqual({ revision: "revision-1" }); expect(download).toHaveBeenCalledTimes(1);
  } finally { download.mockRestore(); }
});

test("closing the editor aborts an export and ignores the late response", async () => {
  await render(); await click("Edit metadata");
  const gate = Promise.withResolvers<Response>(); let signal: AbortSignal | undefined;
  request.mockImplementation((async (_url, init) => { signal = init?.signal as AbortSignal; return gate.promise; }) as typeof fetch);
  const download = spyOn(window.HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  try {
    await click("Download saved metadata"); await click("Close metadata editor");
    expect(signal?.aborted).toBe(true);
    await act(async () => gate.resolve(new Response("late archive")));
    expect(download).not.toHaveBeenCalled();
  } finally { download.mockRestore(); }
});


test("disconnect retains title, plot, order and artwork, rejects a late lookup, and keeps the old revision for conflict detection", async () => {
  const episode = { ...initial, type: "episode", values: { ...values, showTitle: "Series", season: 1, episode: 7 } };
  request.mockResolvedValue(Response.json(episode));
  await render(); await click("Edit metadata");
  await input('[data-metadata-field="title"]', "Unsaved title");
  await input('[data-metadata-field="plot"]', "Unsaved plot");
  await input('[data-metadata-field="episode"]', "3");
  const file = new window.File([Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6aJcAAAAASUVORK5CYII=", "base64")], "image.png", { type: "image/png" });
  await act(async () => {
    const field = document.querySelector<HTMLInputElement>("[data-metadata-artwork]")!;
    Object.defineProperty(field, "files", { value: [file], configurable: true });
    field.dispatchEvent(new window.Event("change", { bubbles: true }) as unknown as Event);
    await window.happyDOM.waitUntilComplete();
  });
  expect(document.body.textContent).toContain("Artwork selected");
  const gate = Promise.withResolvers<Response>(); let signal: AbortSignal | undefined;
  request.mockImplementation((async (_url, init) => { signal = init?.signal as AbortSignal; return gate.promise; }) as typeof fetch);
  await click("Search TMDB"); await render(false);
  expect(signal?.aborted).toBe(true); expect(button("Save corrections").disabled).toBe(true);
  expect(document.body.textContent).toContain("Your draft is kept here");
  await render(true);
  await act(async () => gate.resolve(Response.json({ items: [{ id: 99, title: "Stale lookup", year: "2020", description: "Old response" }] })));
  expect(document.body.textContent).not.toContain("Stale lookup");
  expect(document.querySelector<HTMLInputElement>('[data-metadata-field="title"]')?.value).toBe("Unsaved title");
  expect(document.querySelector<HTMLTextAreaElement>('[data-metadata-field="plot"]')?.value).toBe("Unsaved plot");
  expect(document.querySelector<HTMLInputElement>('[data-metadata-field="episode"]')?.value).toBe("3");
  expect(document.body.textContent).toContain("Artwork selected");
  let submitted: any;
  request.mockImplementation((async (_url, init) => { submitted = JSON.parse(String(init?.body)); return Response.json({ error: "Reload before saving." }, { status: 409 }); }) as typeof fetch);
  await click("Save corrections");
  expect(submitted.revision).toBe("revision-1"); expect(submitted.changes).toEqual({ title: "Unsaved title", plot: "Unsaved plot", episode: 3 });
  expect(submitted.artwork).toBe(Buffer.from(await file.arrayBuffer()).toString("base64"));
  expect(document.body.textContent).toContain("Reload before saving.");
});


test("removing a selected artwork clears the visible file and unchecking never silently restores it", async () => {
  await render(); await click("Edit metadata");
  const field = document.querySelector<HTMLInputElement>("[data-metadata-artwork]")!;
  const transfer = new window.DataTransfer(); transfer.items.add(new window.File(["image bytes"], "replacement.png", { type: "image/png" }));
  await act(async () => {
    field.files = transfer.files as unknown as FileList;
    field.dispatchEvent(new window.Event("change", { bubbles: true }) as unknown as Event);
    await window.happyDOM.waitUntilComplete();
  });
  expect(field.value).toContain("replacement.png");
  expect(document.body.textContent).toContain("Artwork selected");
  const remove = document.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
  await act(async () => remove.click());
  expect(field.value).toBe(""); expect(document.body.textContent).not.toContain("Artwork selected");
  await act(async () => remove.click());
  await input('[data-metadata-field="title"]', "Other correction"); await click("Save corrections");
  expect(calls.at(-1)?.body).toEqual({ revision: "revision-1", changes: { title: "Other correction" } });
});

test("a successful provider status retry clears the old load error", async () => {
  const { MetadataSettings } = await import("./MetadataSettings");
  request.mockResolvedValueOnce(Response.json({ error: "Temporary status failure" }, { status: 503 }));
  const settings = async (version: number) => act(async () => root.render(<MetadataSettings credentials={{ origin: "http://localhost", token: "administrator-token" }} connected canManage version={version} />));
  await settings(1);
  expect(document.body.textContent).toContain("Temporary status failure");
  request.mockResolvedValueOnce(Response.json({ configured: true }));
  await settings(2);
  expect(document.body.textContent).toContain("TMDB token configured");
  expect(document.body.textContent).not.toContain("Temporary status failure");
});

test("video details show metadata controls only while the viewer can administer them", async () => {
  const { VideoLibraryPanel } = await import("./VideoLibraryPanel");
  request.mockResolvedValue(Response.json({ items: [{ id: "item", title: "Movie details", kind: "video", available: true, duration: null, artist: null, album: null, video: { ...values, type: "movie" } }], total: 1, offset: 0, limit: 30 }));
  const panel = async (canManage: boolean) => act(async () => root.render(<VideoLibraryPanel origin="http://localhost" token="administrator-token" connected canPlay canManage={canManage} active version={1} view="movies" onEnqueue={async () => true} />));
  await panel(false);
  await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="Details for Movie details"]')!.click());
  expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  expect(button("Edit metadata")).toBeUndefined();
  await panel(true); expect(button("Edit metadata")).toBeDefined();
  await panel(false); expect(button("Edit metadata")).toBeUndefined();
});
