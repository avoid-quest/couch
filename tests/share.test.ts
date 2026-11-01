import { describe, expect, test } from "bun:test";
import { routeOf } from "../src/client/session/live-route";
import type { ClientSessionState } from "../src/client/session/session";
import { shareTargets, viewersOf } from "../src/client/sections/share/share";
import type { DeviceSummary } from "../src/shared/protocol";

const device = (id: string, extra: Partial<DeviceSummary> = {}): DeviceSummary => ({
  id,
  name: id,
  online: true,
  volume: 40,
  muted: false,
  sharing: { audio: true, video: true },
  ...extra,
});

describe("Play on", () => {
  test("offers every other online device that lets others use its screen or speakers", () => {
    const state = {
      devices: [
        device("here"),
        device("tv"),
        device("away", { online: false }),
        device("phone", { sharing: { audio: false, video: false } }),
        device("speaker", { sharing: { audio: true, video: false } }),
      ],
    } as ClientSessionState;
    expect(shareTargets(state, "here").map((item) => item.id)).toEqual(["tv", "speaker"]);
  });
});

describe("who's watching", () => {
  const state = {
    devices: [device("here"), device("tv"), device("kitchen"), device("bedroom")],
    playbacks: [
      {
        id: "a",
        title: null,
        status: "playing",
        liveSourceId: "s",
        outputs: [
          { deviceId: "tv", picture: true, sound: true },
          { deviceId: "kitchen", picture: false, sound: true },
        ],
      },
      {
        id: "b",
        title: null,
        status: "playing",
        liveSourceId: "s",
        outputs: [{ deviceId: "bedroom", picture: true, sound: false, buffered: true }],
      },
      {
        id: "c",
        title: null,
        status: "playing",
        outputs: [{ deviceId: "here", picture: true, sound: true }],
      },
    ],
  } as unknown as ClientSessionState;

  test("lists every device the share plays on, across playbacks", () => {
    expect(viewersOf(state, "s").map((viewer) => viewer.device.id)).toEqual([
      "tv",
      "kitchen",
      "bedroom",
    ]);
  });

  test("leaves out an offline device whose output stays in the playback", () => {
    const away = {
      ...state,
      devices: state.devices.map((item) => (item.id === "tv" ? { ...item, online: false } : item)),
    } as ClientSessionState;
    expect(viewersOf(away, "s").map((viewer) => viewer.device.id)).toEqual(["kitchen", "bedroom"]);
  });

  test("counts only the channels the capture carries", () => {
    const silent = {
      ...state,
      liveSources: [
        { id: "s", deviceId: "here", name: "Screen", kind: "screen", audio: false, video: true },
      ],
    } as ClientSessionState;
    expect(
      viewersOf(silent, "s").map((viewer) => [viewer.device.id, viewer.picture, viewer.sound]),
    ).toEqual([
      ["tv", true, false],
      ["bedroom", true, false],
    ]);
  });
});

describe("routes", () => {
  const report = (entries: Record<string, object>) =>
    new Map(
      Object.entries(entries).map(([id, value]) => [id, { id, ...value }]),
    ) as unknown as RTCStatsReport;
  test("read the selected candidate pair: relayed when either end's candidate is the relay's", () => {
    expect(
      routeOf(
        report({
          t: { type: "transport", selectedCandidatePairId: "p" },
          p: { type: "candidate-pair", localCandidateId: "l", remoteCandidateId: "r" },
          l: { candidateType: "host" },
          r: { candidateType: "srflx" },
        }),
      ),
    ).toBe("direct");
    expect(
      routeOf(
        report({
          t: { type: "transport", selectedCandidatePairId: "p" },
          p: { type: "candidate-pair", localCandidateId: "l", remoteCandidateId: "r" },
          l: { candidateType: "host" },
          r: { candidateType: "relay" },
        }),
      ),
    ).toBe("relay");
    // Firefox has no transport's selection, only the nominated pair.
    expect(
      routeOf(
        report({
          p: {
            type: "candidate-pair",
            nominated: true,
            state: "succeeded",
            localCandidateId: "l",
            remoteCandidateId: "r",
          },
          l: { candidateType: "relay" },
          r: { candidateType: "host" },
        }),
      ),
    ).toBe("relay");
    expect(
      routeOf(
        report({ p: { type: "candidate-pair", state: "in-progress", localCandidateId: "l" } }),
      ),
    ).toBeUndefined();
  });
});
