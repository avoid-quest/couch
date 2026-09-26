import { setupUiTests, render, act, screen, userEvent, waitFor } from "@/testing/react";
import { expect, spyOn, test } from "bun:test";
import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { AppShell, useShell } from "./AppShell";
import { ShellProviders } from "./test-providers";
import { NativeModeGate } from "./PlaybackDevice";
import { FindPage } from "../find/FindPage";

setupUiTests();

function HomeOpener() {
  const shell = useShell();
  return <>{["first", "second"].map(id => <button key={id} id={id} aria-label="Details remembered show" onClick={() => shell.openProvider({ id: "show", title: "Remembered show", url: "https://streamingcommunityz.photos/it/titles/123-show", provider: "streamingcommunity", kind: "collection" }, `#${id}`)}>Browse episodes</button>)}</>;
}

for (const [origin, path] of [["Home", "/"], ["Saved", "/saved"]] as const) test(`provider browsing returns to its ${origin} origin and restores focus without playing`, async () => {
  const commands: unknown[] = [];
  spyOn(globalThis, "fetch").mockImplementation((async () => Response.json({ items: [], sources: [], favorites: [], title: "Remembered show" })) as unknown as typeof fetch);
  const gate = {
    credentials: { origin: "http://localhost", token: "host" }, connected: true, status: "connected", booting: false,
    state: { queue: [], currentEntryId: null, player: { status: "idle", position: 0, duration: null, volume: 50, playbackId: null }, activeProfile: { id: "household", name: "Household" } },
    identity: { authority: "host" }, details: {}, nativeHost: false, localHost: true, videoQualityPreference: { quality: "auto" },
    run: async (action: unknown) => { commands.push(action); return true; }, setError: () => {},
  };
  const base = createRootRoute({ component: () => <NativeModeGate><ShellProviders value={gate}><AppShell /></ShellProviders></NativeModeGate> });
  const home = createRoute({ getParentRoute: () => base, path: "/", component: HomeOpener });
  const saved = createRoute({ getParentRoute: () => base, path: "/saved", component: HomeOpener });
  const find = createRoute({ getParentRoute: () => base, path: "/find", loader: () => new Promise(resolve => setTimeout(resolve, 10)), component: FindPage });
  const history = createMemoryHistory({ initialEntries: [path] });
  const router = createRouter({ routeTree: base.addChildren([home, saved, find]), history });
  const view = render(<></>);
  await act(async () => { await router.load(); view.rerender(<RouterProvider router={router} />); });
  await act(async () => document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "/", bubbles: true, cancelable: true })));
  await waitFor(() => expect(document.getElementById("media-search")).toHaveFocus());
  await act(async () => router.navigate({ href: path }));
  await userEvent.click(screen.getAllByRole("button", { name: "Details remembered show" })[1]!);
  expect(history.location.pathname).toBe("/find");
  await userEvent.click(await screen.findByRole("button", { name: origin }));
  await waitFor(() => expect(screen.getAllByRole("button", { name: "Details remembered show" })[1]!).toHaveFocus());
  expect(history.location.pathname).toBe(path);
  expect(commands).toEqual([]);
  history.destroy();
});
