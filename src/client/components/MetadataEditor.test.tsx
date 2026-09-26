import { setupUiTests, renderWithQueryClient, screen, testWindow, userEvent } from "@/testing/react";
import { beforeEach, expect, spyOn, test } from "bun:test";
import * as core from "@tauri-apps/api/core";
import type { MetadataView } from "../../shared/metadata";
import { MetadataEditor } from "./MetadataEditor";

setupUiTests();

const metadata: MetadataView = {
  id: "movie-1", type: "movie", revision: "revision-1", match: null,
  values: { title: "Movie", originalTitle: null, showTitle: null, plot: null, year: null, premiered: null, genres: [], season: null, episode: null, artworkId: null },
  origins: Object.fromEntries(["title", "originalTitle", "showTitle", "plot", "year", "premiered", "genres", "season", "episode", "artworkId"].map(key => [key, "Imported/local"])) as MetadataView["origins"],
};
const archive = new Uint8Array([1, 2, 3, 4]);
let request: ReturnType<typeof spyOn>, invoke: ReturnType<typeof spyOn>;
let user: ReturnType<typeof userEvent.setup>;
let result: boolean | string;
let interrupted: boolean;

beforeEach(() => {
  testWindow.happyDOM.setURL("http://tauri.localhost");
  Object.assign(window, { __COUCH_NATIVE_HOST__: true });
  user = userEvent.setup();
  result = true;
  interrupted = false;
  invoke = spyOn(core, "invoke").mockImplementation(async <T,>(): Promise<T> => {
    if (typeof result === "string") throw result;
    return result as T;
  });
  request = spyOn(globalThis, "fetch").mockImplementation((async (_input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === "POST") {
      if (interrupted) return new Response(new ReadableStream({ start(controller) { controller.error(new Error("Transfer interrupted")); } }));
      return new Response(archive, { headers: { "Content-Type": "application/x-tar" } });
    }
    return Response.json(metadata);
  }) as typeof fetch);
});

async function openEditor() {
  renderWithQueryClient(<MetadataEditor origin="http://selected-host" token="selected-token" id="movie-1" connected onSaved={() => {}} />);
  await user.click(screen.getByRole("button", { name: "Edit details" }));
  await screen.findByRole("button", { name: "Export" });
}

const save = () => user.click(screen.getByRole("button", { name: "Export" }));

test("native export sends authenticated selected host bytes to the save dialog", async () => {
  await openEditor();
  await save();
  expect(await screen.findByRole("status")).toHaveTextContent("Exported.");
  const [url, init] = request.mock.calls.at(-1)!;
  expect(url).toBe("http://selected-host/api/metadata/items/movie-1/export");
  expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer selected-token");
  expect(invoke).toHaveBeenCalledWith("save_metadata_export", archive, { headers: { "X-Couch-Item-Id": "movie-1" } });
});

test("cancel and denied destination report the outcome", async () => {
  result = false;
  await openEditor();
  await save();
  expect(await screen.findByRole("status")).toHaveTextContent("Canceled.");
  result = "Couldn't save the metadata archive: Permission denied. No complete file was saved.";
  await save();
  expect(await screen.findByRole("alert")).toHaveTextContent("Permission denied");
});

test("interrupted transfer never opens the native save dialog", async () => {
  interrupted = true;
  await openEditor();
  await save();
  expect(await screen.findByRole("alert")).toHaveTextContent("Export interrupted");
  expect(invoke).not.toHaveBeenCalled();
});

test("browser export keeps its download action", async () => {
  Object.assign(window, { __COUCH_NATIVE_HOST__: false });
  const create = spyOn(URL, "createObjectURL").mockReturnValue("blob:archive");
  const click = spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  await openEditor();
  await save();
  expect(await screen.findByRole("status")).toHaveTextContent("Downloaded.");
  expect(create).toHaveBeenCalledTimes(1);
  expect(click).toHaveBeenCalledTimes(1);
  expect(invoke).not.toHaveBeenCalled();
});

test("artwork and match removal submit the selected corrections", async () => {
  request.mockImplementation(async (_input: RequestInfo | URL) => Response.json(metadata));
  await openEditor();
  await user.click(screen.getByRole("checkbox", { name: "Remove artwork" }));
  await user.click(screen.getByRole("checkbox", { name: "Clear TMDB match" }));
  await user.click(screen.getByRole("button", { name: "Save" }));
  expect(await screen.findByRole("status")).toHaveTextContent("Saved.");
  const post = request.mock.calls.find((call: unknown[]) => (call[1] as RequestInit | undefined)?.method === "POST");
  expect(JSON.parse(String((post?.[1] as RequestInit | undefined)?.body))).toMatchObject({ changes: { artworkId: null }, clearMatch: true });
});
