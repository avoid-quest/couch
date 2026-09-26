import { setupUiTests, testWindow, renderWithQueryClient, screen, userEvent, waitFor } from "@/testing/react";
import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import * as core from "@tauri-apps/api/core";
import { toast } from "sonner";
import type { Diagnostics } from "../../../../shared/diagnostics";
import { AdvancedSettings } from "./AdvancedSettings";

setupUiTests();

const lastToast = () => { const item = toast.getToasts().at(-1); return item && "title" in item ? item.title : undefined; };
const report: Diagnostics = {
  formatVersion: 2, sessionId: "session", sessionStartedAt: "2026-09-23T10:00:00Z", historyError: null,
  collectedAt: "2026-09-23T10:00:00Z", collectionMs: 1,
  build: { version: "test", revision: "revision", target: "mac", packaged: false },
  system: [], native: null, nativeError: null, helpers: [], configuration: [], sources: [], recent: [],
  limits: { recentEntries: 80, retentionDays: 7, historyBytes: 65536, messageCharacters: 500, exportBytes: 131072, snapshotSeconds: 5, helperSeconds: 300 },
};
const bytes = new TextEncoder().encode(JSON.stringify(report));
let request: ReturnType<typeof spyOn>, invoke: ReturnType<typeof spyOn>;
let saveResult: boolean | string, denied: boolean, interrupted: boolean;

beforeEach(() => {
  testWindow.happyDOM.setURL("http://tauri.localhost");
  Object.assign(window, { __COUCH_NATIVE_HOST__: true });
  saveResult = true; denied = false; interrupted = false;
  invoke = spyOn(core, "invoke").mockImplementation(async <T,>(): Promise<T> => {
    if (typeof saveResult === "string") throw saveResult;
    return saveResult as T;
  });
  request = spyOn(globalThis, "fetch").mockImplementation((async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.pathname === "/api/diagnostics/export") {
      expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer selected-token");
      if (denied) return Response.json({ error: "You're no longer an admin." }, { status: 403 });
      if (interrupted) return new Response(new ReadableStream({ start(controller) { controller.error(new Error("Transfer interrupted")); } }));
      return new Response(bytes, { headers: { "Content-Type": "application/json" } });
    }
    if (url.pathname === "/api/diagnostics") return Response.json(report);
    return Response.json({ error: "Unavailable" }, { status: 503 });
  }) as typeof fetch);
});

afterEach(() => { toast.dismiss(); });

async function render(origin = "http://local-installation") {
  renderWithQueryClient(<AdvancedSettings credentials={{ origin, token: "selected-token" }} connected />);
  await waitFor(() => expect(screen.getByRole("button", { name: "Export" })).toBeEnabled());
}

async function save() {
  await userEvent.setup().click(screen.getByRole("button", { name: "Export" }));
}

test("local owner saves the selected installation's sanitized JSON", async () => {
  await render(); await save();
  await waitFor(() => expect(lastToast()).toBe("Exported."));
  expect((request.mock.calls as Array<[RequestInfo | URL]>).some(call => String(call[0]) === "http://local-installation/api/diagnostics/export")).toBe(true);
  expect(invoke).toHaveBeenCalledWith("save_diagnostics_export", bytes);
});

test("bundled remote Administrator saves the selected remote installation", async () => {
  await render("http://selected-remote:4100"); await save();
  await waitFor(() => expect(invoke).toHaveBeenCalledWith("save_diagnostics_export", bytes));
  expect((request.mock.calls as Array<[RequestInfo | URL]>).some(call => String(call[0]) === "http://selected-remote:4100/api/diagnostics/export")).toBe(true);
});

test("cancel and denied destination give distinct feedback", async () => {
  saveResult = false;
  await render(); await save();
  await waitFor(() => expect(lastToast()).toBe("Canceled."));
  saveResult = "Couldn't save the diagnostics report: Permission denied. No complete file was saved.";
  await save();
  expect(await screen.findByText(/Permission denied/)).toBeInTheDocument();
});

test("revoked Administrator access and interrupted transfers never open the save dialog", async () => {
  denied = true;
  await render(); await save();
  await screen.findByText(/You're no longer an admin/);
  expect(invoke).not.toHaveBeenCalled();
  denied = false; interrupted = true;
  await save();
  await screen.findByText("Export interrupted. Nothing saved.");
  expect(invoke).not.toHaveBeenCalled();
});

test("browser retains a JSON download", async () => {
  Object.assign(window, { __COUCH_NATIVE_HOST__: undefined });
  const create = spyOn(URL, "createObjectURL").mockReturnValue("blob:diagnostics");
  const click = spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  await render(); await save();
  await waitFor(() => expect(lastToast()).toBe("Downloaded."));
  expect(create).toHaveBeenCalledTimes(1);
  expect(click).toHaveBeenCalledTimes(1);
  expect(invoke).not.toHaveBeenCalled();
});
