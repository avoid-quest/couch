import { setupUiTests, render, screen, within, userEvent, act, createTestQueryClient, waitFor } from "@/testing/react";
import { afterEach, expect, spyOn, test } from "bun:test";
import { QueryClientProvider } from "@tanstack/react-query";
import { openStore } from "../../../server/store";
import { createSession } from "../../../server/session";
import { createPlaylists } from "../../../server/playlists";
import { PlaybackClockContext } from "@/session/playback-clock";
import { QueuePanel } from "./QueuePanel";
import type { Action, SessionState } from "../../../shared/protocol";

setupUiTests();
const cleanup: (() => void)[] = [];
afterEach(() => { for (const close of cleanup.splice(0).reverse()) close(); });

function fixture() {
  const store = openStore(":memory:");
  let show = (_state: SessionState) => {};
  const session = createSession(store, () => {}, state => show(state));
  cleanup.push(() => { session.close(); store.close(); });
  session.observe({ playbackId: null, status: "idle", position: 0, duration: null, volume: 80, seekable: false, error: null });
  for (const id of ["one", "two", "three", "four"]) session.command({ type: "enqueue", entry: { id, title: id, source: `https://media.example/${id}`, duration: 60 } });
  session.command({ type: "play", entryId: "one" });
  const client = createTestQueryClient();
  const view = render(<></>);
  const run = async (action: Action) => { session.command(action); return true; };
  show = state => view.rerender(<div data-player-sheet role="dialog"><button>Close</button><PlaybackClockContext.Provider value={state.player}><QueryClientProvider client={client}><QueuePanel state={state} credentials={{ origin: "http://localhost", token: "paired" }} connected available nativeHost={false} defaultQuality="auto" run={run} /></QueryClientProvider></PlaybackClockContext.Provider></div>);
  show(session.state);
  return { session };
}
const options = (title: string) => screen.getByRole("button", { name: `Options for ${title}` });
async function queueAction(title: string, action: string) {
  await userEvent.click(options(title));
  await userEvent.click(screen.getByRole("menuitem", { name: action }));
}
const titles = (list = "Up next") => within(screen.getByRole("list", { name: list })).getAllByRole("button", { name: /^Play / }).map(button => button.getAttribute("aria-label"));

test("queue reorder actions change upcoming order without moving the current item", async () => {
  const { session } = fixture();
  await queueAction("two", "Later");
  expect(titles()).toEqual(["Play three", "Play two", "Play four"]);
  expect(session.state.currentEntryId).toBe("one");
  await queueAction("two", "Later");
  expect(titles()).toEqual(["Play three", "Play four", "Play two"]);
  expect(document.activeElement).toBe(options("two"));
  await queueAction("two", "Earlier");
  await queueAction("two", "Earlier");
  expect(titles()).toEqual(["Play two", "Play three", "Play four"]);
  expect(document.activeElement).toBe(options("two"));
});

test("removing a focused queue entry keeps the remaining queue operable", async () => {
  fixture();
  await queueAction("three", "Remove");
  expect(titles()).toEqual(["Play two", "Play four"]);
  expect(document.activeElement?.getAttribute("aria-label")).toBe("Options for four");
  await queueAction("two", "Remove");
  await queueAction("four", "Remove");
  expect(screen.getByText("Nothing queued")).toBeInTheDocument();
  expect(document.activeElement).toBe(screen.getByRole("switch", { name: "Autoplay" }));
});

test("playing a later upcoming entry keeps the skipped entries upcoming", async () => {
  const { session } = fixture();
  await userEvent.click(screen.getByRole("button", { name: "Play four" }));
  expect(session.state.currentEntryId).toBe("four");
  expect(titles()).toEqual(["Play two", "Play three"]);
  expect(screen.queryByRole("list", { name: "Played" })).toBeNull();
  await userEvent.click(screen.getByRole("button", { name: "Played" }));
  expect(titles("Played")).toEqual(["Play one"]);
  await act(async () => session.command({ type: "stop" }));
  expect(titles()).toEqual(["Play two", "Play three"]);
  expect(titles("Played")).toEqual(["Play four", "Play one"]);
});


