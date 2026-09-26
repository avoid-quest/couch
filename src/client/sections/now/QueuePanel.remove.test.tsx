import { setupUiTests, render as renderUI, act, screen, userEvent, createTestQueryClient } from "@/testing/react";
import { beforeEach, expect, test } from "bun:test";
import type { Action, SessionState } from "../../../shared/protocol";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

setupUiTests();

let queryClient: QueryClient;

let view: ReturnType<typeof renderUI>, QueuePanel: typeof import("./QueuePanel").QueuePanel;
const actions: Action[] = [];
const queue = ["one", "two", "three"].map(id => ({ id, title: id, source: `https://media.example/${id}` }));
const state: SessionState = { queue, currentEntryId: "one", queueCursorEntryId: "one", activeProfile: { id: "household", name: "Household" }, player: { playbackId: "playing", status: "playing", position: 5, duration: 100, volume: 80, seekable: true, error: null } };
beforeEach(async () => {
  actions.length = 0;
  queryClient = createTestQueryClient();
  ({ QueuePanel } = await import("./QueuePanel"));
  view = renderUI(<></>);
  await act(async () => view.rerender(<QueryClientProvider client={queryClient}><QueuePanel state={state} credentials={{ origin: "http://localhost", token: "paired" }} connected available nativeHost={false} defaultQuality="best" run={async action => { actions.push(action); return true; }} /></QueryClientProvider>));
});

test("a queue entry removes itself through the socket remove action", async () => {
  expect(actions).toEqual([]);
  await userEvent.click(screen.getByRole("button", { name: "Remove two" }));
  expect(actions).toEqual([{ type: "remove", entryId: "two" }]);
});
