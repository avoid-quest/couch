import { renderWithQueryClient, screen, setupUiTests, userEvent, waitFor } from "@/testing/react";
import { expect, spyOn, test } from "bun:test";
import { SavedPlaylists } from "./SavedPlaylists";
import { SavedFavorites } from "../sections/saved/SavedFavorites";
import { ForLaterSection } from "../sections/saved/ForLaterSection";
import { SaveForLater } from "./SaveForLater";

setupUiTests();
const credentials = { origin: "http://localhost", token: "paired", playbackId: "private" };
for (const section of ["lists", "favorites", "later", "save"] as const) test(`${section} retains the selected playback when constructing API credentials`, async () => {
  const request = spyOn(globalThis, "fetch").mockImplementation((async (_input, init) => {
    expect(new Headers(init?.headers).get("X-Couch-Playback")).toBe("private");
    return Response.json({ items: [], favorites: [], playlists: [] });
  }) as typeof fetch);
  renderWithQueryClient(section === "lists" ? <SavedPlaylists {...credentials} connected canPlay queueCount={0} />
    : section === "favorites" ? <SavedFavorites {...credentials} connected canPlay onEnqueueProvider={async () => true} onEnqueueRadio={async () => true} onOpenProvider={() => {}} />
    : section === "later" ? <ForLaterSection {...credentials} connected canPlay />
    : <SaveForLater {...credentials} connected title="Movie" reference={{ kind: "library", id: "movie" }} />);
  if (section === "save") await userEvent.click(screen.getByRole("button", { name: "Save Movie" }));
  await waitFor(() => expect(request).toHaveBeenCalled());
});
