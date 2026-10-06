import { expect, test } from "bun:test";
import { outputStatus } from "../src/client/sections/shell/Outputs";
import type { ClientSessionState } from "../src/client/session/session";
import type { DeviceSummary, PlaybackSummary } from "../src/shared/protocol";

const device: DeviceSummary = { id: "speaker", name: "Kitchen", online: true, volume: 40, muted: false };
const playback: PlaybackSummary = { id: "current", title: "Evening programme", status: "playing", outputs: [{ deviceId: "tv", picture: true, sound: true }, { deviceId: device.id, picture: false, sound: true }] };
const state = (playbacks: PlaybackSummary[]) => ({ playbacks, devices: [device, { ...device, id: "tv", name: "Living room" }] }) as ClientSessionState;

test("a joined output keeps the current playback's factual status", () => {
  for (const [status, text] of [["playing", "Playing"], ["paused", "Paused"], ["loading", "Loading"], ["ended", "Finished"], ["error", "Can't play"]] as const) {
    expect(outputStatus(state([{ ...playback, status }]), device, playback.id)).toBe(text);
  }
});

test("busy devices name the other playback and unused devices give plain status", () => {
  expect(outputStatus(state([{ ...playback, status: "paused" }]), device, "another")).toBe("Paused Evening programme");
  expect(outputStatus(state([]), device, "current")).toBe("Not playing here");
  expect(outputStatus(state([playback]), { ...device, online: false }, playback.id)).toBe("Offline");
});
