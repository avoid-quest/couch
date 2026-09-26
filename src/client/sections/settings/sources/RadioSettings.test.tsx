import { setupUiTests, renderWithQueryClient, screen, userEvent, waitFor } from "@/testing/react";
import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { createRadio } from "../../../../server/radio";
import { createRadioSettings } from "../../../../server/radio-settings";
import { RadioSettings } from "./RadioSettings";

setupUiTests();

let radio: ReturnType<typeof createRadio>;
beforeEach(() => {
  radio = createRadio({ databasePath: ":memory:", fetch: (async () => new Response("#EXTM3U\n#EXTINF:-1,Fixture station\nhttps://stream.example/radio\n")) as unknown as typeof fetch });
  const handler = createRadioSettings(radio);
  spyOn(globalThis, "fetch").mockImplementation(((input: RequestInfo | URL, init?: RequestInit) => handler.handle(new Request(input, init), () => ({ authority: "administrator", controller: null, claimAvailable: false }))) as typeof fetch);
});
afterEach(() => radio.close());

test("radio Sources imports through the server's JSON contract and clears the saved form", async () => {
  const user = userEvent.setup();
  renderWithQueryClient(<RadioSettings connected canManage credentials={{ origin: "http://localhost", token: "paired" }} />);
  await user.type(screen.getByRole("textbox", { name: "Name" }), "Fixture playlist");
  await user.type(screen.getByRole("textbox", { name: "M3U URL" }), "https://feed.example/radio.m3u");
  await user.click(screen.getByRole("button", { name: "Add" }));
  await waitFor(() => expect(screen.getByRole("textbox", { name: "Name" })).toHaveValue(""));
  expect(radio.playlists()).toMatchObject([{ name: "Fixture playlist", stationCount: 1 }]);
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});
