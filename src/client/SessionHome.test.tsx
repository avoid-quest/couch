import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { Window } from "happy-dom";
import { act } from "react";
import type { Root } from "react-dom/client";
import type { Action, SessionState } from "../shared/protocol";

let root: Root, window: Window, request: ReturnType<typeof spyOn>;
const originals = new Map<string, PropertyDescriptor | undefined>();
const actions: Action[] = [], browsed: string[] = [];
const state: SessionState = {
  queue: ["past", "current", "next"].map(id => ({ id, title: id, source: `library:${id}` })), currentEntryId: "current", queueCursorEntryId: "current",
  activeProfile: { id: "household", name: "Household" },
  preferences: { profile: { audioLanguage: "", subtitleLanguage: "", subtitles: "auto", speed: 1, replayGain: "off" }, device: { audioDelay: 0 } },
  player: { playbackId: "playback", status: "playing", position: 12, duration: 100, volume: 30, seekable: true, error: null },
};
const button = (label: string) => [...document.querySelectorAll<HTMLButtonElement>("button")].find(node => node.getAttribute("aria-label") === label || node.textContent?.trim() === label)!;
async function render(value = state, connected = true, active = true, command?: (action: Action) => Promise<boolean>) {
  const { SessionHome } = await import("./SessionHome");
  await act(async () => root.render(<SessionHome state={value} credentials={{ origin: "http://localhost", token: "paired" }} connected={connected} active={active} onBrowse={name => browsed.push(name)} onPlay={async () => true} run={command ?? (async action => { actions.push(action); return true; })} />));
}
beforeEach(async () => {
  actions.length = 0; browsed.length = 0;
  window = new Window({ url: "http://localhost" });
  for (const key of ["CSS", "window", "document", "navigator", "HTMLElement", "HTMLInputElement", "HTMLFormElement", "HTMLButtonElement", "Element", "Node", "NodeFilter", "DocumentFragment", "MutationObserver", "ResizeObserver", "CustomEvent", "Event", "MouseEvent", "PointerEvent", "KeyboardEvent", "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame", "IS_REACT_ACT_ENVIRONMENT"]) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    const value = key === "IS_REACT_ACT_ENVIRONMENT" ? true : key === "window" ? window : Reflect.get(window, key);
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: typeof value === "function" && /^[a-z]/.test(key) ? value.bind(window) : value });
  }
  request = spyOn(globalThis, "fetch").mockImplementation((async () => Response.json({ profile: state.activeProfile, items: [] })) as unknown as typeof fetch);
  const { createRoot } = await import("react-dom/client");
  const container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount()); request.mockRestore(); await window.happyDOM.abort();
  for (const [key, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  originals.clear();
});
test("session presentation retains native playback commands and real upcoming queue actions", async () => {
  await render();
  expect(button("Pause").textContent).toBe("");
  expect(button("Next in queue").textContent).toBe("");
  expect(document.querySelector(".session-next-list")?.textContent).toContain("next");
  expect(document.querySelector(".session-next-list")?.textContent).not.toContain("past");
  expect(document.querySelector(".session-next-list")?.textContent).not.toContain("current");
  expect(document.querySelector(".session-playback-options")).toBeNull();
  expect(button("Stop playback").closest(".transport-buttons")).not.toBeNull();
  expect(document.body.textContent).not.toContain("Watching as");
  expect(actions).toEqual([]);
  await act(async () => button("Details for next").click());
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain("next");
  expect(actions).toEqual([]);
  await act(async () => button("Play next on TV").click());
  expect(actions).toEqual([{ type: "play", entryId: "next" }]);
  actions.length = 0;
  for (const label of ["Pause", "Next in queue", "Stop playback", "Remove next from Up next"]) await act(async () => button(label).click());
  expect(actions).toEqual([{ type: "pause", playbackId: "playback", paused: true }, { type: "next", playbackId: "playback" }, { type: "stop" }, { type: "remove", entryId: "next" }]);
  await act(async () => button("Find something").click());
  await act(async () => button("Browse sources").click());
  expect(browsed).toEqual(["Search", "Browse"]);
});
test("Stop preserves the durable queue cursor and disconnected controls cannot send commands", async () => {
  await render({ ...state, currentEntryId: null, player: { ...state.player, playbackId: null, status: "idle" } });
  expect(document.querySelector(".session-next-list")?.textContent).toContain("next");
  expect(document.querySelector(".session-next-list")?.textContent).not.toContain("current");
  expect(button("Resume")).toBeUndefined();
  expect(document.querySelector(".session-current-art")).toBeNull();
  expect(button("Remote").disabled).toBe(false);
  expect(document.querySelectorAll(".session-idle-actions button")).toHaveLength(1);
  await render(state, false);
  for (const label of ["Pause", "Next in queue", "Stop playback", "Remove next from Up next"]) { expect(button(label).disabled).toBe(true); await act(async () => button(label).click()); }
  await act(async () => button("Details for next").click());
  expect(button("Play next on TV").disabled).toBe(true);
  expect(button("Save next for later").disabled).toBe(true);
  expect(actions).toEqual([]);
});

