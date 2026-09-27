import { setupUiTests, renderWithQueryClient, screen, act } from "@/testing/react";
import { expect, spyOn, test } from "bun:test";
import { createMemoryHistory, createRootRoute, createRoute, createRouter, Outlet, RouterProvider } from "@tanstack/react-router";
import { ShellProviders } from "../shell/test-providers";
import type { ShellValue } from "../shell/AppShell";
import { SettingsPage } from "./SettingsPage";

setupUiTests();

for (const authority of ["host", "administrator", "controller"] as const) test(`${authority} source management follows identity without local host bootstrap`, async () => {
  spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ sources: [] }));
  const shell = { credentials: { origin: "http://localhost", token: "paired" }, connected: true, identity: { authority }, host: null, details: {} } as unknown as ShellValue;
  const base = createRootRoute({ component: () => <ShellProviders value={shell}><Outlet /></ShellProviders> });
  const folders = createRoute({ getParentRoute: () => base, path: "/settings/source-folders", component: () => <SettingsPage section="source-folders" /> });
  const router = createRouter({ routeTree: base.addChildren([folders]), history: createMemoryHistory({ initialEntries: ["/settings/source-folders"] }) });
  await act(async () => { await router.load(); renderWithQueryClient(<RouterProvider router={router} />); });
  expect(!!screen.queryByRole("button", { name: "Add folder" })).toBe(authority !== "controller");
});
