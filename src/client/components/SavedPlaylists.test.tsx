import { setupUiTests, render as renderUI, screen, waitFor, userEvent, createTestQueryClient } from "../testing/react";
import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { act } from "react";
import { toast } from "sonner";
import { type QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SessionGateContext } from "@/session/gate-context";

setupUiTests();

let queryClient: QueryClient;

let view: ReturnType<typeof renderUI>, request: ReturnType<typeof spyOn>;
const writes: Array<{ path: string; method: string; body: unknown }> = [];
const playlist = { id: "friday", name: "Friday night", revision: 3, updatedAt: 1, source: null, entries: [{ id: "movie", title: "Evening movie" }] };
const button = (name: string) => screen.getByRole("button", { name });
let user: ReturnType<typeof userEvent.setup>;
const click = (node: HTMLElement) => user.click(node);
// The session's Undo toast, as SessionGate offers it.
const session = { state: null, offerUndo: (text: string, undo: () => Promise<void>, duration = 6_000) => toast(text, { duration, action: { label: "Undo", onClick: () => void undo() } }) };
const render = async (queueCount = 1) => {
  const { SavedPlaylists } = await import("./SavedPlaylists");
  await act(async () => view.rerender(<QueryClientProvider client={queryClient}><SessionGateContext.Provider value={session as never}><SavedPlaylists origin="http://localhost" token="paired" connected canPlay queueCount={queueCount} /></SessionGateContext.Provider></QueryClientProvider>));
  await screen.findByRole("button", { name: /^Open / });
};
const undo = async () => {
  const latest = toast.getToasts().at(-1);
  const action = latest && "action" in latest ? latest.action : undefined;
  expect(latest && "duration" in latest ? latest.duration : null).toBe(6_000);
  expect(action && typeof action === "object" && "label" in action ? action.label : null).toBe("Undo");
  await act(async () => { if (action && typeof action === "object" && "onClick" in action) action.onClick({} as React.MouseEvent<HTMLButtonElement>); });
};

beforeEach(async () => {
  writes.length = 0;
  user = userEvent.setup();
  queryClient = createTestQueryClient();
  request = spyOn(globalThis, "fetch").mockImplementation((async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(String(input)).pathname;
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer paired");
    if (init?.method) { writes.push({ path, method: init.method, body: JSON.parse(String(init.body)) }); return Response.json({ ok: true, ...(init.method === "DELETE" ? { undoToken: "restore-token" } : {}) }); }
    return Response.json(path === "/api/playlists" ? { playlists: [{ ...playlist, entryCount: 1, totalDuration: 2700 }] } : { playlist });
  }) as typeof fetch);
  view = renderUI(null);
});
afterEach(() => { toast.dismiss(); });

test("Lists opens a list, queues it and offers Undo after deletion", async () => {
  await render();
  await click(button("Open Friday night"));
  await screen.findByRole("button", { name: "Delete" });
  expect(await screen.findByRole("heading", { name: "Friday night" })).toBeInTheDocument();
  await waitFor(() => expect(button("Lists")).toHaveFocus());
  expect(writes).toEqual([]);
  await click(button("Queue"));
  expect(writes).toEqual([{ path: "/api/playlists/friday/load", method: "POST", body: { revision: 3, mode: "append" } }]);
  expect(toast.getToasts().at(-1)).toMatchObject({ title: "Queued Friday night." });
  await click(button("Delete"));
  expect(writes.at(-1)).toEqual({ path: "/api/playlists/friday", method: "DELETE", body: { revision: 3 } });
  expect(await screen.findByRole("heading", { name: "Lists" })).toBeInTheDocument();
  await undo();
  expect(writes.at(-1)).toEqual({ path: "/api/playlists/restore", method: "POST", body: { token: "restore-token" } });
});

test("Lists shows total length and saves Up next with its generated name", async () => {
  await render(2);
  expect(screen.getByText("1 item · 45:00")).toBeInTheDocument();
  await click(button("Save Up next as a list"));
  expect(writes.at(-1)).toEqual({ path: "/api/playlists", method: "POST", body: { name: expect.stringMatching(/^Up next, /), scope: "upNext" } });
  await click(button("Open Friday night"));
  await screen.findByRole("button", { name: "Delete" });
  await click(button("Lists"));
  await waitFor(() => expect(button("Open Friday night")).toHaveFocus());
});

test("Update from Up next confirms before replacing the list", async () => {
  await render(2);
  await click(button("Open Friday night"));
  await screen.findByRole("button", { name: "Delete" });
  await click(button("Update from Up next"));
  expect(screen.getByRole("alertdialog")).toHaveTextContent("Its items become the 2 in Up next.");
  expect(writes).toEqual([]);
  await click(button("Replace"));
  expect(writes).toEqual([{ path: "/api/playlists/friday", method: "POST", body: { revision: 3, operation: "saveQueue" } }]);
});

test("an empty Up next cannot be saved and says why", async () => {
  await render(0);
  expect(button("Save Up next as a list")).toBeDisabled();
  expect(screen.getByText("Queue something first.")).toBeInTheDocument();
});

const sources = {
  youtube: { provider: "youtube", url: "https://www.youtube.com/playlist?list=PL1234567890" },
  raiplay: { provider: "raiplay", url: "https://www.raiplay.it/programmi/report" },
  bandcamp: { provider: "bandcamp", url: "https://artist.bandcamp.com/album/public" },
  // Shaped like the StreamingCommunity title saves from #345: the resolved
  // title name with capturePlaylistEntries-shaped entries.
  streamingcommunity: { provider: "streamingcommunity", url: "https://streamingcommunityz.academy/title/1234" },
} as const;
const providerLabels = { youtube: "YouTube", raiplay: "RaiPlay", bandcamp: "Bandcamp", streamingcommunity: "StreamingCommunity" };

for (const [provider, source] of Object.entries(sources)) test(`${provider} source-saved playlists show the provider and load and remove like queue saves`, async () => {
  const saved = { id: "source-list", name: "Evening list", revision: 2, updatedAt: 1, source, entries: [{ id: "ep-1", title: "Pilot", duration: 2700 }] };
  request.mockImplementation((async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(String(input)).pathname;
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer paired");
    if (init?.method) { writes.push({ path, method: init.method, body: JSON.parse(String(init.body)) }); return Response.json({ ok: true, ...(init.method === "DELETE" ? { undoToken: "restore-token" } : {}) }); }
    return Response.json(path === "/api/playlists" ? { playlists: [{ ...saved, entryCount: 1, totalDuration: 2700 }] } : { playlist: saved });
  }) as typeof fetch);
  await render();
  expect(screen.getByText(`${providerLabels[provider as keyof typeof sources]} · 1 item · 45:00`)).toBeInTheDocument();
  await click(button("Open Evening list"));
  await screen.findByRole("button", { name: "Delete" });
  expect(writes).toEqual([]);
  await click(button("Queue"));
  expect(writes.at(-1)).toEqual({ path: "/api/playlists/source-list/load", method: "POST", body: { revision: 2, mode: "append" } });
  await click(button("Delete"));
  expect(writes.at(-1)).toEqual({ path: "/api/playlists/source-list", method: "DELETE", body: { revision: 2 } });
});
