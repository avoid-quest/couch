import { setupUiTests, renderWithQueryClient, screen, userEvent, waitFor } from "@/testing/react";
import { expect, spyOn, test } from "bun:test";
import type { StartupState } from "../../../../shared/startup";
import { StartupSettings } from "./StartupSettings";

setupUiTests();

test("startup reads through Query and applies the state the REST write returns", async () => {
  const calls: Array<{ path: string; method: string }> = [];
  let startup: StartupState = { enabled: false, fullscreenAtLaunch: true, fullscreenNow: true, applies: "next-session" };
  spyOn(globalThis, "fetch").mockImplementation((async (input, init) => {
    const path = new URL(String(input)).pathname, method = init?.method ?? "GET";
    calls.push({ path, method });
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer admin");
    if (path === "/api/settings/startup" && method === "POST") startup = { ...startup, enabled: true };
    return Response.json(startup);
  }) as typeof fetch);
  renderWithQueryClient(<StartupSettings credentials={{ origin: "http://localhost", token: "admin" }} connected />);
  const control = screen.getByRole("switch", { name: "Start on boot" });
  await waitFor(() => expect(control).toBeEnabled());
  expect(screen.getByText("Login screen at boot.")).toBeInTheDocument();
  await userEvent.setup().click(control);
  await screen.findByText("Couch starts automatically.");
  expect(control).toBeChecked();
  expect(calls).toEqual([
    { path: "/api/settings/startup", method: "GET" },
    { path: "/api/settings/startup", method: "POST" },
  ]);
});
