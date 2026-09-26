import { setupUiTests, render, act, screen, userEvent } from "@/testing/react";
import { expect, test } from "bun:test";
import { useState } from "react";
import { ShellProviders } from "./test-providers";
import { KeyboardShortcuts } from "./KeyboardShortcuts";
import type { SessionState } from "../../../shared/protocol";

setupUiTests();
const state: SessionState = {
  queue: [{ id: "current", title: "Movie", source: "library:movie" }, { id: "next", title: "Next", source: "library:next" }],
  currentEntryId: "current", activeProfile: { id: "household", name: "Household" },
  player: { playbackId: "playback", status: "playing", position: 12, duration: 100, volume: 98, seekable: true, error: null },
};
function Help() {
  const [open, setOpen] = useState(false);
  return <KeyboardShortcuts open={open} onOpenChange={setOpen} />;
}
function fixture(overrides = {}) {
  const actions: unknown[] = [], seeks: number[] = [], pages: string[] = [];
  const value = { state, section: "Now", connected: true, run: async (action: unknown) => { actions.push(action); return true; }, seekBy: (delta: number) => seeks.push(delta), focusSearch: () => pages.push("Find"), changeSection: (page: string) => pages.push(page), openPlayer: (panel?: string) => pages.push(panel ?? "player"), ...overrides };
  const view = render(<ShellProviders value={value}><Help /></ShellProviders>);
  return { actions, seeks, pages, value, view };
}
async function key(key: string, options: KeyboardEventInit = {}, target: EventTarget = document.body) {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...options });
  await act(async () => { target.dispatchEvent(event); target.dispatchEvent(new KeyboardEvent("keyup", { key, bubbles: true, ...options })); });
  return event;
}

test("YouTube keys dispatch capability-aware transport actions", async () => {
  const { actions, seeks } = fixture();
  await key("k"); await key(" "); await key("j"); await key("l"); await key("ArrowLeft"); await key("ArrowRight"); await key("5"); await key("ArrowUp"); await key("N", { shiftKey: true });
  expect(seeks).toEqual([-10, 10, -5, 5]);
  expect(actions).toEqual([
    { type: "pause", playbackId: "playback", paused: true }, { type: "pause", playbackId: "playback", paused: true },
    { type: "seek", playbackId: "playback", position: 50 }, { type: "volume", volume: 100 }, { type: "next", playbackId: "playback" },
  ]);
});

test("shortcuts preserve typing, focused controls, composition, repeats and browser chords", async () => {
  const { actions, seeks, pages } = fixture();
  const input = document.createElement("input"), button = document.createElement("button"), editor = document.createElement("div");
  editor.contentEditable = "true";
  document.body.append(input, button, editor);
  try {
    expect((await key("k", {}, input)).defaultPrevented).toBe(false);
    expect((await key("s", {}, editor)).defaultPrevented).toBe(false);
    expect((await key(" ", {}, button)).defaultPrevented).toBe(false);
    expect((await key("ArrowRight", {}, button)).defaultPrevented).toBe(false);
    await key("k", { isComposing: true }); await key("k", { repeat: true }); await key("k", { metaKey: true });
    expect(actions).toEqual([]); expect(seeks).toEqual([]); expect(pages).toEqual([]);
  } finally { input.remove(); button.remove(); editor.remove(); }
});

test("open portals suspend background shortcuts, including when focus is elsewhere", async () => {
  const { actions, pages } = fixture();
  for (const role of ["dialog", "alertdialog", "menu", "listbox"]) {
    const overlay = document.createElement("div"); overlay.setAttribute("role", role); document.body.append(overlay);
    await key("k"); await key("h"); overlay.remove();
  }
  expect(actions).toEqual([]); expect(pages).toEqual([]);
});

test("disconnected, loading and live playback leave unsupported controls inactive", async () => {
  const f = fixture({ connected: false });
  await key("k"); await key("l"); await key("4"); await key("ArrowUp");
  expect(f.actions).toEqual([]); expect(f.seeks).toEqual([]);
  await act(async () => f.view.rerender(<ShellProviders value={{ ...f.value, connected: true, state: { ...state, queue: [{ ...state.queue[0], kind: "radio" }], player: { ...state.player, seekable: false } } }}><Help /></ShellProviders>));
  await key("k"); await key("l"); await key("4");
  expect(f.actions).toEqual([]); expect(f.seeks).toEqual([]);
});

test("callbacks use the latest playback and connection after rerender", async () => {
  const f = fixture();
  const latest: unknown[] = [];
  await act(async () => f.view.rerender(<ShellProviders value={{ ...f.value, state: { ...state, player: { ...state.player, playbackId: "new-playback", status: "paused" } }, run: async (action: unknown) => { latest.push(action); return true; } }}><Help /></ShellProviders>));
  await key("k");
  expect(f.actions).toEqual([]);
  expect(latest).toEqual([{ type: "pause", playbackId: "new-playback", paused: false }]);
});

test("app navigation and shortcut help remain available without playback", async () => {
  const { pages } = fixture({ state: { ...state, queue: [], currentEntryId: null }, section: "Home" });
  await key("h"); await key("s"); await key("/"); await key(","); await key("p"); await key("q");
  expect(pages).toEqual(["Home", "Saved", "Find", "Settings", "queue"]);
  await key("?", { shiftKey: true });
  expect(screen.getByRole("dialog", { name: "Keyboard shortcuts" })).toBeInTheDocument();
  await userEvent.keyboard("{Escape}");
  expect(screen.queryByRole("dialog")).toBeNull();
});


test("Find keeps its type-to-search letters and numbers while / still focuses search", async () => {
  const { actions, pages } = fixture({ section: "Find" });
  const input = document.createElement("input"); input.id = "media-search"; document.body.append(input);
  try {
    for (const letter of ["k", "h", "s", "9"]) expect((await key(letter)).defaultPrevented).toBe(false);
    await key("/");
    expect(actions).toEqual([]); expect(pages).toEqual(["Find"]);
  } finally { input.remove(); }
});


test("mute and captions follow writable outputs and available subtitle tracks", async () => {
  const systemAudio = { selectedOutput: null, observedOutput: null, volume: 40, muted: false, error: null };
  const f = fixture({ state: { ...state, systemAudio, player: { ...state.player, tracks: [{ kind: "subtitle", index: 2, selected: true }] } } });
  await key("m"); await key("c");
  expect(f.actions).toEqual([{ type: "mute", muted: true }, { type: "track", playbackId: "playback", kind: "subtitle", index: -1 }]);
  f.actions.length = 0;
  await act(async () => f.view.rerender(<ShellProviders value={{ ...f.value, state: { ...state, systemAudio: { ...systemAudio, muteWritable: false, volumeWritable: false } } }}><Help /></ShellProviders>));
  await key("m"); await key("c"); await key("ArrowUp");
  expect(f.actions).toEqual([]);
});
