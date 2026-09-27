import { act, render as renderUI, screen, setupUiTests, testWindow, userEvent } from "@/testing/react";
import { expect, spyOn, test } from "bun:test";
import * as core from "@tauri-apps/api/core";
import { NativeModeGate } from "../sections/shell/PlaybackDevice";
import { ShellProviders } from "../sections/shell/test-providers";
import { PlaybackTargetPicker } from "./PlaybackTargetPicker";

setupUiTests();
const state = { targets: [{ id: "receiver", name: "Desktop", connected: true }], targetId: "receiver", currentEntryId: "movie", player: { status: "unavailable" } };

test("native remote playback is explicitly enabled and disabled independently of Core selection", async () => {
  testWindow.happyDOM.setURL("http://tauri.localhost");
  Object.assign(window, { __COUCH_NATIVE_HOST__: true });
  let choice = { mode: "remote", address: "http://core:4100", targets: [], localSetupComplete: true, nativeReceiver: false };
  const invoke = spyOn(core, "invoke").mockImplementation(async (command, args) => {
    if (command === "set_native_receiver") choice = { ...choice, nativeReceiver: (args as { enabled: boolean }).enabled };
    return choice as never;
  });
  await act(async () => { renderUI(<NativeModeGate><ShellProviders value={{ state, connected: true, nativeHost: true }}><PlaybackTargetPicker /></ShellProviders></NativeModeGate>); });
  expect(invoke.mock.calls.some(([command]) => command === "set_native_receiver")).toBe(false);
  await userEvent.click(screen.getByRole("button", { name: "Playback output" }));
  await userEvent.click(screen.getByRole("menuitem", { name: "Enable playback on this computer" }));
  expect(invoke).toHaveBeenCalledWith("set_native_receiver", { enabled: true });
  await userEvent.click(screen.getByRole("button", { name: "Playback output" }));
  await userEvent.click(screen.getByRole("menuitem", { name: "Disable playback on this computer" }));
  expect(invoke).toHaveBeenCalledWith("set_native_receiver", { enabled: false });
  expect(invoke.mock.calls.some(([command]) => command === "select_playback_device")).toBe(false);
});

for (const nativeHost of [false, true]) test(`reconnected selected renderer can resume explicitly (native: ${nativeHost})`, async () => {
  const actions: unknown[] = [];
  renderUI(<ShellProviders value={{ state, connected: true, nativeHost, rendererTargetId: "receiver", run: async (action: unknown) => { actions.push(action); } }}><PlaybackTargetPicker /></ShellProviders>);
  expect(screen.getByText(nativeHost ? "This computer" : "This browser")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Playback output" }));
  await userEvent.click(screen.getByRole("menuitem", { name: "Move playback here" }));
  expect(actions).toEqual([{ type: "selectTarget", targetId: "receiver" }]);
});
