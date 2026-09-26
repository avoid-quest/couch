import { setupUiTests, act, render } from "@/testing/react";
import { expect, spyOn, test } from "bun:test";
import * as core from "@tauri-apps/api/core";
import * as events from "@tauri-apps/api/event";
import { ShellProviders } from "../sections/shell/test-providers";
import type { SessionState } from "../../shared/protocol";
import { nativeMedia, nativeMediaAction, useNativeMediaSession, type NativeMedia, type NativeMediaCommand } from "./native-media";

setupUiTests();
const credentials = { origin: "http://localhost:4100", token: "local-owner" };
const state: SessionState = {
  queue: [{ id: "track", title: "Evening music", source: "library:track", subtitle: "The artist", artworkId: "cover" }, { id: "next", title: "Next", source: "library:next" }],
  currentEntryId: "track", activeProfile: { id: "household", name: "Household" },
  player: { playbackId: "playback", status: "playing", position: 12, duration: 100, volume: 40, seekable: true, error: null, speed: 1.5 },
};

test("system metadata uses the current session clock and playback capabilities", () => {
  const media = nativeMedia(state, true, state.player, credentials, "session");
  expect(media).toMatchObject({ title: "Evening music", artist: "The artist", playing: true, position: 12, duration: 100, rate: 1.5, canPause: true, canSeek: true, canNext: true });
  expect(media?.artwork).toEqual({ url: "http://localhost:4100/api/library/artwork/cover", token: "local-owner" });
  const paused = { ...state, player: { ...state.player, status: "paused" as const } };
  expect(nativeMedia(paused, true, paused.player, credentials, "session")).toMatchObject({ playing: false, rate: 0 });
  expect(nativeMedia(state, true, { playbackId: "old", position: 99, duration: 200 }, credentials, "session")).toMatchObject({ position: 0, duration: null });
});

test("stopped, failed, unpaired, and disconnected playback clears system metadata", () => {
  expect(nativeMedia(state, false, state.player, credentials, "session")).toBeNull();
  expect(nativeMedia(state, true, state.player, null, "session")).toBeNull();
  for (const status of ["idle", "ended", "error", "unavailable"] as const) {
    expect(nativeMedia({ ...state, player: { ...state.player, status } }, true, state.player, credentials, "session")).toBeNull();
  }
});

test("live metadata follows the current programme without enabling unsupported controls", () => {
  const radio: SessionState = { ...state, queue: [{ ...state.queue[0]!, kind: "radio", thumbnail: "https://radio.example/cover.jpg" }], player: { ...state.player, seekable: false }, radioProgramme: { playbackId: "playback", stationId: "station", provider: "radio.avoid.quest", title: "The show", artist: "The presenter", artworkUrl: "https://radio.example/show.jpg", sampledAt: 1, expiresAt: 2 } };
  expect(nativeMedia(radio, true, radio.player, credentials, "session")).toMatchObject({ title: "The show", artist: "The presenter", live: true, duration: null, canPause: false, canSeek: false, canNext: false, artwork: { url: "https://radio.example/show.jpg" } });
  const stale = { ...radio, radioProgramme: { ...radio.radioProgramme!, playbackId: "old" } };
  expect(nativeMedia(stale, true, stale.player, credentials, "session")?.title).toBe("Evening music");
});

test("system controls use playback IDs, clamp seeks, and reject stale session events", () => {
  const media = nativeMedia(state, true, state.player, credentials, "session")!;
  const command = (command: NativeMediaCommand["command"], position = 0) => nativeMediaAction({ id: media.id, command, position }, media, "playback");
  expect(command("toggle")).toEqual({ type: "pause", playbackId: "playback", paused: true });
  expect(command("play")).toEqual({ type: "pause", playbackId: "playback", paused: false });
  expect(command("next")).toEqual({ type: "next", playbackId: "playback" });
  expect(command("stop")).toEqual({ type: "stop", playbackId: "playback" });
  expect(command("seek", 500)).toEqual({ type: "seek", playbackId: "playback", position: 100 });
  expect(command("seek", -10)).toEqual({ type: "seek", playbackId: "playback", position: 0 });
  expect(command("seek", NaN)).toBeNull();
  expect(nativeMediaAction({ id: "old:playback", command: "stop", position: 0 }, media, "playback")).toBeNull();
  expect(nativeMediaAction({ id: media.id, command: "pause", position: 0 }, { ...media, canPause: false }, "playback")).toBeNull();
});

test("the bridge follows remote selection, disconnects, and unregisters on unmount", async () => {
  const publications: Array<NativeMedia | null> = [], actions: unknown[] = [];
  let handler: (event: { payload: NativeMediaCommand }) => void = () => {};
  let removed = false;
  spyOn(core, "invoke").mockImplementation(async <T,>(command: string, args?: core.InvokeArgs) => {
    expect(command).toBe("set_now_playing");
    publications.push((args as { media: NativeMedia | null }).media);
    return undefined as T;
  });
  spyOn(events, "listen").mockImplementation(async (_name, listener) => {
    handler = listener as typeof handler;
    return () => { removed = true; };
  });
  function Probe() { useNativeMediaSession(); return null; }
  const local = { nativeHost: true, state, connected: true, credentials, run: async (action: unknown) => { actions.push(["local", action]); return true; } };
  let view!: ReturnType<typeof render>;
  await act(async () => { view = render(<ShellProviders value={local}><Probe /></ShellProviders>); });
  const first = publications.at(-1)!;
  const remote = { ...local, credentials: { origin: "http://192.168.1.20:4100", token: "remote-token" }, run: async (action: unknown) => { actions.push(["remote", action]); return true; } };
  await act(async () => view.rerender(<ShellProviders value={remote}><Probe /></ShellProviders>));
  const latest = publications.at(-1)!;
  expect(latest.id).not.toBe(first.id);
  expect(latest.artwork).toEqual({ url: "http://192.168.1.20:4100/api/library/artwork/cover", token: "remote-token" });
  await act(async () => {
    handler({ payload: { id: first.id, command: "stop", position: 0 } });
    handler({ payload: { id: latest.id, command: "pause", position: 0 } });
  });
  expect(actions).toEqual([["remote", { type: "pause", playbackId: "playback", paused: true }]]);
  await act(async () => view.rerender(<ShellProviders value={{ ...remote, connected: false }}><Probe /></ShellProviders>));
  expect(publications.at(-1)).toBeNull();
  await act(async () => handler({ payload: { id: latest.id, command: "stop", position: 0 } }));
  expect(actions).toHaveLength(1);
  await act(async () => view.unmount());
  expect(removed).toBe(true);
  expect(publications.at(-1)).toBeNull();
});
