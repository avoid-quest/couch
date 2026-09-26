import { setupUiTests, act, render } from "@/testing/react";
import { expect, spyOn, test } from "bun:test";
import * as core from "@tauri-apps/api/core";
import type { ClientSessionState } from "@/session/session";
import { nativeWindowTitle, useNativeWindowTitle } from "./native-window-title";

setupUiTests();

const state: ClientSessionState = {
  installationName: "Living room", queue: [{ id: "song", title: "Song", source: "library:song" }], currentEntryId: "song",
  activeProfile: { id: "household", name: "Household" },
  player: { playbackId: "playing", status: "playing", volume: 50, seekable: true, error: null },
};

test("window titles identify the selected Couch and its current item", () => {
  expect(nativeWindowTitle(state, true)).toBe("Couch · Living room · Song");
  expect(nativeWindowTitle({ ...state, player: { ...state.player, status: "paused" } }, true)).toBe("Couch · Living room · Song");
  expect(nativeWindowTitle({ ...state, installationName: "Kitchen" }, true)).toBe("Couch · Kitchen · Song");
  expect(nativeWindowTitle(null, false, "Bedroom")).toBe("Couch · Bedroom");
  expect(nativeWindowTitle(null, false)).toBe("Couch");
});

test("window titles clear stale media and follow current radio metadata", () => {
  expect(nativeWindowTitle(state, false)).toBe("Couch · Living room");
  for (const status of ["idle", "ended", "error", "unavailable"] as const) {
    expect(nativeWindowTitle({ ...state, player: { ...state.player, status } }, true)).toBe("Couch · Living room");
  }
  const radio = { ...state, radioProgramme: { playbackId: "playing", stationId: "station", provider: "radio.avoid.quest" as const, title: "Evening show", sampledAt: 1, expiresAt: 2 } };
  expect(nativeWindowTitle(radio, true)).toBe("Couch · Living room · Evening show");
  expect(nativeWindowTitle({ ...radio, radioProgramme: { ...radio.radioProgramme, playbackId: "old" } }, true)).toBe("Couch · Living room · Song");
});

test("native title updates follow session changes and are absent on the web", async () => {
  const invoke = spyOn(core, "invoke").mockResolvedValue(undefined);
  function Probe({ native, session, connected = true }: { native: boolean; session: ClientSessionState | null; connected?: boolean }) {
    useNativeWindowTitle(native, session, connected);
    return null;
  }
  let view!: ReturnType<typeof render>;
  await act(async () => { view = render(<Probe native={false} session={state} />); });
  expect(invoke).not.toHaveBeenCalled();
  await act(async () => view.rerender(<Probe native session={state} />));
  expect(invoke).toHaveBeenLastCalledWith("set_native_window_title", { title: "Couch · Living room · Song" });
  await act(async () => view.rerender(<Probe native session={{ ...state, installationName: "Kitchen" }} />));
  expect(invoke).toHaveBeenLastCalledWith("set_native_window_title", { title: "Couch · Kitchen · Song" });
  await act(async () => view.rerender(<Probe native session={state} connected={false} />));
  expect(invoke).toHaveBeenLastCalledWith("set_native_window_title", { title: "Couch · Living room" });
});
