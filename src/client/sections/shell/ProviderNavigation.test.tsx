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
  return <button aria-label="Details remembered show" onClick={() => shell.openProvider({ id: "show", title: "Remembered show", url: "https://streamingcommunityz.photos/it/titles/123-show", provider: "streamingcommunity", kind: "collection" }, "Details remembered show")}>Browse episodes</button>;
}

test("provider browsing returns to its Home origin and restores focus without playing", async () => {
  const commands: unknown[] = [];
  spyOn(globalThis, "fetch").mockImplementation((async () => Response.json({ items: [], favorites: [], title: "Remembered show" })) as typeof fetch);
  const gate = {
    credentials: { origin: "http://localhost", token: "host" }, connected: true, status: "connected", booting: false,
    state: { queue: [], currentEntryId: null, player: { status: "idle", position: 0, duration: null, volume: 50, playbackId: null }, activeProfile: { id: "household", name: "Household" } },
    identity: { authority: "host" }, details: {}, nativeHost: false, localHost: true, videoQualityPreference: { quality: "auto" },
    run: async (action: unknown) => { commands.push(action); return true; }, setError: () => {},
  };
  const base = createRootRoute({ component: () => <NativeModeGate><ShellProviders value={gate}><AppShell /></ShellProviders></NativeModeGate> });
  const home = createRoute({ getParentRoute: () => base, path: "/", component: HomeOpener });
  const find = createRoute({ getParentRoute: () => base, path: "/find", component: FindPage });
  const history = createMemoryHistory({ initialEntries: ["/"] });
  const router = createRouter({ routeTree: base.addChildren([home, find]), history });
  const view = render(<></>);
  await act(async () => { await router.load(); view.rerender(<RouterProvider router={router} />); });
  await userEvent.click(screen.getByRole("button", { name: "Details remembered show" }));
  expect(history.location.pathname).toBe("/find");
  await userEvent.click(await screen.findByRole("button", { name: "Home" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Details remembered show" })).toHaveFocus());
  expect(history.location.pathname).toBe("/");
  expect(commands).toEqual([]);
  history.destroy();
});
