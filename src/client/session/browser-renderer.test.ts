import { setupUiTests } from "@/testing/react";
import { afterEach, expect, test } from "bun:test";
import { createBrowserRenderer } from "./browser-renderer";
import type { PlayerState } from "../../shared/protocol";

setupUiTests();
afterEach(() => { document.querySelector("#couch-browser-video")?.remove(); localStorage.clear(); });

test("idle volume is reported and persisted without creating media, then applied to the first load", () => {
  const states: PlayerState[] = [];
  const renderer = createBrowserRenderer(state => states.push(state));
  renderer.command({ type: "volume", volume: 23 });
  expect(document.querySelector("video")).toBeNull();
  expect(states.at(-1)?.volume).toBe(23);
  expect(localStorage.getItem("couch.browser-volume")).toBe("0.23");
  renderer.command({ type: "load", playbackId: "first", source: "https://example.org/video.mp4", paused: true });
  expect(document.querySelector("video")?.volume).toBe(0.23);
  renderer.close();
});

test("unknown browser audio tracks do not invent a selected audio stream", () => {
  const states: PlayerState[] = [];
  const renderer = createBrowserRenderer(state => states.push(state));
  renderer.command({ type: "load", playbackId: "first", source: "https://example.org/video.mp4", paused: true });
  expect(states.at(-1)?.tracks?.filter(track => track.kind === "audio")).toEqual([]);
  expect(states.at(-1)?.audioTracksKnown).toBe(false);
  renderer.close();
});

test("available audio metadata reports real choices and applies explicit track selection", () => {
  const states: PlayerState[] = [];
  const renderer = createBrowserRenderer(state => states.push(state));
  renderer.command({ type: "load", playbackId: "first", source: "https://example.org/video.mp4", paused: true });
  const media = document.querySelector("video")!;
  const tracks = [
    { id: "en", label: "English", language: "en", enabled: true },
    { id: "it", label: "Italian", language: "it", enabled: false },
  ];
  Object.defineProperty(media, "audioTracks", { value: tracks });
  renderer.command({ type: "track", playbackId: "first", kind: "audio", index: 1 });
  expect(states.at(-1)?.tracks).toEqual([
    { id: "en", label: "English", language: "en", selected: false, kind: "audio", index: 0 },
    { id: "it", label: "Italian", language: "it", selected: true, kind: "audio", index: 1 },
  ]);
  renderer.close();
});

test("video-only metadata reports no audio selection", () => {
  const states: PlayerState[] = [];
  const renderer = createBrowserRenderer(state => states.push(state));
  renderer.command({ type: "load", playbackId: "first", source: "https://example.org/video.mp4", paused: true });
  const media = document.querySelector("video")!;
  Object.defineProperty(media, "audioTracks", { value: [] });
  Object.defineProperty(media, "videoWidth", { value: 640 });
  media.dispatchEvent(new Event("durationchange"));
  expect(states.at(-1)?.audioTracksKnown).toBe(true);
  expect(states.at(-1)?.tracks).toEqual([{ id: "default-video", index: 0, kind: "video", label: "Video", language: "", selected: true }]);
  renderer.close();
});


test("registration can report saved idle volume without creating media", () => {
  localStorage.setItem("couch.browser-volume", "0.37");
  const states: PlayerState[] = [];
  const renderer = createBrowserRenderer(state => states.push(state));
  renderer.report();
  expect(states.at(-1)).toMatchObject({ status: "idle", volume: 37 });
  expect(document.querySelector("video")).toBeNull();
  renderer.close();
});

test("autoplay refusal sets a structured gesture flag which a successful retry clears", async () => {
  const states: PlayerState[] = [];
  const renderer = createBrowserRenderer(state => states.push(state));
  renderer.command({ type: "load", playbackId: "first", source: "https://example.org/video.mp4", paused: true });
  const media = document.querySelector("video")!;
  media.play = () => Promise.reject(new DOMException("Blocked", "NotAllowedError"));
  renderer.play();
  await Bun.sleep(0);
  expect(states.at(-1)?.requiresGesture).toBe(true);
  media.play = () => Promise.resolve();
  renderer.play();
  await Bun.sleep(0);
  expect(states.at(-1)?.requiresGesture).toBe(false);
  renderer.close();
});