test("named queue saves exclude current playback and let duplicate names be corrected", async () => {
  const { session } = fixture();
  const playlists = createPlaylists({ databasePath: ":memory:", onChange: () => {}, queue: () => session.state.queue, upNext: () => {
    const state = session.state;
    const cursor = state.queue.findIndex(entry => entry.id === (state.currentEntryId ?? state.queueCursorEntryId));
    return state.queue.slice(cursor + 1);
  }, loadQueue: () => {} });
  cleanup.push(() => playlists.close());
  const statuses: number[] = [];
  spyOn(globalThis, "fetch").mockImplementation((async (input, init) => {
    const response = await playlists.handle(new Request(String(input), init));
    statuses.push(response.status);
    return response;
  }) as typeof fetch);
  await userEvent.click(screen.getByRole("button", { name: "Save as list" }));
  await userEvent.type(screen.getByRole("textbox", { name: "List name" }), "Evening");
  await userEvent.click(screen.getByRole("button", { name: "Save list" }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Save as list" })).toBeNull());
  const saved = await (await playlists.handle(new Request("http://localhost/api/playlists"))).json() as { playlists: { id: string }[] };
  const detail = await (await playlists.handle(new Request(`http://localhost/api/playlists/${saved.playlists[0]!.id}`))).json() as { playlist: { entries: { id: string }[] } };
  expect(detail.playlist.entries.map(entry => entry.id)).toEqual(["two", "three", "four"]);
  await queueAction("two", "Remove");
  await userEvent.click(screen.getByRole("button", { name: "Save as list" }));
  await userEvent.type(screen.getByRole("textbox", { name: "List name" }), "Evening");
  await userEvent.click(screen.getByRole("button", { name: "Save list" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("A playlist already has that name.");
  expect(screen.getByRole("textbox", { name: "List name" })).toHaveValue("Evening");
  await userEvent.clear(screen.getByRole("textbox", { name: "List name" }));
  await userEvent.type(screen.getByRole("textbox", { name: "List name" }), "Weekend");
  await userEvent.click(screen.getByRole("button", { name: "Save list" }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Save as list" })).toBeNull());
  expect(statuses).toEqual([201, 409, 201]);
});


test("Play next moves a selected upcoming entry immediately after current playback", async () => {
  const { session } = fixture();
  await queueAction("four", "Play next");
  expect(titles()).toEqual(["Play four", "Play two", "Play three"]);
  expect(session.state.currentEntryId).toBe("one");
  expect(document.activeElement?.getAttribute("aria-label")).toBe("Options for four");
});

test("queue menus support keyboard navigation and restore the row action button", async () => {
  fixture();
  await act(async () => options("four").focus());
  await userEvent.keyboard("{Enter}");
  expect(screen.getByRole("menu")).toBeInTheDocument();
  await userEvent.keyboard("{End}");
  expect(screen.getByRole("menuitem", { name: "Remove" })).toHaveFocus();
  await userEvent.keyboard("{Escape}");
  expect(screen.queryByRole("menu")).toBeNull();
  expect(options("four")).toHaveFocus();
});

test("Save for later acts on the selected queue occurrence", async () => {
  fixture();
  const request = spyOn(globalThis, "fetch").mockResolvedValue(Response.json({}));
  await queueAction("three", "Save for later");
  expect(request).toHaveBeenCalledTimes(1);
  const [url, init] = request.mock.calls[0]!;
  expect(String(url)).toBe("http://localhost/api/for-later");
  expect(JSON.parse(String(init?.body))).toEqual({ reference: { kind: "queue", id: "three" } });
});

test("Played offers history actions without ineffective queue movement", async () => {
  const { session } = fixture();
  await act(async () => session.command({ type: "stop" }));
  await userEvent.click(screen.getByRole("button", { name: "Played" }));
  await userEvent.click(options("one"));
  expect(screen.queryByRole("menuitem", { name: "Play next" })).toBeNull();
  expect(screen.queryByRole("menuitem", { name: "Earlier" })).toBeNull();
  expect(screen.queryByRole("menuitem", { name: "Later" })).toBeNull();
  expect(screen.getByRole("menuitem", { name: "Save for later" })).toBeEnabled();
  expect(screen.getByRole("menuitem", { name: "Remove" })).toBeEnabled();
});

test("Cancel returns focus to Save as list", async () => {
  fixture();
  const trigger = screen.getByRole("button", { name: "Save as list" });
  await userEvent.click(trigger);
  await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(screen.queryByRole("dialog", { name: "Save as list" })).toBeNull();
  expect(trigger).toHaveFocus();
});
