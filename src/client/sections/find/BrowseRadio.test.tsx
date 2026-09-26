import { setupUiTests, renderWithQueryClient, createTestQueryClient, screen, act } from "@/testing/react";
import { expect, spyOn, test } from "bun:test";
import { BrowseRadio } from "./BrowseRadio";
import { radioProgrammesQuery } from "@/api/radio";

setupUiTests();

test("radio discovery updates show details and artwork without interacting", async () => {
  const credentials = { origin: "http://localhost", token: "paired" };
  const client = createTestQueryClient();
  let title = "Evening show";
  spyOn(globalThis, "fetch").mockImplementation((async input => {
    const path = new URL(String(input)).pathname;
    if (path.endsWith("/programmes")) return Response.json({ programmes: { nts: { title, description: "Broken beat and soul.", genre: "Detroit House", artworkUrl: `https://images.example/${encodeURIComponent(title)}.jpg`, sampledAt: Date.now(), expiresAt: Date.now() + 60_000 } } });
    if (path.endsWith("/favorites")) return Response.json({ favorites: [] });
    return Response.json({ stations: [{ id: "nts", name: "NTS Radio", sourceId: "avoid", groupTitle: "avoid radio", url: "https://stream.example/live" }] });
  }) as typeof fetch);
  const view = renderWithQueryClient(<BrowseRadio {...credentials} connected canPlay active onBack={() => {}} />, client);
  expect(await screen.findByText("Evening show · Detroit House")).toBeVisible();
  expect(screen.getByText("Broken beat and soul.")).toBeVisible();
  title = "Next show";
  await act(async () => { await client.invalidateQueries({ queryKey: radioProgrammesQuery(credentials).queryKey }); });
  expect(await screen.findByText("Next show · Detroit House")).toBeVisible();
  expect(screen.queryByText("Evening show · Detroit House")).toBeNull();
  expect(view.container.querySelector("img")).toHaveAttribute("src", "https://images.example/Next%20show.jpg");
});