test("waiting playback reports loading and buffering does not leak across sources", () => {
  const states: PlayerState[] = [];
  const renderer = createBrowserRenderer(state => states.push(state));
  renderer.command({ type: "load", playbackId: "first", source: "https://example.org/first.mp4", paused: true });
  const media = document.querySelector("video")!;
  Object.defineProperty(media, "paused", { configurable: true, value: false });
  Object.defineProperty(media, "readyState", { configurable: true, value: 2 });
  media.dispatchEvent(new Event("canplay"));
  media.dispatchEvent(new Event("waiting"));
  expect(states.at(-1)).toMatchObject({ playbackId: "first", status: "loading", buffering: true });

  renderer.command({ type: "load", playbackId: "second", source: "https://example.org/second.mp4", paused: true });
  expect(states.at(-1)).toMatchObject({ playbackId: "second", buffering: false });
  media.dispatchEvent(new Event("waiting"));
  renderer.command({ type: "stop" });
  expect(states.at(-1)).toMatchObject({ playbackId: null, status: "idle", buffering: false });
  renderer.close();
});

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
};
const dashFixture = () => {
  const calls: unknown[] = [];
  let error: (event: any) => void = () => {};
  const player = {
    attach: async (_video: HTMLMediaElement) => { calls.push("attach"); },
    load: async (source: string, startTime?: number) => { calls.push([source, startTime]); },
    configure: (config: unknown) => { calls.push(config); },
    addEventListener: (_type: string, listener: (event: any) => void) => { error = listener; },
    trickPlay: (rate: number, useTrickPlayTrack?: boolean) => { calls.push(["speed", rate, useTrickPlayTrack]); document.querySelector("video")!.playbackRate = rate; },
    destroy: async () => { calls.push("destroy"); },
  };
  const library = { polyfill: { installAll() {} }, Player: Object.assign(function() { return player; }, { isBrowserSupported: () => true }) } as unknown as import("./browser-dash").DashLibrary;
  return { calls, player, library, error: (code: number) => error({ detail: { severity: 2, code, data: ["https://private.invalid/token"] } }) };
};

test("DASH stays lazy, preserves paused preparation/start position, and caps adaptive video", async () => {
  const fixture = dashFixture();
  const states: PlayerState[] = [];
  const originalLoad = fixture.player.load;
  fixture.player.load = async (source, startTime) => {
    document.querySelector("video")!.playbackRate = 1;
    await originalLoad(source, startTime);
  };
  let imports = 0;
  const renderer = createBrowserRenderer(state => states.push(state), async () => { imports++; return fixture.library; });
  renderer.report();
  expect(imports).toBe(0);
  expect(document.querySelector("video")).toBeNull();
  renderer.command({ type: "load", playbackId: "dash", source: "https://example.org/movie.mpd?token=secret", paused: true, startPosition: 42, maxVideoHeight: 720, preferences: { speed: 1.5, audioLanguage: "", subtitleLanguage: "", subtitles: "off", replayGain: "off", audioDelay: 0 } });
  const video = document.querySelector("video")!;
  Object.defineProperty(video, "readyState", { configurable: true, value: 2 });
  let plays = 0;
  video.play = async () => { plays++; };
  await Bun.sleep(0);
  expect(fixture.calls).toContainEqual({ manifest: { disableText: true }, restrictions: { maxHeight: 720 } });
  expect(fixture.calls).toContainEqual(["https://example.org/movie.mpd?token=secret", 42]);
  expect(video.playbackRate).toBe(1.5);
  expect(plays).toBe(0);
  expect(states.at(-1)).toMatchObject({ status: "paused", audioTracksKnown: false });
  video.playbackRate = 0;
  video.dispatchEvent(new Event("waiting"));
  expect(states.at(-1)?.speed).toBe(1.5);
  renderer.command({ type: "speed", playbackId: "dash", speed: 2 });
  expect(fixture.calls).toContainEqual(["speed", 2, false]);
  video.playbackRate = 0;
  fixture.error(3016);
  expect(states.at(-1)?.speed).toBe(2);
  expect(states.at(-1)).toMatchObject({ status: "error", error: "This browser cannot play DASH (3016). Try Couch TV." });
  await Bun.sleep(0);
  expect(fixture.calls).toContain("destroy");
  renderer.close();
  await Bun.sleep(0);
  expect(fixture.calls.filter(call => call === "destroy")).toHaveLength(1);
});

test("stopping during a delayed DASH import never attaches or loads", async () => {
  const fixture = dashFixture();
  const gate = deferred();
  const renderer = createBrowserRenderer(() => {}, async () => { await gate.promise; return fixture.library; });
  renderer.command({ type: "load", playbackId: "dash", source: "https://example.org/movie.mpd", paused: true });
  renderer.command({ type: "stop" });
  gate.resolve();
  await Bun.sleep(0);
  expect(fixture.calls).toEqual([]);
  renderer.close();
});

