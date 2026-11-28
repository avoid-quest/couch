import { describe, expect, test } from "bun:test";
import type { ClientSessionState } from "../src/client/session/session";
import {
  arrange,
  chooserFor,
  chooserRequest,
  counts,
  picker,
  playOnTargets,
  reopens,
  soundActions,
} from "../src/client/session/where-it-plays";
import { applySteps, groupStatus, planGroup, undoSteps } from "../src/client/session/groups";
import type { MixerGroup } from "../src/shared/mixer-groups";
import type { DeviceSummary, Output, PlaybackSummary } from "../src/shared/protocol";
import type { LiveSource } from "../src/shared/live-input";

// The rules in src/client/session/where-it-plays.ts. "here" is this device; every other device
// shares its speakers and screen unless a test says otherwise.
const here = "here";
const shared = { audio: true, video: true };
const device = (id: string, extra: Partial<DeviceSummary> = {}): DeviceSummary => ({
  id,
  name: id[0]!.toUpperCase() + id.slice(1),
  online: true,
  volume: 50,
  muted: false,
  sharing: shared,
  ...extra,
});
const both = (deviceId: string, extra: Partial<Output> = {}): Output => ({
  deviceId,
  picture: true,
  sound: true,
  ...extra,
});
const sound = (deviceId: string, extra: Partial<Output> = {}): Output => ({
  deviceId,
  picture: false,
  sound: true,
  ...extra,
});
const picture = (deviceId: string, extra: Partial<Output> = {}): Output => ({
  deviceId,
  picture: true,
  sound: false,
  ...extra,
});
// The looked-at playback "film" plays on `outputs`; `others` are every other playback.
function session({
  outputs = [],
  devices = [
    device(here, { sharing: { audio: false, video: false } }),
    device("tv"),
    device("kitchen"),
  ],
  film = {},
  others = [],
  ...rest
}: {
  outputs?: Output[];
  devices?: DeviceSummary[];
  film?: Partial<PlaybackSummary>;
  others?: PlaybackSummary[];
} & Partial<ClientSessionState> = {}) {
  const playback: PlaybackSummary = {
    id: "film",
    title: "Montalbano",
    status: "playing",
    outputs,
    ...film,
  };
  return {
    queue: [{ id: "e", title: "Montalbano", source: "x" }],
    currentEntryId: "e",
    playback: "film",
    outputs,
    devices,
    playbacks: [playback, ...others],
    player: {
      playbackId: "p",
      status: "playing",
      position: 0,
      duration: null,
      volume: 50,
      seekable: false,
      error: null,
    },
    ...rest,
  } as unknown as ClientSessionState;
}
const rows = (state: ClientSessionState) => picker(state, { here }).rows;
const row = (state: ClientSessionState, id: string) =>
  rows(state).find((item) => item.device.id === id)!;
const radio = (outputs: Output[]): PlaybackSummary => ({
  id: "radio",
  title: "avoid radio",
  status: "paused",
  outputs,
  audioOnly: true,
});
const screen = {
  id: "s",
  deviceId: "mac",
  name: "Mac · Screen",
  kind: "screen",
  audio: true,
  video: true,
} as const;

test("Can't play counts and shows an output when its Playback fails", () => {
  const state = session({
    film: { status: "error" },
    outputs: [both("tv", { error: "Couldn't start media" })],
  });
  const devices = rows(state);
  const count = counts(devices).find((item) => item.filter === "error")?.count ?? 0;
  const visible = arrange(devices, undefined, "error").playing.map((item) => item.device.id);
  expect({ count, visible }).toEqual({ count: 1, visible: ["tv"] });
});

