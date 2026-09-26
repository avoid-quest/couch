import { setupUiTests, renderWithQueryClient, screen, userEvent, waitFor } from "@/testing/react";
import { expect, spyOn, test } from "bun:test";
import { StreamingCommunitySettings } from "./StreamingCommunitySettings";

setupUiTests();

test("StreamingCommunity origin loads through Query and saves the normalized origin", async () => {
  const user = userEvent.setup();
  const calls: { path: string; method: string; body: unknown }[] = [];
  spyOn(globalThis, "fetch").mockImplementation((async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ path: new URL(String(input)).pathname, method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : null });
    return Response.json({ origin: init?.method === "POST" ? JSON.parse(String(init.body)).origin : "https://streamingcommunityz.photos" });
  }) as typeof fetch);
  renderWithQueryClient(<StreamingCommunitySettings connected canManage credentials={{ origin: "http://localhost", token: "paired" }} />);
  const input = screen.getByRole("textbox", { name: "Site address" });
  await waitFor(() => expect(input).toHaveValue("https://streamingcommunityz.photos"));
  await user.clear(input);
  await user.type(input, "https://streamingcommunity.example/");
  await user.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(input).toHaveValue("https://streamingcommunity.example"));
  expect(calls).toContainEqual({ path: "/api/settings/streamingcommunity", method: "POST", body: { origin: "https://streamingcommunity.example" } });
});
