import { setupUiTests, renderWithQueryClient, screen, act, userEvent } from "@/testing/react";
import { expect, spyOn, test } from "bun:test";
import * as core from "@tauri-apps/api/core";
import { applyTvNavigation } from "@/navigation";
import { createMemoryHistory, createRootRoute, createRoute, createRouter, Outlet, RouterProvider } from "@tanstack/react-router";
import { ShellProviders } from "../shell/test-providers";
import { SoundPage } from "./device/SoundPage";
import { GeneralPage } from "./system/GeneralPage";
import { UpdatesPage } from "./system/UpdatesPage";

setupUiTests();

async function open(page: "general" | "sound" | "updates", nativePlayback: boolean, restart = nativePlayback) {
  const value = {
    credentials: { origin: "http://localhost:4100", token: "admin" }, connected: true,
    identity: { authority: "administrator" }, state: { installationName: "Library Mac" },
    details: { name: "Library Mac", capabilities: { browserPlayback: true, nativePlayback, restart } },
    nativeHost: page === "updates", tvPresentation: page === "updates", localHost: false,
  };
  const base = createRootRoute({ component: () => <ShellProviders value={value}><Outlet /></ShellProviders> });
  const route = createRoute({ getParentRoute: () => base, path: "/settings", component: () => page === "general" ? <GeneralPage /> : page === "sound" ? <SoundPage /> : <UpdatesPage /> });
  const router = createRouter({ routeTree: base.addChildren([route]), history: createMemoryHistory({ initialEntries: ["/settings"] }) });
  await act(async () => { await router.load(); renderWithQueryClient(<RouterProvider router={router} />); });
}

test("independent Core hides hardware and restart actions but retains installation updates", async () => {
  await open("general", false);
  expect(screen.queryByRole("link", { name: "Sound" })).not.toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "Bluetooth" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Restart" })).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Updates" })).toBeInTheDocument();
});

test("direct hardware routes explain why independent Core has no controls", async () => {
  await open("sound", false);
  expect(screen.getByText(/Library Mac has no built-in player or sound outputs/)).toBeInTheDocument();
  expect(screen.queryByRole("combobox", { name: "Sound output" })).not.toBeInTheDocument();
});

test("native Core keeps hardware navigation and its restart control", async () => {
  await open("general", true);
  expect(screen.getByRole("link", { name: "Sound" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Bluetooth" })).toBeInTheDocument();
  expect(screen.getByText("Restart Library Mac")).toBeInTheDocument();
});

test("native source builds without an updater do not offer Restart", async () => {
  await open("general", true, false);
  expect(screen.getByRole("link", { name: "Sound" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Restart" })).not.toBeInTheDocument();
});

test("a remote TV can open its own updater with TV navigation", async () => {
  spyOn(core, "invoke").mockImplementation(() => new Promise(() => {}));
  await open("updates", false);
  await userEvent.setup().click(screen.getByRole("button", { name: "Update this TV" }));
  const dialog = screen.getByRole("dialog", { name: "Update Couch on this computer" });
  expect(dialog).not.toHaveAttribute("data-tv-local-only");
  act(() => { applyTvNavigation("down"); });
  expect(dialog).toContainElement(document.activeElement as HTMLElement);
});