test("replacement waits for DASH attach and destroy before reusing the element", async () => {
  const fixture = dashFixture();
  const attach = deferred();
  const destroy = deferred();
  fixture.player.attach = async () => { await attach.promise; };
  fixture.player.destroy = async () => { fixture.calls.push("destroy"); await destroy.promise; };
  const renderer = createBrowserRenderer(() => {}, async () => fixture.library);
  renderer.command({ type: "load", playbackId: "dash", source: "https://example.org/movie.mpd", paused: true });
  await Bun.sleep(0);
  renderer.command({ type: "load", playbackId: "direct", source: "https://example.org/movie.mp4", paused: true });
  const video = document.querySelector("video")!;
  expect(video.getAttribute("src")).toBeNull();
  attach.resolve();
  await Bun.sleep(0);
  expect(fixture.calls).toEqual([{ manifest: { disableText: true } }, "destroy"]);
  expect(video.getAttribute("src")).toBeNull();
  destroy.resolve();
  await Bun.sleep(0);
  expect(video.src).toBe("https://example.org/movie.mp4");
  renderer.close();
});

test("progressive and HLS paths never import DASH", () => {
  const renderer = createBrowserRenderer(() => {}, async () => { throw new Error("Unexpected DASH import"); });
  for (const source of ["https://example.org/movie.mp4", "https://example.org/movie.m3u8", "https://example.org/movie.mp4?name=movie.mpd"]) {
    renderer.command({ type: "load", playbackId: source, source, paused: true });
    expect(document.querySelector("video")?.src).toBe(source);
  }
  renderer.close();
});

test("stop then a new direct load waits for pending DASH destruction", async () => {
  const fixture = dashFixture();
  const destroy = deferred();
  fixture.player.destroy = async () => { await destroy.promise; };
  const renderer = createBrowserRenderer(() => {}, async () => fixture.library);
  renderer.command({ type: "load", playbackId: "dash", source: "https://example.org/movie.mpd", paused: true });
  await Bun.sleep(0);
  renderer.command({ type: "stop" });
  renderer.command({ type: "load", playbackId: "direct", source: "https://example.org/movie.mp4", paused: true });
  const video = document.querySelector("video")!;
  expect(video.getAttribute("src")).toBeNull();
  destroy.resolve();
  await Bun.sleep(0);
  expect(video.src).toBe("https://example.org/movie.mp4");
  renderer.close();
});

test("closing during a delayed DASH import leaves no element or late player", async () => {
  const fixture = dashFixture();
  const gate = deferred();
  const renderer = createBrowserRenderer(() => {}, async () => { await gate.promise; return fixture.library; });
  renderer.command({ type: "load", playbackId: "dash", source: "https://example.org/movie.mpd", paused: true });
  renderer.close();
  gate.resolve();
  await Bun.sleep(0);
  expect(document.querySelector("video")).toBeNull();
  expect(fixture.calls).toEqual([]);
});

test("DASH speed intent survives old destruction and commands during preparation", async () => {
  const fixture = dashFixture();
  const destroy = deferred();
  fixture.player.destroy = async () => {
    await destroy.promise;
    document.querySelector("video")!.playbackRate = 1;
  };
  const states: PlayerState[] = [];
  const renderer = createBrowserRenderer(state => states.push(state), async () => fixture.library);
  renderer.command({ type: "load", playbackId: "old", source: "https://example.org/old.mpd", paused: true });
  await Bun.sleep(0);
  renderer.command({ type: "load", playbackId: "new", source: "https://example.org/new.mpd", paused: true });
  renderer.command({ type: "speed", playbackId: "new", speed: 1.75 });
  expect(states.at(-1)?.speed).toBe(1.75);
  destroy.resolve();
  await Bun.sleep(0);
  expect(fixture.calls).toContainEqual(["speed", 1.75, false]);
  expect(document.querySelector("video")!.playbackRate).toBe(1.75);
  renderer.close();
  await Bun.sleep(0);
});

test("stopping a pending DASH import releases the previous progressive source", async () => {
  const fixture = dashFixture();
  const gate = deferred();
  const renderer = createBrowserRenderer(() => {}, async () => { await gate.promise; return fixture.library; });
  renderer.command({ type: "load", playbackId: "direct", source: "https://example.org/movie.mp4", paused: true });
  const video = document.querySelector("video")!;
  let resets = 0;
  video.load = () => { resets++; };
  renderer.command({ type: "load", playbackId: "dash", source: "https://example.org/movie.mpd", paused: true });
  expect(video.getAttribute("src")).toBeNull();
  expect(resets).toBe(1);
  renderer.command({ type: "stop" });
  gate.resolve();
  await Bun.sleep(0);
  expect(fixture.calls).toEqual([]);
  expect(video.getAttribute("src")).toBeNull();
  renderer.close();
});
