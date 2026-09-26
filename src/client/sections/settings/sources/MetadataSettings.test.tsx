import { setupUiTests, renderWithQueryClient, screen, userEvent, waitFor, within } from "@/testing/react";
import { beforeEach, expect, spyOn, test } from "bun:test";
import { MetadataSettings } from "./MetadataSettings";

setupUiTests();

const calls: { path: string; method: string; body: unknown }[] = [];
let configured: boolean;
beforeEach(() => {
  calls.length = 0;
  configured = false;
  spyOn(globalThis, "fetch").mockImplementation((async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ path: new URL(String(input)).pathname, method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : null });
    if (init?.method === "POST") configured = !!JSON.parse(String(init.body)).token;
    return Response.json({ configured });
  }) as typeof fetch);
});

function render() {
  renderWithQueryClient(<MetadataSettings connected canManage credentials={{ origin: "http://localhost", token: "paired" }} />);
}

test("saving a metadata token updates its status and clears the saved form", async () => {
  const user = userEvent.setup();
  render();
  await screen.findByText("No token");
  await user.type(screen.getByLabelText("TMDB token"), "tmdb-token");
  await user.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Token saved"));
  await waitFor(() => expect(screen.getByLabelText("TMDB token")).toHaveValue(""));
  expect(calls).toContainEqual({ path: "/api/metadata/provider", method: "POST", body: { token: "tmdb-token" } });
});

test("clearing the TMDB token asks for confirmation", async () => {
  const user = userEvent.setup();
  configured = true;
  render();
  await user.click(await screen.findByRole("button", { name: "Clear" }));
  expect(calls.filter(call => call.method === "POST")).toHaveLength(0);
  const dialog = screen.getByRole("alertdialog", { name: "Clear the token?" });
  await user.click(within(dialog).getByRole("button", { name: "Clear" }));
  await screen.findByText("No token");
  expect(calls).toContainEqual({ path: "/api/metadata/provider", method: "POST", body: { token: "" } });
});