describe("Picture and Sound", () => {
  test("each adds its own channel, sound at the device's own level", () => {
    const tv = row(session({ devices: [device("tv", { volume: 40 })] }), "tv");
    expect([tv.picture.action, tv.sound.action]).toEqual([
      { type: "output", deviceId: "tv", picture: true },
      { type: "output", deviceId: "tv", level: 40 },
    ]);
  });

  test("Sound adds at 50 when the device's level is 0, since 0 would leave it out", () => {
    expect(
      row(session({ devices: [device("tv", { volume: 0 })] }), "tv").sound.action,
    ).toMatchObject({ level: 50 });
  });

  test("offer only what the device shares and the media has", () => {
    const devices = [
      device("speaker", { sharing: { audio: true, video: false } }),
      device("screen", { sharing: { audio: false, video: true } }),
      device("tv"),
    ];
    expect(row(session({ devices }), "speaker")).toMatchObject({
      picture: { enabled: false, reason: "Private" },
      sound: { enabled: true },
    });
    expect(row(session({ devices }), "screen")).toMatchObject({
      picture: { enabled: true },
      sound: { enabled: false, reason: "Private" },
    });
    expect(row(session({ devices, film: { audioOnly: true } }), "tv")).toMatchObject({
      picture: { enabled: false, reason: "No picture" },
      sound: { enabled: true },
    });
    const silent = session({
      devices: [device("mac"), ...devices],
      film: { liveSourceId: "s" },
      liveSources: [{ ...screen, audio: false }],
    });
    expect(row(silent, "tv")).toMatchObject({
      picture: { enabled: true },
      sound: { enabled: false, reason: "No sound" },
    });
  });

  test("this device adds itself without sharing anything", () => {
    expect(row(session(), here)).toMatchObject({
      picture: { enabled: true },
      sound: { enabled: true },
    });
  });

  test("turn off their own channel, and the last one takes the device out", () => {
    const tv = row(session({ outputs: [both("tv")] }), "tv");
    expect([tv.picture.action, tv.sound.action]).toEqual([
      { type: "output", deviceId: "tv", picture: false },
      { type: "output", deviceId: "tv", level: 0 },
    ]);
    expect(row(session({ outputs: [sound("tv")] }), "tv").sound.action).toEqual({
      type: "output",
      deviceId: "tv",
      level: 0,
    });
    expect(row(session({ outputs: [picture("tv")] }), "tv").picture.action).toEqual({
      type: "output",
      deviceId: "tv",
      picture: false,
    });
    // Radio: the picture it chose shows nothing, so Sound is its last channel and takes both out.
    expect(
      row(session({ outputs: [both("tv")], film: { audioOnly: true } }), "tv").sound.action,
    ).toEqual({ type: "output", deviceId: "tv", picture: false, level: 0 });
  });

  test("can't take out another device's private channel, but its owner can", () => {
    const devices = [
      device(here, { sharing: { audio: false, video: false } }),
      device("phone", { sharing: { audio: true, video: false } }),
    ];
    expect(
      row(session({ devices, outputs: [both("phone", { local: true })] }), "phone"),
    ).toMatchObject({ picture: { enabled: false, reason: "Private" }, sound: { enabled: true } });
    expect(
      row(session({ devices, outputs: [sound("phone", { local: true })] }), "phone").sound.enabled,
    ).toBe(true);
    expect(row(session({ devices, outputs: [both(here, { local: true })] }), here)).toMatchObject({
      picture: { enabled: true },
      sound: { enabled: true },
    });
  });

  test("a device busy elsewhere moves here, unless its output there is private", () => {
    expect(row(session({ others: [radio([sound("kitchen")])] }), "kitchen").sound.enabled).toBe(
      true,
    );
    const state = session({
      devices: [device("phone", { sharing: { audio: true, video: false } })],
      others: [
        { id: "own", title: "Own", status: "playing", outputs: [both("phone", { local: true })] },
      ],
    });
    expect(row(state, "phone")).toMatchObject({
      status: "Private",
      sound: { enabled: false, reason: "Private" },
    });
  });

  test("a held publisher's private output counts as its place in that playback", () => {
    const state = session({
      devices: [device("phone", { sharing: { audio: true, video: false } })],
      others: [
        {
          id: "src",
          title: "Screen",
          status: "playing",
          outputs: [],
          held: both("phone", { local: true }),
        },
      ],
    });
    expect(row(state, "phone")).toMatchObject({
      status: "Private",
      sound: { enabled: false, reason: "Private" },
    });
  });

  test("a shared source's publisher never plays it", () => {
    const state = session({
      devices: [device("mac"), device("tv")],
      outputs: [both("tv")],
      film: { liveSourceId: "s" },
      liveSources: [screen],
    });
    expect(row(state, "mac")).toMatchObject({
      sound: { enabled: false },
      level: { enabled: false },
      picture: { enabled: false },
      move: { enabled: false },
    });
  });

  test("a channel only the host can play locks every device that isn't its output", () => {
    const state = session({ outputs: [both("tv")], film: { hostOnly: true } });
    expect(row(state, "kitchen")).toMatchObject({
      picture: { enabled: false },
      sound: { enabled: false },
      move: { enabled: false },
    });
    expect(row(state, "tv")).toMatchObject({ sound: { enabled: true }, level: { enabled: true } });
  });

  test("turning on a muted device's Sound or raising its fader unmutes it; anything else leaves Mute as it is", () => {
    const muted = row(
      session({ devices: [device("tv", { muted: true })], outputs: [picture("tv")] }),
      "tv",
    );
    const unmute = { type: "mute", deviceId: "tv", muted: false };
    expect(soundActions(muted, muted.sound.action)).toEqual([muted.sound.action, unmute]);
    expect(soundActions(muted, { type: "output", deviceId: "tv", level: 30 })).toEqual([
      { type: "output", deviceId: "tv", level: 30 },
      unmute,
    ]);
    expect(soundActions(muted, { type: "output", deviceId: "tv", level: 0 })).toEqual([
      { type: "output", deviceId: "tv", level: 0 },
    ]);
    expect(soundActions(muted, muted.picture.action)).toEqual([muted.picture.action]);
    const heard = row(session({ outputs: [picture("tv")] }), "tv");
    expect(soundActions(heard, heard.sound.action)).toEqual([heard.sound.action]);
  });

  test("a source without sound plays none on a device that chose sound, and its Picture, the last channel it plays, still takes the sound out", () => {
    const live = (outputs: Output[], source: LiveSource) =>
      session({
        devices: [device("mac"), device("tv"), device("kitchen")],
        outputs,
        film: { liveSourceId: "s" },
        liveSources: [source],
      });
    const silent = live([both("tv"), sound("kitchen")], { ...screen, audio: false });
    expect(row(silent, "tv")).toMatchObject({
      level: { value: 0, sound: false, enabled: false, reason: "No sound" },
      picture: { on: true, action: { type: "output", deviceId: "tv", picture: false, level: 0 } },
    });
    expect(row(silent, "kitchen")).toMatchObject({ picture: { on: false }, sound: { on: false } });
  });
});

