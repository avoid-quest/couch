import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Window } from "happy-dom";
import { act } from "react";
import type { Root } from "react-dom/client";
import { createRadio } from "../../../../server/radio";
import { createRadioSettings } from "../../../../server/radio-settings";
import { fireEvent, screen } from "../../../testing";

let root: Root, window: Window, request: ReturnType<typeof spyOn>, radio: ReturnType<typeof createRadio>;
let client: QueryClient;
const originals = new Map<string, PropertyDescriptor | undefined>();

beforeEach(async () => {
  window = new Window({ url: "http://localhost" });
  for (const key of ["window", "document", "navigator", "HTMLElement", "HTMLInputElement", "Event", "MouseEvent", "IS_REACT_ACT_ENVIRONMENT"]) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: key === "IS_REACT_ACT_ENVIRONMENT" ? true : key === "window" ? window : (window as unknown as Record<string, unknown>)[key] });
  }
  radio = createRadio({ databasePath: ":memory:", fetch: (async () => new Response("#EXTM3U\n#EXTINF:-1,Fixture station\nhttps://stream.example/radio\n")) as unknown as typeof fetch });
  const handler = createRadioSettings(radio);
  request = spyOn(globalThis, "fetch").mockImplementation(((input: RequestInfo | URL, init?: RequestInit) => handler.handle(new Request(input, init), () => ({ authority: "administrator", controller: null, claimAvailable: false }))) as typeof fetch);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { createRoot } = await import("react-dom/client");
  root = createRoot(document.body.appendChild(document.createElement("div")));
});

afterEach(async () => {
  await act(async () => root.unmount());
  client.clear();
  request.mockRestore();
  radio.close();
  await window.happyDOM.abort();
  for (const [key, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  originals.clear();
});

test("radio Sources imports through the server's JSON contract and clears the saved form", async () => {
  const { RadioSettings } = await import("./RadioSettings");
  await act(async () => root.render(<QueryClientProvider client={client}><RadioSettings connected canManage credentials={{ origin: "http://localhost", token: "paired" }} /></QueryClientProvider>));
  await act(async () => {
    fireEvent.input(screen.getByRole("textbox", { name: "Playlist name" }), { target: { value: "Fixture playlist" } });
    fireEvent.input(screen.getByRole("textbox", { name: "M3U playlist URL" }), { target: { value: "https://feed.example/radio.m3u" } });
  });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Import playlist" })); await Bun.sleep(0); });
  expect(radio.playlists()).toMatchObject([{ name: "Fixture playlist", stationCount: 1 }]);
  expect(screen.queryByRole("alert")).toBeNull();
  expect((screen.getByRole("textbox", { name: "Playlist name" }) as HTMLInputElement).value).toBe("");
});
