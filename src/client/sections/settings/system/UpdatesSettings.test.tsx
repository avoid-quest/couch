import { setupUiTests, renderWithQueryClient, screen, userEvent, waitFor } from "@/testing/react";
import { beforeEach, expect, spyOn, test } from "bun:test";
import type { UpdateState } from "../../../../shared/updates";
import { UpdatesSettings } from "./UpdatesSettings";

setupUiTests();

let request: ReturnType<typeof spyOn>, state: UpdateState;
const mismatch = "The signature was created with a different key than the one provided";

beforeEach(() => {
  state = { running: { version: "0.2.0-preview.13", revision: "a".repeat(40) }, channel: "preview", policy: "manual", status: "failed", currentCheck: true, lastSuccessfulCheck: 1, error: mismatch,
    candidate: { id: "b".repeat(64), releaseId: "0.2.0-preview.15", version: "0.2.0-preview.15", revision: "c".repeat(40), notes: "Long release notes\n".repeat(100), bytes: 123, publishedAt: 1 },
    installation: { enabled: true, transaction: null } };
  request = spyOn(globalThis, "fetch").mockImplementation((async (_input, init) => {
    if (init?.method === "POST") state = { ...state, error: null, status: "available" };
    return Response.json(state);
  }) as typeof fetch);
});

async function render(target: "this app" | "selected host" = "this app") {
  renderWithQueryClient(<UpdatesSettings credentials={{ origin: "http://localhost", token: "admin" }} connected target={target} hostName="Living room" />);
  await screen.findByText("New version");
}

test("a signing-key mismatch explains recovery and stops a futile download retry", async () => {
  await render();
  expect(screen.getByRole("alert")).toHaveTextContent("Reinstall Couch from the official installer. Your data stays.");
  expect(screen.getByRole("button", { name: "Download" })).toBeDisabled();
  expect(screen.queryByRole("button", { name: "Install" })).not.toBeInTheDocument();
  await userEvent.setup().click(screen.getByRole("button", { name: "Check for updates" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Download" })).toBeEnabled());
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(request.mock.calls.some(([input, init]: Parameters<typeof fetch>) => String(input).endsWith("/api/updates/check") && init?.method === "POST")).toBe(true);
});

test("remote signing-key recovery names the installation that needs reinstalling", async () => {
  await render("selected host");
  expect(screen.getByRole("alert")).toHaveTextContent("Reinstall Couch on Living room from the official installer. Your data stays.");
});

test("other download failures stay visible and allow retry", async () => {
  state.error = "The download was interrupted. Try again.";
  await render();
  expect(screen.getByRole("alert")).toHaveTextContent(state.error!);
  await userEvent.setup().click(screen.getByRole("button", { name: "Download" }));
  await waitFor(() => expect(request.mock.calls.some(([input, init]: Parameters<typeof fetch>) => String(input).endsWith("/api/updates/stage") && JSON.parse(String(init?.body)).candidateId === state.candidate!.id)).toBe(true));
});

test("a verified download still enables installation", async () => {
  state.status = "ready"; state.error = null;
  await render();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Download" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Install" })).toBeEnabled();
});
