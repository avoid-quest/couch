import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as core from "@tauri-apps/api/core";
import { Window } from "happy-dom";
import { act } from "react";
import type { Root } from "react-dom/client";
import { fireEvent, screen } from "@/testing";
import type { MetadataView } from "../../shared/metadata";

const metadata: MetadataView = {
  id: "movie-1", type: "movie", revision: "revision-1", match: null,
  values: { title: "Movie", originalTitle: null, showTitle: null, plot: null, year: null, premiered: null, genres: [], season: null, episode: null, artworkId: null },
  origins: Object.fromEntries(["title", "originalTitle", "showTitle", "plot", "year", "premiered", "genres", "season", "episode", "artworkId"].map(key => [key, "Imported/local"])) as MetadataView["origins"],
};
const archive = new Uint8Array([1, 2, 3, 4]);
const originalGlobals = new Map<string, PropertyDescriptor | undefined>();
let window: Window, root: Root, request: ReturnType<typeof spyOn>, invoke: ReturnType<typeof spyOn>;
let result: boolean | string = true;
let interrupted = false;
const flush = () => act(async () => { await Bun.sleep(20); });

beforeEach(async () => {
  window = new Window({ url: "http://tauri.localhost" });
  Object.assign(window, { __COUCH_NATIVE_HOST__: true });
  for (const key of ["window", "document", "navigator", "location", "HTMLElement", "HTMLInputElement", "HTMLButtonElement", "HTMLFormElement", "Element", "Node", "DocumentFragment", "MutationObserver", "ResizeObserver", "Event", "MouseEvent", "getComputedStyle", "IS_REACT_ACT_ENVIRONMENT"]) {
    originalGlobals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    const value = key === "IS_REACT_ACT_ENVIRONMENT" ? true : key === "window" ? window : Reflect.get(window, key);
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  result = true; interrupted = false;
  invoke = spyOn(core, "invoke").mockImplementation(async <T,>(): Promise<T> => {
    if (typeof result === "string") throw result;
    return result as T;
  });
  request = spyOn(globalThis, "fetch").mockImplementation((async (input: RequestInfo | URL, init?: RequestInit) => {
    expect(String(input).startsWith("http://selected-host/api/metadata/items/movie-1")).toBe(true);
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer selected-token");
    if (init?.method === "POST") {
      if (interrupted) return new Response(new ReadableStream({ start(controller) { controller.error(new Error("Transfer interrupted")); } }));
      return new Response(archive, { headers: { "Content-Type": "application/x-tar" } });
    }
    return Response.json(metadata);
  }) as typeof fetch);
  const { createRoot } = await import("react-dom/client");
  root = createRoot(document.body.appendChild(document.createElement("div")));
});

afterEach(async () => {
  await act(async () => root.unmount());
  request.mockRestore(); invoke.mockRestore();
  await window.happyDOM.abort();
  for (const [key, descriptor] of originalGlobals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  originalGlobals.clear();
});

async function openEditor(button = "Save metadata archive") {
  const { MetadataEditor } = await import("./MetadataEditor");
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => root.render(<QueryClientProvider client={client}><MetadataEditor origin="http://selected-host" token="selected-token" id="movie-1" connected onSaved={() => {}} /></QueryClientProvider>));
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Edit metadata" })));
  await flush();
  await screen.findByRole("button", { name: button });
}

async function save() {
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Save metadata archive" })));
  await flush();
}

test("native export sends selected host bytes to the save dialog", async () => {
  await openEditor(); await save();
  expect(request.mock.calls.at(-1)?.[0]).toBe("http://selected-host/api/metadata/items/movie-1/export");
  expect(invoke).toHaveBeenCalledWith("save_metadata_export", archive, { headers: { "X-Couch-Item-Id": "movie-1" } });
  expect(screen.getByRole("status").textContent).toContain("Metadata archive saved");
});

test("cancel and denied destination report the outcome", async () => {
  result = false;
  await openEditor(); await save();
  expect(screen.getByRole("status").textContent).toContain("No file was saved");
  result = "Could not save the metadata archive: Permission denied. No complete file was saved.";
  await save();
  expect(screen.getByText(/Permission denied/)).toBeDefined();
});

test("interrupted transfer never opens the native save dialog", async () => {
  interrupted = true;
  await openEditor(); await save();
  expect(invoke).not.toHaveBeenCalled();
  expect(screen.getByText(/Metadata transfer stopped/)).toBeDefined();
});

test("browser export keeps its download action", async () => {
  Object.assign(window, { __COUCH_NATIVE_HOST__: false });
  const create = spyOn(URL, "createObjectURL").mockReturnValue("blob:archive");
  const click = spyOn(window.HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  try {
    await openEditor("Download saved metadata");
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Download saved metadata" })));
    await flush();
    expect(create).toHaveBeenCalledTimes(1);
    expect(click).toHaveBeenCalledTimes(1);
    expect(invoke).not.toHaveBeenCalled();
    expect(screen.getByRole("status").textContent).toContain("browser's download destination");
  } finally {
    create.mockRestore(); click.mockRestore();
  }
});
