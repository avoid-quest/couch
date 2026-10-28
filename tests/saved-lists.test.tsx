import { expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRootRoute, createRouter, RouterContextProvider } from "@tanstack/react-router";
import type { ClientSessionState } from "../src/client/session/session";

// Render Saved without starting SessionGate's browser media renderer.
mock.module("../src/client/session/session-context", () => ({ useOptionalSessionGate: () => null, useSessionGate: () => null }));
const { SavedSections } = await import("../src/client/sections/saved/SavedSections");

const queue = ["one", "two", "three"].map(id => ({ id, title: id, source: `https://example.com/${id}` }));
function view(currentEntryId: string | null, queueCursorEntryId?: string, saved = true) {
  const client = new QueryClient();
  client.setQueryData(["playlists", "list"], { playlists: saved ? [{ id: "saved", name: "Saved list", revision: 1, entryCount: 1, totalDuration: null, source: null }] : [] });
  const router = createRouter({ routeTree: createRootRoute(), history: createMemoryHistory({ initialEntries: ["/saved?tab=lists"] }) });
  try {
    return renderToStaticMarkup(<RouterContextProvider router={router}><QueryClientProvider client={client}>
      <SavedSections state={{ queue, currentEntryId, queueCursorEntryId } as ClientSessionState} credentials={{ origin: "http://localhost", token: "test" }}
        connected canPlay tab="lists" onTabChange={() => {}} onFind={() => {}} onEnqueueProvider={async () => true} onEnqueueRadio={async () => true} onOpenProvider={() => {}} />
    </QueryClientProvider></RouterContextProvider>);
  } finally { client.clear(); }
}
const saveButton = (html: string) => html.match(/<button\b[^>]*>Save as list<\/button>/)?.[0];

test("Saved's Save as list uses the remaining queue even when played entries remain", () => {
  for (const [current, cursor] of [["three", "two"], [null, "three"]] as const) {
    const button = saveButton(view(current, cursor));
    expect(button).toBeDefined();
    expect(button).toMatch(/\sdisabled(?:=|[\s>])/);
    expect(saveButton(view(current, cursor, false))).toBeUndefined();
  }
  for (const [current, cursor] of [["two", "one"], [null, "two"], [null, undefined]] as const) {
    const button = saveButton(view(current, cursor));
    expect(button).toBeDefined();
    expect(button).not.toMatch(/\sdisabled(?:=|[\s>])/);
  }
});
