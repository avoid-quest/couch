import { act, render as renderUI, screen, setupUiTests, testWindow, userEvent } from "@/testing/react";
import { expect, spyOn, test } from "bun:test";
import * as core from "@tauri-apps/api/core";
import { NativeModeGate } from "../sections/shell/PlaybackDevice";
import { ShellProviders } from "../sections/shell/test-providers";
import { PlaybackTargetPicker } from "./PlaybackTargetPicker";

setupUiTests();
const state = { targets: [{ id: "receiver", name: "Desktop", connected: true }], targetId: "receiver", currentEntryId: "movie", player: { status: "unavailable" } };

test("native remote playback has no separate enrollment switch", async () => {
  testWindow.happyDOM.setURL("http://tauri.localhost");
  Object.assign(window, { __COUCH_NATIVE_HOST__: true });
  const invoke = spyOn(core, "invoke").mockResolvedValue({ mode: "remote", address: "http://core:4100", targets: [], localSetupComplete: true, nativeReceiver: false } as never);
  await act(async () => { renderUI(<NativeModeGate><ShellProviders value={{ state, connected: true, nativeHost: true }}><PlaybackTargetPicker /></ShellProviders></NativeModeGate>); });
  await userEvent.click(screen.getByRole("button", { name: "Playback output" }));
  expect(screen.queryByRole("menuitem", { name: /playback on this computer/i })).toBeNull();
  expect(invoke.mock.calls.some(([command]) => command === "set_native_receiver")).toBe(false);
});

for (const nativeHost of [false, true]) test(`reconnected selected renderer can resume explicitly (native: ${nativeHost})`, async () => {
  const actions: unknown[] = [];
  renderUI(<ShellProviders value={{ state, connected: true, nativeHost, rendererTargetId: "receiver", run: async (action: unknown) => { actions.push(action); } }}><PlaybackTargetPicker /></ShellProviders>);
  expect(screen.getByText(nativeHost ? "This computer" : "This browser")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Playback output" }));
  await userEvent.click(screen.getByRole("menuitem", { name: "Move playback here" }));
  expect(actions).toEqual([{ type: "selectTarget", targetId: "receiver" }]);
});

for (const connected of [true, false]) test(`group management stays reachable and restores focus (group connected: ${connected})`, async () => {
  const group = { id: "snapcast:downstairs", name: "Downstairs", kind: "group", backend: "snapcast", connected, members: [] };
  renderUI(<ShellProviders value={{ state: { ...state, targets: [group] }, connected: true, run: async () => true }}><PlaybackTargetPicker /></ShellProviders>);
  await userEvent.click(screen.getByRole("button", { name: "Playback output" }));
  await userEvent.click(screen.getByRole("menuitem", { name: "Manage Downstairs" }));
  expect(screen.getByRole("dialog", { name: "Downstairs" })).toBeInTheDocument();
  expect(screen.getByText("Group playback uses estimated progress. Switching outputs waits for buffered audio to finish.")).toBeInTheDocument();
  await userEvent.keyboard("{Escape}");
  expect(screen.getByRole("button", { name: "Playback output" })).toHaveFocus();
});
