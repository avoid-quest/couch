import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { Window } from "happy-dom";
import { act } from "react";
import type { Root } from "react-dom/client";
import type { CollectionPreview } from "../shared/collections";

let root: Root, window: Window, request: ReturnType<typeof spyOn>;
const originals = new Map<string, PropertyDescriptor | undefined>();
let preview: CollectionPreview;
const writes: unknown[] = [];
const flush = () => act(async () => { await Bun.sleep(10); });
const button = (label: string) => [...document.querySelectorAll("button")].find(node => node.getAttribute("aria-label") === label || node.textContent === label)!;
const click = async (label: string) => { await act(async () => button(label).click()); await flush(); };
async function render(version = 1, active = true) {
  const { CollectionsPanel } = await import("./CollectionsPanel");
  await act(async () => root.render(<CollectionsPanel origin="http://localhost" token="paired" connected canPlay version={version} active={active} />));
  await flush();
}
async function type(value: string) {
  await act(async () => { const input = document.querySelector<HTMLInputElement>("#collection-name")!; Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!.call(input, value); input.dispatchEvent(new window.Event("input", { bubbles: true })); });
}
beforeEach(async () => {
  writes.length = 0;
  preview = { collection: { id: "films", name: "Film night", revision: 1, updatedAt: 1, sort: "manual", descending: false, filter: null, members: [{ id: "film", title: "Movie" }] }, items: [{ id: "film", title: "Movie", kind: "video", duration: null, artist: null, album: null, available: true }], total: 1, digest: "initial" };
  window = new Window({ url: "http://localhost" });
  for (const key of ["window", "document", "navigator", "HTMLElement", "HTMLInputElement", "HTMLSelectElement", "HTMLButtonElement", "HTMLFormElement", "Element", "Node", "NodeFilter", "DocumentFragment", "MutationObserver", "ResizeObserver", "CustomEvent", "Event", "MouseEvent", "PointerEvent", "KeyboardEvent", "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame", "IS_REACT_ACT_ENVIRONMENT"]) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    const value = key === "IS_REACT_ACT_ENVIRONMENT" ? true : key === "window" ? window : Reflect.get(window, key);
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: typeof value === "function" && /^[a-z]/.test(key) ? value.bind(window) : value });
  }
  request = spyOn(globalThis, "fetch").mockImplementation((async (input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method) { writes.push(JSON.parse(String(init.body))); return Response.json({ error: "This collection changed on another controller. Reload before saving." }, { status: 409 }); }
    const path = new URL(String(input)).pathname;
    return Response.json(path === "/api/collections" ? { collections: [preview.collection] } : path === "/api/library/items" ? { items: [], total: 0, offset: 0, limit: 30 } : preview);
  }) as typeof fetch);
  const { createRoot } = await import("react-dom/client");
  const container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  await render();
});
afterEach(async () => {
  await act(async () => root.unmount()); request.mockRestore(); await window.happyDOM.abort();
  for (const [key, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  originals.clear();
});

test("broadcasts retain device-local selection and preserve draft revision on a concurrent edit", async () => {
  await click("Film night1 movies");
  await click("Edit collection");
  await type("My unfinished edit");
  preview = { ...preview, collection: { ...preview.collection, name: "Other controller", revision: 2 }, digest: "changed" };
  await render(2, false); await render(2, true);
  expect(document.querySelector<HTMLInputElement>("#collection-name")?.value).toBe("My unfinished edit");
  expect(document.body.textContent).toContain("Your draft is still here");
  await click("Save collection");
  expect(writes[0]).toMatchObject({ revision: 1, definition: { name: "My unfinished edit" } });
  expect(document.querySelector<HTMLInputElement>("#collection-name")?.value).toBe("My unfinished edit");
  await click("Cancel editing");
  expect(document.querySelector("h3")?.textContent).toBe("Other controller");
});

test("load sends the displayed digest and revision then requires review of a rejected preview", async () => {
  await click("Film night1 movies");
  await click("Add preview to queue");
  expect(writes[0]).toEqual({ revision: 1, digest: "initial", mode: "append" });
  preview = { ...preview, items: [{ ...preview.items[0]!, available: false }], digest: "offline" };
  await render(2);
  expect(button("Play preview").disabled).toBeTrue();
  expect(button("Add preview to queue").disabled).toBeTrue();
  expect(document.body.textContent).toContain("0 available · 1 missing");
});
