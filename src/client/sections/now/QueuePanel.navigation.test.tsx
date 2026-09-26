import { setupUiTests, render as renderUI, act, screen, createTestQueryClient } from "@/testing/react";
import { beforeEach, expect, test } from "bun:test";
import type { SessionState } from "../../../shared/protocol";
import { applyTvNavigation } from "../../navigation";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

setupUiTests();

let queryClient: QueryClient;

let view: ReturnType<typeof renderUI>, QueuePanel: typeof import("./QueuePanel").QueuePanel;
let closeCount = 0;
const queue = ["one", "two", "three"].map(id => ({ id, title: id, source: `https://media.example/${id}` }));
const state: SessionState = { queue, currentEntryId: "one", queueCursorEntryId: "one", activeProfile: { id: "household", name: "Household" }, player: { playbackId: "playing", status: "playing", position: 5, duration: 100, volume: 80, seekable: true, error: null } };
const render = (value: SessionState) => act(async () => view.rerender(<div data-player-sheet role="dialog"><button onClick={() => closeCount++}>Close</button><QueryClientProvider client={queryClient}><QueuePanel state={value} credentials={{ origin: "http://localhost", token: "paired" }} connected available nativeHost={false} defaultQuality="best" run={async () => true} /></QueryClientProvider></div>));
const play = (id: string) => screen.getByRole("button", { name: `Play ${id}` });

beforeEach(async () => {
  closeCount = 0;
  queryClient = createTestQueryClient();
  ({ QueuePanel } = await import("./QueuePanel"));
  view = renderUI(<></>);
  await render(state);
});

test("focus follows an upcoming item when it becomes played", async () => {
  await act(async () => play("two").focus());
  await render({ ...state, currentEntryId: "two", queueCursorEntryId: "two" });
  expect(document.activeElement).toBe(play("three"));
  await render({ ...state, currentEntryId: "three", queueCursorEntryId: "three" });
  expect(document.activeElement).toBe(play("two"));
});

test("removing the focused last upcoming row restores Close for D-pad selection", async () => {
  const lastUpcoming = { ...state, queue: queue.slice(0, 2) };
  await render(lastUpcoming);
  await act(async () => screen.getByRole("button", { name: "Remove two" }).focus());
  await render({ ...lastUpcoming, queue: queue.slice(0, 1) });
  const close = screen.getByRole("button", { name: "Close" });
  expect(document.activeElement).toBe(close);
  close.getClientRects = () => [close.getBoundingClientRect()] as unknown as DOMRectList;
  screen.getByRole("dialog").getClientRects = close.getClientRects;
  await act(async () => { applyTvNavigation("select"); });
  expect(closeCount).toBe(1);
});

test("removing the focused last upcoming row restores Find on the idle page", async () => {
  const idle = { ...state, currentEntryId: null, queueCursorEntryId: null, queue: queue.slice(1, 2) };
  const renderIdle = (value: SessionState) => act(async () => view.rerender(<section data-player-idle data-page="Now"><button data-page-first onClick={() => closeCount++}>Find something to play</button><QueryClientProvider client={queryClient}><QueuePanel state={value} credentials={{ origin: "http://localhost", token: "paired" }} connected available nativeHost={false} defaultQuality="best" run={async () => true} /></QueryClientProvider></section>));
  await renderIdle(idle);
  await act(async () => screen.getByRole("button", { name: "Remove two" }).focus());
  await renderIdle({ ...idle, queue: [] });
  const find = screen.getByRole("button", { name: "Find something to play" });
  expect(find).toHaveFocus();
  find.getClientRects = () => [find.getBoundingClientRect()] as unknown as DOMRectList;
  await act(async () => { applyTvNavigation("select"); });
  expect(closeCount).toBe(1);
});