describe("consent", () => {
  const foreign = (sharing: DeviceSummary["sharing"]) => [
    device(here, { sharing: { audio: false, video: false } }),
    device("phone", { sharing }),
  ];

  test("a private sound disables Sound and the fader for others", () => {
    const state = session({
      devices: foreign({ audio: false, video: true }),
      outputs: [both("phone", { local: true })],
    });
    expect(row(state, "phone")).toMatchObject({
      picture: { enabled: true },
      sound: { enabled: false },
      level: { enabled: false, reason: "Private" },
    });
  });

  test("a device playing privately in another playback can't be moved here", () => {
    const state = session({
      devices: foreign({ audio: true, video: false }),
      others: [
        { id: "own", title: "Own", status: "playing", outputs: [both("phone", { local: true })] },
      ],
    });
    expect(row(state, "phone")).toMatchObject({
      picture: { enabled: false },
      sound: { enabled: false },
      level: { enabled: false, reason: "Private" },
      move: { enabled: false },
    });
  });

  test("this device keeps its own controls while viewing another playback, its private output included", () => {
    const own = session({
      devices: [device(here, { sharing: { audio: false, video: false } }), device("tv")],
      outputs: [both("tv")],
      others: [
        { id: "mine", title: "Mine", status: "playing", outputs: [both(here, { local: true })] },
      ],
    });
    expect(row(own, here)).toMatchObject({
      mine: true,
      picture: { enabled: true },
      sound: { enabled: true },
      move: { enabled: true },
    });
  });

  test("Move here is unavailable everywhere while another device's private output plays in it", () => {
    const state = session({
      devices: [
        device(here),
        device("tv"),
        device("phone", { sharing: { audio: false, video: false } }),
      ],
      outputs: [both("tv"), both("phone", { local: true })],
    });
    expect(
      rows(state).map((item) => [item.device.id, item.move?.enabled, item.move?.reason]),
    ).toEqual([
      ["tv", false, "Private"],
      ["phone", false, "Private"],
      [here, false, "Private"],
    ]);
  });

  test("Move here is unavailable while a publisher's private output waits to return after its source", () => {
    const state = session({
      devices: [
        device(here),
        device("tv"),
        device("mac", { sharing: { audio: false, video: false } }),
      ],
      outputs: [both("tv")],
      film: { liveSourceId: "s", held: both("mac", { local: true }) },
      liveSources: [screen],
    });
    expect(row(state, "tv").move?.enabled).toBe(false);
  });

  test("this device's own private output blocks nobody, since it may leave", () => {
    const state = session({
      devices: [device(here, { sharing: { audio: false, video: false } }), device("tv")],
      outputs: [both("tv"), both(here, { local: true })],
    });
    expect(row(state, "tv").move?.enabled).toBe(true);
    expect(row(state, here).move?.enabled).toBe(true);
  });

  test("Play on offers this device first, then the other online devices that share, and nothing while this is the only one", () => {
    const state = session({
      devices: [
        device("tv"),
        device("phone", { sharing: { audio: false, video: false } }),
        device("kitchen", { online: false }),
        device(here, { sharing: { audio: false, video: false } }),
      ],
    });
    expect(playOnTargets(state, here).map((item) => item.id)).toEqual([here, "tv"]);
    expect(playOnTargets(session({ devices: [device(here)] }), here)).toEqual([]);
  });
});

