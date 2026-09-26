import { setupUiTests, act, createTestQueryClient, renderWithQueryClient, screen, userEvent, waitFor } from "@/testing/react";
import { beforeEach, expect, spyOn, test } from "bun:test";
import { useState } from "react";
import type { DisplayState } from "../../../../shared/display";
import { DisplaySettings } from "./DisplaySettings";

setupUiTests();

let queryClient: ReturnType<typeof createTestQueryClient>;
let resolvePreview: ((state: DisplayState) => void) | undefined;
let previewFails = false;
let setConnected: (connected: boolean) => void;
const state: DisplayState = { outputs: [{ id: "tv", name: "Living room TV", connected: true, width: 1920, height: 1080, x: 0, y: 0, refresh: 60 }], saved: "tv", current: "tv", notice: null, preview: null };
const poll: DisplayState = { ...state, notice: "Display inventory refreshed." };

beforeEach(async () => {
  resolvePreview = undefined;
  previewFails = false;
  spyOn(globalThis, "fetch").mockImplementation((async (input, init) => {
    const path = new URL(String(input)).pathname;
    if (path === "/api/display" && !init?.method) return Response.json(state);
    if (path === "/api/display/preview") return previewFails ? Response.json({ error: "Display unavailable" }, { status: 503 }) : await new Promise<Response>(resolve => { resolvePreview = next => resolve(Response.json(next)); });
    return Response.json({ error: "Unexpected request" }, { status: 500 });
  }) as typeof fetch);
  function Harness() {
    const [connected, updateConnected] = useState(true);
    setConnected = updateConnected;
    return <DisplaySettings credentials={{ origin: "http://localhost", token: "admin" }} connected={connected} />;
  }
  queryClient = createTestQueryClient();
  renderWithQueryClient(<Harness />, queryClient);
  await screen.findByRole("button", { name: "Try Living room TV" });
});

test("a completed display poll cannot enable a second preview while the first is pending", async () => {
  await userEvent.setup().click(screen.getByRole("button", { name: "Try Living room TV" }));
  await waitFor(() => expect(resolvePreview).toBeDefined());
  expect(screen.getByRole("button", { name: "Try Living room TV" })).toBeDisabled();
  await act(async () => { queryClient.setQueryData(["display"], poll); });
  expect(screen.getByRole("button", { name: "Try Living room TV" })).toBeDisabled();
  await act(async () => { resolvePreview!({ ...state, preview: { token: "preview", expiresAt: Date.now() + 20_000 } }); });
  await screen.findByRole("button", { name: "Keep" });
  expect(screen.getByRole("button", { name: "Try Living room TV" })).toBeDisabled();
});

test("a display poll does not dismiss a mutation error", async () => {
  const user = userEvent.setup();
  previewFails = true;
  await user.click(screen.getByRole("button", { name: "Try Living room TV" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Display unavailable");
  await act(async () => { queryClient.setQueryData(["display"], poll); });
  expect(screen.getByRole("alert")).toHaveTextContent("Display unavailable");
  previewFails = false;
  await user.click(screen.getByRole("button", { name: "Try Living room TV" }));
  await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
});

test("a disconnect hides cached display state", async () => {
  await act(async () => { setConnected(false); });
  expect(screen.queryByRole("button", { name: "Try Living room TV" })).not.toBeInTheDocument();
});
