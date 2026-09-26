import { setupUiTests, renderWithQueryClient, screen, userEvent, waitFor } from "@/testing/react";
import { beforeEach, expect, spyOn, test } from "bun:test";
import { AppearanceSettings } from "./AppearanceSettings";

setupUiTests();

let request: ReturnType<typeof spyOn>;

beforeEach(() => {
  request = spyOn(globalThis, "fetch").mockImplementation((async () => Response.json({})) as unknown as typeof fetch);
});

test("desktop size changes this client without touching the selected host's TV size", async () => {
  const user = userEvent.setup();
  renderWithQueryClient(<AppearanceSettings scope="device" tvPresentation={false} credentials={{ origin: "http://localhost", token: "admin" }} connected administrator />);
  expect(screen.queryByRole("group", { name: "TV interface size" })).not.toBeInTheDocument();
  await user.click(screen.getByRole("radio", { name: "Default" }));
  await user.click(screen.getByRole("radio", { name: "Larger" }));
  expect(screen.getByRole("radio", { name: "Larger" })).toBeChecked();
  expect(localStorage.getItem("couch.remote-interface-size")).toBe("1.15");
  expect(request).not.toHaveBeenCalled();
});

test("TV presentation keeps its preview request separate from client storage", async () => {
  const user = userEvent.setup();
  renderWithQueryClient(<AppearanceSettings scope="device" tvPresentation credentials={{ origin: "http://localhost", token: "admin" }} connected administrator />);
  expect(screen.queryByRole("group", { name: "Size on this device" })).not.toBeInTheDocument();
  await user.click(screen.getByRole("radio", { name: "Larger" }));
  await waitFor(() => expect(request).toHaveBeenCalledWith("http://localhost/api/appearance", expect.anything()));
  expect(localStorage.getItem("couch.remote-interface-size")).toBeNull();
});