test("seek controls clamp commands, remain focused during player updates and hide for live streams", async () => {
  await render({ ...state, player: { ...state.player, position: 4 } });
  const backward = button("Seek backward 10 seconds");
  backward.focus();
  await act(async () => backward.click());
  expect(actions).toEqual([{ type: "seek", playbackId: "playback", position: 0 }]);
  await render({ ...state, player: { ...state.player, position: 97, status: "paused" } });
  expect(button("Seek backward 10 seconds")).toBe(backward);
  expect(document.activeElement).toBe(backward);
  await act(async () => button("Seek forward 10 seconds").click());
  await act(async () => button("Resume").click());
  expect(actions.slice(1)).toEqual([{ type: "seek", playbackId: "playback", position: 100 }, { type: "pause", playbackId: "playback", paused: false }]);
  await render({ ...state, queue: state.queue.map(entry => ({ ...entry, live: true })), player: { ...state.player, seekable: false, duration: null } });
  expect(button("Seek backward 10 seconds")).toBeUndefined();
  expect(document.querySelector('.seek-control')).toBeNull();
  expect(button("Pause").disabled).toBe(false);
  expect(button("Stop playback").disabled).toBe(false);
});

test("loading keeps Stop available, unavailable audio stays honest, and idle has no transport controls", async () => {
  await render({ ...state, player: { ...state.player, status: "loading", seekable: false }, systemAudio: { selectedOutput: "hdmi", observedOutput: "hdmi", volume: null, muted: false, error: null } });
  expect(button("Resume").disabled).toBe(true);
  expect(button("Stop playback").disabled).toBe(false);
  expect(button("Mute TV").disabled).toBe(true);
  expect(document.querySelector('.volume-control')?.textContent).toContain("Unknown");
  await render({ ...state, queue: [state.queue[1]!], systemAudio: { selectedOutput: "hdmi", observedOutput: "hdmi", volume: 30, muted: true, error: null } });
  expect(button("Next in queue")).toBeUndefined();
  expect(button("Unmute TV").disabled).toBe(false);
  await act(async () => button("Unmute TV").click());
  expect(actions).toEqual([{ type: "mute", muted: false }]);
  await render({ ...state, currentEntryId: null, player: { ...state.player, playbackId: null, status: "idle" } });
  expect(document.querySelector('.transport-row')).toBeNull();
  expect(document.querySelector('.now-heading')).toBeNull();
  await act(async () => button("Remote").click());
  expect(browsed).toEqual(["Remote"]);
});


