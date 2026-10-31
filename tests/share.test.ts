import { describe, expect, test } from "bun:test";
import { routeOf } from "../src/client/session/live-route";
import type { ClientSessionState } from "../src/client/session/session";
import { selectionOf, shareKindOf, shareKinds, shareTargets, unavailable, viewerLine, viewersOf } from "../src/client/sections/share/share";
import type { DeviceSummary } from "../src/shared/protocol";

// The Share dialog's and the capsule's rules (docs/design/share.md, src/client/sections/share/share.ts).
const kind = (id: string) => shareKinds.find(item => item.id === id)!;
const screens = [{ id: "window:1", name: "Lisbon, May 2026", kind: "window" as const }, { id: "screen:1", name: "Built-in display", kind: "screen" as const }];
const device = (id: string, extra: Partial<DeviceSummary> = {}): DeviceSummary => ({ id, name: id, online: true, volume: 40, muted: false, sharing: { audio: true, video: true }, ...extra });

describe("what to share", () => {
  test("each kind captures as Couch does today, and the browser's picker opens on the chosen surface", () => {
    expect(selectionOf(kind("window"), { source: screens[0], quality: "720p", sound: false })).toEqual({ kind: "screen", sourceId: "window:1", videoQuality: "720p", videoFrameRate: 30, includeAudio: false, surface: "window" });
    expect(selectionOf(kind("screen"), { quality: "1080p", sound: true })).toEqual({ kind: "screen", videoQuality: "1080p", videoFrameRate: 30, includeAudio: true, surface: "monitor" });
    expect(selectionOf(kind("screen"), { quality: "original", frameRate: 120, sound: true })).toEqual({ kind: "screen", videoQuality: "original", videoFrameRate: 120, includeAudio: true, surface: "monitor" });
    expect(selectionOf(kind("screen"), { quality: "1080p", frameRate: 30, sound: true })).toEqual({ kind: "screen", videoQuality: "1080p", videoFrameRate: 30, includeAudio: true, surface: "monitor" });
    expect(selectionOf(kind("microphone"), { audioDeviceId: "usb", quality: "1080p", sound: true })).toEqual({ kind: "microphone", audioDeviceId: "usb" });
    expect(selectionOf(kind("microphone"), { audioDeviceId: "default", quality: "1080p", sound: true })).toEqual({ kind: "microphone" });
  });

  test("System audio takes the desktop app's first screen for its sound, and the browser's picker otherwise", () => {
    expect(selectionOf(kind("sound"), { sources: screens, quality: "1080p", sound: true })).toEqual({ kind: "system-audio", sourceId: "screen:1" });
    expect(selectionOf(kind("sound"), { quality: "1080p", sound: true })).toEqual({ kind: "system-audio" });
  });

  test("a browser without display capture keeps every kind in place but the microphone, with today's reason", () => {
    const phone = { media: true, display: false };
    expect(shareKinds.map(item => !unavailable(item, phone))).toEqual([false, false, false, true, true]);
    expect(unavailable(kind("screen"), phone)).toBe("This browser can share audio inputs. Use the desktop app to share a screen or system audio.");
    expect(unavailable(kind("microphone"), { media: false, display: false })).toContain("HTTPS");
  });

  test("a running share is named by how it captures", () => {
    expect(shareKindOf("screen", "window").label).toBe("Window");
    expect(shareKindOf("screen", "monitor").label).toBe("Screen");
    expect(shareKindOf("screen").label).toBe("Screen");
    expect(shareKindOf("system-audio").label).toBe("System audio");
  });
});

describe("Play on", () => {
  test("offers every other online device that lets others use its screen or speakers", () => {
    const state = { devices: [device("here"), device("tv"), device("away", { online: false }), device("phone", { sharing: { audio: false, video: false } }), device("speaker", { sharing: { audio: true, video: false } })] } as ClientSessionState;
    expect(shareTargets(state, "here").map(item => item.id)).toEqual(["tv", "speaker"]);
  });
});

