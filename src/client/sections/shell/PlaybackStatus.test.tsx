import { renderWithQueryClient, screen, setupUiTests, testWindow, userEvent } from "@/testing/react";
import { beforeEach, expect, spyOn, test } from "bun:test";
import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { rememberConnection } from "@/session/connection";

setupUiTests();
const origin = "http://living-room:4100";
const token = "living-room-secret";
let request: ReturnType<typeof spyOn>;

let user: ReturnType<typeof userEvent.setup>;

beforeEach(() => {
  user = userEvent.setup();
  testWindow.happyDOM.setURL(`${origin}/find`);
  request = spyOn(globalThis, "fetch").mockImplementation((async input => Response.json(String(input).endsWith("/api/sound") ? { outputs: [], routing: null, defaultOutput: null } : { adapter: "off", devices: [] })) as typeof fetch);
});

async function render() {
  const { PlaybackStatus } = await import("./PlaybackStatus");
  const base = createRootRoute({ component: () => <PlaybackStatus credentials={{ origin, token, installationId: "living-room-installation" }} connected status="Connected" installationName="Living room" /> });
  const find = createRoute({ getParentRoute: () => base, path: "/find", component: () => null });
  const sound = createRoute({ getParentRoute: () => base, path: "/settings/sound", component: () => null });
  const router = createRouter({ routeTree: base.addChildren([find, sound]), history: createMemoryHistory({ initialEntries: ["/find"] }) });
  await router.load();
  renderWithQueryClient(<RouterProvider router={router} />);
  await user.click(await screen.findByRole("button", { name: "Playing on Living room: Connected" }));
}

test("a typed Couch requires explicit switching and uses only its origin", async () => {
  window.localStorage.setItem("couch.remote-token", token);
  await render();
  await user.type(screen.getByRole("textbox", { name: "Another Couch address" }), "http://kitchen:4100");
  await user.click(screen.getByRole("button", { name: "Connect" }));
  expect(window.location.origin).toBe(origin);
  expect(screen.getByText("Switch this browser to kitchen:4100?")).toBeInTheDocument();
  expect(screen.getByText(/Living room keeps playing/)).toBeInTheDocument();
  expect(request.mock.calls.every(([input]: [unknown]) => String(input).startsWith(origin))).toBe(true);
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  expect(window.location.origin).toBe(origin);
  await user.click(screen.getByRole("button", { name: "Connect" }));
  await user.click(screen.getByRole("button", { name: "Switch" }));
  expect(window.location.href).toBe("http://kitchen:4100/");
  expect(request.mock.calls.every(([input]: [unknown]) => String(input).startsWith(origin))).toBe(true);
  expect(window.localStorage.getItem("couch.remote-token")).toBe(token);
});

test("a remembered Couch is offered without reusing this Couch's pairing", async () => {
  rememberConnection("http://kitchen:4100", { name: "Kitchen", urls: ["http://kitchen:4100"], installationId: "kitchen-installation", player: "idle" });
  await render();
  await user.click(screen.getByRole("radio", { name: "Kitchen" }));
  expect(screen.getByText("Switch this browser to kitchen:4100?")).toBeInTheDocument();
  expect(window.location.origin).toBe(origin);
  expect(request.mock.calls.every(([input]: [unknown]) => String(input).startsWith(origin))).toBe(true);
});

test("addresses with pairing details or paths cannot become destinations", async () => {
  await render();
  for (const address of ["http://secret@kitchen:4100", "http://kitchen:4100/#pair=123456", "http://kitchen:4100/api", "javascript:alert(1)"]) {
    const input = screen.getByRole("textbox", { name: "Another Couch address" });
    await user.clear(input);
    await user.type(input, address);
    await user.click(screen.getByRole("button", { name: "Connect" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Enter just the address");
    expect(screen.queryByRole("button", { name: "Switch" })).toBeNull();
  }
  expect(window.location.origin).toBe(origin);
});