test("removed playback controls restore focus to a useful action without taking unrelated focus", async () => {
  const idle: SessionState = { ...state, currentEntryId: null, player: { ...state.player, playbackId: null, status: "idle" } };
  await render();
  button("Stop playback").focus();
  await act(async () => button("Stop playback").click());
  await render(idle);
  expect(document.activeElement).toBe(button("Remote"));
  expect(actions).toEqual([{ type: "stop" }]);

  await render();
  button("Next in queue").focus();
  await render({ ...state, queue: state.queue.slice(0, 2) });
  expect(document.activeElement).toBe(button("Pause"));

  await render();
  button("Stop playback").focus();
  const outside = document.createElement("button");
  document.body.append(outside);
  outside.focus();
  await render(idle);
  expect(document.activeElement).toBe(outside);
  outside.blur();
  await render(idle);
  expect(document.activeElement).toBe(document.body);

  await render();
  button("Stop playback").focus();
  await render(idle, true, false);
  expect(document.activeElement).toBe(document.body);
});


test("settings gear and Remote stay with the player and do not send playback commands", async () => {
  await render();
  const settings = button("Playback settings");
  expect(settings.textContent).toBe("");
  expect(settings.querySelector("svg")).not.toBeNull();
  expect(settings.closest(".transport-buttons")).toBe(button("Stop playback").closest(".transport-buttons"));
  expect(button("Remote").querySelector("svg")).not.toBeNull();
  expect(button("Remote").closest(".transport-row")).not.toBeNull();
  expect(document.body.textContent).not.toContain("TV navigation controls");
  settings.focus();
  await render({ ...state, player: { ...state.player, position: 13 } });
  expect(button("Playback settings")).toBe(settings);
  expect(document.activeElement).toBe(settings);
  await act(async () => settings.click());
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Playback settings");
  await act(async () => button("Done").click());
  await act(async () => new Promise(resolve => setTimeout(resolve, 10)));
  expect(document.activeElement).toBe(settings);
  await act(async () => button("Remote").click());
  expect(browsed).toEqual(["Remote"]);
  expect(actions).toEqual([]);

  await render({ ...state, currentEntryId: null, player: { ...state.player, playbackId: null, status: "idle" } });
  expect(button("Playback settings")).toBeUndefined();
  expect(button("Remote").disabled).toBe(false);
  expect(button("Remote").closest(".session-idle-actions")).not.toBeNull();
  await act(async () => button("Remote").click());
  expect(browsed).toEqual(["Remote", "Remote"]);
});