describe("who's watching", () => {
  const state = {
    devices: [device("here"), device("tv"), device("kitchen"), device("bedroom")],
    playbacks: [
      { id: "a", title: null, status: "playing", liveSourceId: "s", outputs: [{ deviceId: "tv", picture: true, sound: true }, { deviceId: "kitchen", picture: false, sound: true }] },
      { id: "b", title: null, status: "playing", liveSourceId: "s", outputs: [{ deviceId: "bedroom", picture: true, sound: false, buffered: true }] },
      { id: "c", title: null, status: "playing", outputs: [{ deviceId: "here", picture: true, sound: true }] },
    ],
  } as unknown as ClientSessionState;

  test("lists every device the share plays on, across playbacks", () => {
    expect(viewersOf(state, "s").map(viewer => viewer.device.id)).toEqual(["tv", "kitchen", "bedroom"]);
  });

  test("leaves out an offline device whose output stays in the playback", () => {
    const away = { ...state, devices: state.devices.map(item => item.id === "tv" ? { ...item, online: false } : item) } as ClientSessionState;
    expect(viewersOf(away, "s").map(viewer => viewer.device.id)).toEqual(["kitchen", "bedroom"]);
  });

  test("counts only the channels the capture carries", () => {
    const silent = { ...state, liveSources: [{ id: "s", deviceId: "here", name: "Screen", kind: "screen", audio: false, video: true }] } as ClientSessionState;
    expect(viewersOf(silent, "s").map(viewer => [viewer.device.id, viewer.picture, viewer.sound])).toEqual([["tv", true, false], ["bedroom", true, false]]);
  });

  test("names each viewer's channels and route on the sharer's own panel, and Behind and Can't play as Where it plays does", () => {
    const [tv, kitchen, bedroom] = viewersOf(state, "s");
    expect(viewerLine(tv!, "direct")).toBe("Picture and sound, direct");
    expect(viewerLine(kitchen!, "relay")).toBe("Sound, through the relay");
    expect(viewerLine(kitchen!, undefined)).toBe("Sound");
    expect(viewerLine(bedroom!, undefined)).toBe("Picture, behind");
    expect(viewerLine({ ...bedroom!, error: "FFmpeg stopped" }, undefined)).toBe("Can't play: FFmpeg stopped");
  });

  test("scheduled sound uses Core's sync status rather than stale WebRTC route statistics", () => {
    const scheduled = { ...state, playbacks: state.playbacks.map(playback => ({ ...playback, delivery: "scheduled" as const, outputs: playback.outputs.map(output => ({ ...output, delayActive: output.deviceId === "tv" })) })) };
    const [tv, kitchen] = viewersOf(scheduled, "s");
    expect(viewerLine(tv!, undefined)).toBe("Picture and sound, in sync");
    expect(viewerLine(tv!, "direct")).toBe("Picture and sound, in sync");
    expect(viewerLine(kitchen!, "relay")).toBe("Sound, connecting");
    expect(viewerLine({ ...tv!, error: "This output cannot keep up." }, "direct")).toBe("Can't play: This output cannot keep up.");
  });
});

describe("routes", () => {
  const report = (entries: Record<string, object>) => new Map(Object.entries(entries).map(([id, value]) => [id, { id, ...value }])) as unknown as RTCStatsReport;
  test("read the selected candidate pair: relayed when either end's candidate is the relay's", () => {
    expect(routeOf(report({ t: { type: "transport", selectedCandidatePairId: "p" }, p: { type: "candidate-pair", localCandidateId: "l", remoteCandidateId: "r" }, l: { candidateType: "host" }, r: { candidateType: "srflx" } }))).toBe("direct");
    expect(routeOf(report({ t: { type: "transport", selectedCandidatePairId: "p" }, p: { type: "candidate-pair", localCandidateId: "l", remoteCandidateId: "r" }, l: { candidateType: "host" }, r: { candidateType: "relay" } }))).toBe("relay");
    // Firefox has no transport's selection, only the nominated pair.
    expect(routeOf(report({ p: { type: "candidate-pair", nominated: true, state: "succeeded", localCandidateId: "l", remoteCandidateId: "r" }, l: { candidateType: "relay" }, r: { candidateType: "host" } }))).toBe("relay");
    expect(routeOf(report({ p: { type: "candidate-pair", state: "in-progress", localCandidateId: "l" } }))).toBeUndefined();
  });
});


test("Live audio uses the chosen input with explicit intent and keeps relaxed audio input behavior", () => {
  expect(kind("microphone").label).toBe("Audio input");
  expect(kind("live-audio").label).toBe("Live audio");
  expect(selectionOf(kind("live-audio"), { audioDeviceId: "interface", quality: "1080p", sound: true })).toEqual({ kind: "microphone", audioDeviceId: "interface", intent: "live" });
  expect(shareKindOf("microphone", undefined, "live").label).toBe("Live audio");
  expect(shareKindOf("microphone").label).toBe("Audio input");
});