describe("the chooser", () => {
  const waiting = (choosing?: number) => session({ film: { liveSourceId: "s", choosing } });

  test("a waiting source's request names its playback and Core's count", () => {
    expect(chooserRequest(waiting(3))).toBe("film:3");
    expect(chooserRequest(waiting())).toBeNull();
  });

  test("opens for each new request and stays as the user left it", () => {
    expect(reopens(null, "film:3")).toBe(true);
    expect(reopens("film:3", "film:3")).toBe(false);
    expect(reopens("film:3", "film:4")).toBe(true);
    expect(reopens("film:3", null)).toBe(false);
  });

  test("Core's request decides; otherwise this window's own request opens it only for the playback it views", () => {
    expect(chooserFor("film:3", "film", "film:here:1")).toBe("film:3");
    expect(chooserFor(null, "film", "film:here:1")).toBe("film:here:1");
    expect(chooserFor(null, "other", "film:here:1")).toBeNull();
    expect(chooserFor(null, null, "film:here:1")).toBeNull();
  });
});

describe("groups", () => {
  // Living room: the TV's picture and the kitchen's sound.
  const livingRoom: MixerGroup = {
    id: "g",
    name: "Living room",
    members: [
      { deviceId: "tv", picture: true, sound: false },
      { deviceId: "kitchen", picture: false, sound: true },
    ],
  };
  const plan = (state: ClientSessionState, group = livingRoom) =>
    planGroup(group, rows(state), state);
  const lines = (items: { deviceId: string; channel: string }[]) =>
    items.map((item) => `${item.deviceId} ${item.channel}`);

  test("applying asks for each missing channel and takes out the rest, gaining devices before any leaves", () => {
    const state = session({ outputs: [both(here)] });
    const result = plan(state);
    expect(lines(result.changes)).toEqual([
      "here picture",
      "here sound",
      "tv picture",
      "kitchen sound",
    ]);
    expect(applySteps(result, rows(state), "p").flatMap((step) => step.actions)).toEqual([
      { type: "output", deviceId: "tv", picture: true, playbackId: "p" },
      { type: "output", deviceId: "kitchen", level: 50, playbackId: "p" },
      { type: "output", deviceId: here, picture: false, level: 0, playbackId: "p" },
    ]);
    expect(groupStatus(result)).toEqual({ on: false });
    expect(groupStatus(plan(session({ outputs: [picture("tv"), sound("kitchen")] })))).toEqual({
      on: true,
    });
  });

  test("a device's consent, an offline device and another device's private playback stay as they are", () => {
    const state = session({
      outputs: [picture("tv"), sound(here)],
      devices: [
        device(here, { sharing: { audio: false, video: false } }),
        device("tv"),
        device("kitchen", { sharing: { audio: false, video: true } }),
      ],
    });
    const result = plan(state);
    expect(result.left).toEqual([
      { deviceId: "kitchen", name: "Kitchen", channel: "sound", reason: "private", stays: false },
    ]);
    // This device's own sound is its own to take out.
    expect(lines(result.changes)).toEqual(["here sound"]);
    expect(
      plan(
        session({
          outputs: [picture("tv")],
          devices: [device("tv"), device("kitchen", { online: false })],
        }),
      ).left.map((item) => item.reason),
    ).toEqual(["offline"]);
    // The kitchen plays something of its own elsewhere: the group leaves it there.
    const own = session({
      outputs: [picture("tv")],
      devices: [
        device(here),
        device("tv"),
        device("kitchen", { sharing: { audio: false, video: true } }),
      ],
      others: [{ id: "own", status: "playing", outputs: [sound("kitchen")] } as PlaybackSummary],
    });
    expect(plan(own).left.map((item) => `${item.deviceId} ${item.reason}`)).toEqual([
      "kitchen private",
    ]);
    expect(groupStatus(plan(own))).toEqual({ on: false, part: "1 of 2" });
  });

  test("says which programme it takes a device from, and asks no picture of media without one", () => {
    const state = session({
      outputs: [picture("tv")],
      others: [radio([sound("kitchen")])],
    });
    expect(plan(state).changes).toEqual([
      { deviceId: "kitchen", name: "Kitchen", channel: "sound", on: true, from: "avoid radio" },
    ]);
    const listening = session({ outputs: [sound("kitchen")], film: { audioOnly: true } });
    expect(plan(listening).wanted).toBe(1);
    expect(groupStatus(plan(listening))).toEqual({ on: true });
    // An offline screen's picture isn't counted for radio either.
    const offline = session({
      outputs: [sound("kitchen")],
      devices: [device("tv", { online: false }), device("kitchen")],
      film: { audioOnly: true },
    });
    expect(groupStatus(plan(offline))).toEqual({ on: true });
  });

  test("a device the group leaves out leaves whole, its picture on radio too", () => {
    const radio = session({ outputs: [both("tv")], film: { audioOnly: true } });
    const kitchen: MixerGroup = {
      ...livingRoom,
      members: [{ deviceId: "kitchen", picture: false, sound: true }],
    };
    expect(applySteps(plan(radio, kitchen), rows(radio), "p").at(-1)!.actions).toEqual([
      { type: "output", deviceId: "tv", picture: false, level: 0, playbackId: "p" },
    ]);
  });

  test("while none of the group can play here, it takes nothing out", () => {
    const state = session({
      outputs: [both("tv")],
      devices: [device("tv"), device("kitchen", { sharing: { audio: false, video: false } })],
    });
    const kitchen: MixerGroup = {
      ...livingRoom,
      members: [{ deviceId: "kitchen", picture: false, sound: true }],
    };
    expect(plan(state, kitchen).changes).toEqual([]);
  });

  test("Undo turns back exactly the channels it changed", () => {
    const before = session({ outputs: [both(here)] });
    const applied = plan(before).changes;
    const after = session({ outputs: [picture("tv"), sound("kitchen")] });
    expect(undoSteps(applied, rows(after), "p").flatMap((step) => step.actions)).toEqual([
      { type: "output", deviceId: here, picture: true, level: 50, playbackId: "p" },
      { type: "output", deviceId: "tv", picture: false, playbackId: "p" },
      { type: "output", deviceId: "kitchen", level: 0, playbackId: "p" },
    ]);
  });
});
