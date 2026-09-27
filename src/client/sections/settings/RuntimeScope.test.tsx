import { setupUiTests, renderWithQueryClient, screen, act } from "@/testing/react";
import { expect, test } from "bun:test";
import { createMemoryHistory, createRootRoute, createRoute, createRouter, Outlet, RouterProvider } from "@tanstack/react-router";
import { ShellProviders } from "../shell/test-providers";
import { SoundPage } from "./device/SoundPage";
import { GeneralPage } from "./system/GeneralPage";

setupUiTests();

async function open(page: "general" | "sound", nativePlayback: boolean) {
  const value = {
    credentials: { origin: "http://localhost:4100", token: "admin" }, connected: true,
    identity: { authority: "administrator" }, state: { installationName: "Library Mac" },
    details: { name: "Library Mac", capabilities: { browserPlayback: true, nativePlayback } },
  };
  const base = createRootRoute({ component: () => <ShellProviders value={value}><Outlet /></ShellProviders> });
  const route = createRoute({ getParentRoute: () => base, path: "/settings", component: () => page === "general" ? <GeneralPage /> : <SoundPage /> });
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