test("the playback gear offers current video quality first and keeps it through a quality reload", async () => {
  const value = { ...state, queue: [{ id: "current", title: "Video", source: "web:https://www.youtube.com/watch?v=abcdefghijk", quality: "1080p" as const }], player: { ...state.player, tracks: [{ id: "v", index: 0, kind: "video" as const, label: "Video", language: "", selected: true }] } };
  await render(value);
  await act(async () => button("Playback settings").click());
  const dialog = document.querySelector('[role="dialog"]')!;
  expect(dialog.querySelector('[role="combobox"]')?.id).toBe("playback-quality");
  expect(dialog.querySelector("#playback-quality")?.textContent).toBe("Up to 1080p");
  expect(dialog.querySelector("#playback-audio")).toBeNull();
  expect(dialog.querySelector("#playback-chapters")).toBeNull();
  expect(dialog.querySelector("#playback-replaygain")).toBeNull();
  const quality = dialog.querySelector<HTMLButtonElement>("#playback-quality")!;
  await act(async () => quality.click());
  const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(node => node.textContent === "Up to 720p")!;
  await act(async () => option.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
  expect(actions).toEqual([{ type: "videoQuality", playbackId: "playback", quality: "720p" }]);
  await render({ ...value, player: { ...value.player, status: "loading" } });
  expect(document.querySelector("#playback-quality")).toBe(quality);
  expect(quality.disabled).toBe(true);
  await render(value);
  expect(quality.disabled).toBe(false);
});

test("radio playback settings omit video quality, speed, empty tracks and unavailable music controls", async () => {
  await render({ ...state, queue: [{ id: "current", title: "Station", source: "radio:station", kind: "radio", live: true }], player: { ...state.player, seekable: false, tracks: [{ id: "a", index: 0, kind: "audio", label: "Audio", language: "", selected: true }] } });
  await act(async () => button("Playback settings").click());
  for (const id of ["playback-quality", "playback-speed", "playback-audio", "playback-subtitles", "playback-chapters", "playback-replaygain", "playback-subtitle-file"]) expect(document.getElementById(id)).toBeNull();
  expect(document.querySelector("#playback-audio-delay")).not.toBeNull();
  expect(actions).toEqual([]);
});


test("quality reload restores the ready trigger without taking focus after user navigation", async () => {
  const value = { ...state, queue: [{ id: "current", title: "Video", source: "web:https://www.youtube.com/watch?v=abcdefghijk", quality: "auto" as const }], player: { ...state.player, tracks: [{ id: "v", index: 0, kind: "video" as const, label: "Video", language: "", selected: true }] } };
  for (const navigate of [false, true]) {
    let resolve!: (ok: boolean) => void;
    const command = () => new Promise<boolean>(done => { resolve = done; });
    await render(value, true, true, command);
    await act(async () => button("Playback settings").click());
    const quality = document.querySelector<HTMLButtonElement>("#playback-quality")!;
    quality.getClientRects = () => [{ width: 200, height: 44 }] as unknown as DOMRectList;
    await act(async () => quality.click());
    await act(async () => [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(option => option.textContent === "Up to 720p")!.click());
    const loading = { ...value, player: { ...value.player, playbackId: "replacement", status: "loading" as const, tracks: [] } };
    await render(loading, true, true, command);
    await act(async () => resolve(true));
    await act(async () => new Promise(done => setTimeout(done, 25)));
    expect(quality.disabled).toBe(true);
    await render({ ...loading, player: { ...loading.player, status: "paused", seekable: false } }, true, true, command);
    expect(document.querySelector("#playback-quality")).toBe(quality);
    if (navigate) {
      await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true })));
      button("Done").focus();
    }
    await render({ ...value, player: { ...value.player, playbackId: "replacement", status: "paused" } }, true, true, command);
    await act(async () => new Promise(done => setTimeout(done, 25)));
    expect(document.activeElement).toBe(navigate ? button("Done") : quality);
    await render(loading, true, true, command);
    if (!navigate) quality.blur();
    await render({ ...value, player: { ...value.player, playbackId: "replacement", status: "paused" } }, true, true, command);
    await act(async () => new Promise(done => setTimeout(done, 25)));
    expect(document.activeElement).toBe(navigate ? button("Done") : quality);
    await act(async () => button("Done").click());
  }
});


test("Home keeps finished album tracks beside resumable online history without a second destination", async () => {
  request.mockResolvedValue(Response.json({ profile: state.activeProfile, items: [
    { mediaId: "media:album", title: "Finished album track", libraryItemId: null, position: 0, duration: 210, watched: true, lastPlayedAt: 20, playable: true, thumbnail: "https://example.com/album.jpg" },
    { mediaId: "media:video", title: "Unfinished video", libraryItemId: null, position: 43, duration: 300, watched: false, lastPlayedAt: 10, playable: true },
  ] }));
  await render();
  expect(document.querySelector('[aria-label="Playback history"]')?.textContent).toContain("Finished album track");
  expect(document.querySelector('[aria-label="Playback history"]')?.textContent).toContain("Unfinished video");
  expect(document.querySelector('[aria-label="Playback history"]')?.textContent).not.toContain("Profile");
  expect(document.querySelector<HTMLImageElement>(".history-inspect-art img")?.src).toBe("https://example.com/album.jpg");
  await act(async () => button("Details for Finished album track").click());
  expect(button("Play again Finished album track").disabled).toBe(false);
  expect(document.querySelector('[role="dialog"]')?.textContent).not.toContain("Open this file");
});


test("Home queue plays directly and moves focus into transport when the chosen row disappears", async () => {
  await render();
  const play = button("Play next");
  play.focus();
  await act(async () => play.click());
  expect(actions).toEqual([{ type: "play", entryId: "next" }]);
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  await render({ ...state, currentEntryId: "next", queueCursorEntryId: "next", player: { ...state.player, playbackId: "next-play", status: "loading" } });
  expect(document.activeElement).toBe(button("Stop playback"));
  await render(state, false);
  expect(button("Play next").disabled).toBe(true);
});
