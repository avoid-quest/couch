import { describe, expect, test } from "bun:test";
import { muted } from "../src/client/components/PlaybackTransport";
import { playsOn } from "../src/client/session/device-id";
import type { ClientSessionState } from "../src/client/session/session";
import { arrange, chooserFor, chooserRequest, counts, crowded, orderOf, picker, playingOn, playOnTargets, reopens, soundActions } from "../src/client/session/where-it-plays";
import type { DeviceSummary, Output, PlaybackSummary } from "../src/shared/protocol";

// One rule per test, in the order of docs/design/where-it-plays.md (src/client/session/where-it-plays.ts). "here" is this device; every other device
// shares its speakers and screen unless a test says otherwise.
const here = "here";
const shared = { audio: true, video: true };
const device = (id: string, extra: Partial<DeviceSummary> = {}): DeviceSummary => ({ id, name: id[0]!.toUpperCase() + id.slice(1), online: true, volume: 50, muted: false, sharing: shared, ...extra });
const both = (deviceId: string, extra: Partial<Output> = {}): Output => ({ deviceId, picture: true, sound: true, ...extra });
const sound = (deviceId: string, extra: Partial<Output> = {}): Output => ({ deviceId, picture: false, sound: true, ...extra });
const picture = (deviceId: string, extra: Partial<Output> = {}): Output => ({ deviceId, picture: true, sound: false, ...extra });
// The looked-at playback "film" plays on `outputs`; `others` are every other playback.
function session({ outputs = [], devices = [device(here, { sharing: { audio: false, video: false } }), device("tv"), device("kitchen")], film = {}, others = [], ...rest }: { outputs?: Output[]; devices?: DeviceSummary[]; film?: Partial<PlaybackSummary>; others?: PlaybackSummary[] } & Partial<ClientSessionState> = {}) {
  const playback: PlaybackSummary = { id: "film", title: "Montalbano", status: "playing", outputs, ...film };
  return { queue: [{ id: "e", title: "Montalbano", source: "x" }], currentEntryId: "e", playback: "film", outputs, devices, playbacks: [playback, ...others], player: { playbackId: "p", status: "playing", position: 0, duration: null, volume: 50, seekable: false, error: null }, ...rest } as unknown as ClientSessionState;
}
const rows = (state: ClientSessionState) => picker(state, { here }).rows;
const row = (state: ClientSessionState, id: string) => rows(state).find(item => item.device.id === id)!;
const radio = (outputs: Output[]): PlaybackSummary => ({ id: "radio", title: "avoid radio", status: "paused", outputs, audioOnly: true });
const screen = { id: "s", deviceId: "mac", name: "Mac · Screen", kind: "screen", audio: true, video: true } as const;

describe("the first line", () => {
  test("is the Volume, or asks you to choose where a waiting source plays", () => {
    expect(picker(session(), { here }).choose).toBeUndefined();
    expect(picker(session({ film: { liveSourceId: "s", status: "paused" }, liveSources: [screen] }), { here }).choose).toBe("Choose where Montalbano plays");
  });
});

describe("rows", () => {
  test("lists every device once, the playback's first", () => {
    const state = session({ outputs: [sound("kitchen")], devices: [device("away", { online: false }), device(here, { sharing: { audio: false, video: false } }), device("phone", { sharing: { audio: false, video: false } }), device("kitchen")] });
    expect(rows(state).map(item => item.device.id)).toEqual(["kitchen", "away", here, "phone"]);
  });

  test("say only what matters: nothing for a device that plays or is free, Private where consent leaves nothing to change", () => {
    const state = session({ outputs: [both("tv")], devices: [device("tv"), device("kitchen"), device("phone", { sharing: { audio: false, video: false } })] });
    expect([row(state, "tv").status, row(state, "kitchen").status, row(state, "phone").status]).toEqual(["", "", "Private"]);
  });

  test("an offline output keeps its row, every control disabled", () => {
    const state = session({ devices: [device("tv", { online: false }), device("kitchen")], outputs: [both("tv"), sound("kitchen")] });
    expect(row(state, "tv")).toMatchObject({ status: "Offline", picture: { enabled: false, reason: "Offline" }, sound: { enabled: false }, level: { enabled: false }, move: { enabled: false } });
  });

  test("Picture is pressed while it shows the playback's picture, never for media without one", () => {
    expect(row(session({ outputs: [both("tv")] }), "tv").picture.on).toBe(true);
    expect(row(session({ outputs: [sound("tv")] }), "tv").picture.on).toBe(false);
    expect(row(session({ outputs: [both("tv")], film: { audioOnly: true } }), "tv").picture).toMatchObject({ on: false, enabled: false, reason: "No picture" });
  });
});

describe("Picture and Sound", () => {
  test("each adds its own channel, sound at the device's own level", () => {
    const tv = row(session({ devices: [device("tv", { volume: 40 })] }), "tv");
    expect([tv.picture.action, tv.sound.action]).toEqual([{ type: "output", deviceId: "tv", picture: true }, { type: "output", deviceId: "tv", level: 40 }]);
  });

  test("Sound adds at 50 when the device's level is 0, since 0 would leave it out", () => {
    expect(row(session({ devices: [device("tv", { volume: 0 })] }), "tv").sound.action).toMatchObject({ level: 50 });
  });

  test("offer only what the device shares and the media has", () => {
    const devices = [device("speaker", { sharing: { audio: true, video: false } }), device("screen", { sharing: { audio: false, video: true } }), device("tv")];
    expect(row(session({ devices }), "speaker")).toMatchObject({ picture: { enabled: false, reason: "Private" }, sound: { enabled: true } });
    expect(row(session({ devices }), "screen")).toMatchObject({ picture: { enabled: true }, sound: { enabled: false, reason: "Private" } });
    expect(row(session({ devices, film: { audioOnly: true } }), "tv")).toMatchObject({ picture: { enabled: false, reason: "No picture" }, sound: { enabled: true } });
    const silent = session({ devices: [device("mac"), ...devices], film: { liveSourceId: "s" }, liveSources: [{ ...screen, audio: false }] });
    expect(row(silent, "tv")).toMatchObject({ picture: { enabled: true }, sound: { enabled: false, reason: "No sound" } });
  });

  test("this device adds itself without sharing anything", () => {
    expect(row(session(), here)).toMatchObject({ picture: { enabled: true }, sound: { enabled: true } });
  });

  test("turn off their own channel, and the last one takes the device out", () => {
    const tv = row(session({ outputs: [both("tv")] }), "tv");
    expect([tv.picture.action, tv.sound.action]).toEqual([{ type: "output", deviceId: "tv", picture: false }, { type: "output", deviceId: "tv", level: 0 }]);
    expect(row(session({ outputs: [sound("tv")] }), "tv").sound.action).toEqual({ type: "output", deviceId: "tv", level: 0 });
    expect(row(session({ outputs: [picture("tv")] }), "tv").picture.action).toEqual({ type: "output", deviceId: "tv", picture: false });
    // Radio: the picture it chose shows nothing, so Sound is its last channel and takes both out.
    expect(row(session({ outputs: [both("tv")], film: { audioOnly: true } }), "tv").sound.action).toEqual({ type: "output", deviceId: "tv", picture: false, level: 0 });
  });

  test("can't take out another device's private channel, but its owner can", () => {
    const devices = [device(here, { sharing: { audio: false, video: false } }), device("phone", { sharing: { audio: true, video: false } })];
    expect(row(session({ devices, outputs: [both("phone", { local: true })] }), "phone")).toMatchObject({ picture: { enabled: false, reason: "Private" }, sound: { enabled: true } });
    expect(row(session({ devices, outputs: [sound("phone", { local: true })] }), "phone").sound.enabled).toBe(true);
    expect(row(session({ devices, outputs: [both(here, { local: true })] }), here)).toMatchObject({ picture: { enabled: true }, sound: { enabled: true } });
  });

  test("a device busy elsewhere moves here, unless its output there is private", () => {
    expect(row(session({ others: [radio([sound("kitchen")])] }), "kitchen").sound.enabled).toBe(true);
    const state = session({ devices: [device("phone", { sharing: { audio: true, video: false } })], others: [{ id: "own", title: "Own", status: "playing", outputs: [both("phone", { local: true })] }] });
    expect(row(state, "phone")).toMatchObject({ status: "Private", sound: { enabled: false, reason: "Private" } });
  });

  test("a held publisher's private output counts as its place in that playback", () => {
    const state = session({ devices: [device("phone", { sharing: { audio: true, video: false } })], others: [{ id: "src", title: "Screen", status: "playing", outputs: [], held: both("phone", { local: true }) }] });
    expect(row(state, "phone")).toMatchObject({ status: "Private", sound: { enabled: false, reason: "Private" } });
  });

  test("a shared source's publisher never plays it", () => {
    const state = session({ devices: [device("mac"), device("tv")], outputs: [both("tv")], film: { liveSourceId: "s" }, liveSources: [screen] });
    expect(row(state, "mac")).toMatchObject({ status: "Sharing this source", sound: { enabled: false }, level: { enabled: false }, picture: { enabled: false }, move: { enabled: false } });
  });

  test("a channel only the host can play locks every device that isn't its output", () => {
    const state = session({ outputs: [both("tv")], film: { hostOnly: true } });
    expect(row(state, "kitchen")).toMatchObject({ status: "Can't play this channel", picture: { enabled: false }, sound: { enabled: false }, move: { enabled: false } });
    expect(row(state, "tv")).toMatchObject({ sound: { enabled: true }, level: { enabled: true } });
  });
});

describe("exceptions", () => {
  test("Muted while its sound plays here muted", () => {
    const status = (output: Output, extra: Partial<DeviceSummary> = {}) => row(session({ devices: [device("tv", extra)], outputs: [output] }), "tv").status;
    expect(status(sound("tv"), { muted: true })).toBe("Muted");
    expect(status(picture("tv"), { muted: true })).toBe("");
    expect(status(both("tv"))).toBe("");
  });

  test("turning on a muted device's Sound or raising its fader unmutes it; anything else leaves Mute as it is", () => {
    const muted = row(session({ devices: [device("tv", { muted: true })], outputs: [picture("tv")] }), "tv");
    const unmute = { type: "mute", deviceId: "tv", muted: false };
    expect(soundActions(muted, muted.sound.action)).toEqual([muted.sound.action, unmute]);
    expect(soundActions(muted, { type: "output", deviceId: "tv", level: 30 })).toEqual([{ type: "output", deviceId: "tv", level: 30 }, unmute]);
    expect(soundActions(muted, { type: "output", deviceId: "tv", level: 0 })).toEqual([{ type: "output", deviceId: "tv", level: 0 }]);
    expect(soundActions(muted, muted.picture.action)).toEqual([muted.picture.action]);
    const heard = row(session({ outputs: [picture("tv")] }), "tv");
    expect(soundActions(heard, heard.sound.action)).toEqual([heard.sound.action]);
  });

  test("Behind for a buffered receiver; Can't play with Core's reason, in red, when its stream failed", () => {
    const live = (output: Output) => row(session({ outputs: [output], film: { liveSourceId: "s" }, liveSources: [screen] }), "tv");
    expect(live(both("tv", { buffered: true }))).toMatchObject({ status: "Behind", failed: false });
    for (const buffered of [true, undefined]) expect(live(both("tv", { buffered, error: "The encoder stopped." }))).toMatchObject({ status: "Can't play: The encoder stopped.", failed: true });
    expect(picker(session({ outputs: [both("tv", { buffered: true })], film: { liveSourceId: "s" }, liveSources: [screen] }), { here: "tv" }).rows[0]!.status).toBe("This device · Behind");
  });

  test("a device busy elsewhere names what it plays there before you move it", () => {
    expect(row(session({ others: [{ ...radio([sound("kitchen")]), status: "playing" }] }), "kitchen").status).toBe("Playing avoid radio");
    expect(row(session({ others: [{ ...radio([sound("kitchen")]), status: "playing", title: null }] }), "kitchen").status).toBe("Playing something else");
    expect(row(session({ others: [{ ...radio([sound("kitchen")]), status: "idle" }] }), "kitchen").status).toBe("");
  });

  test("this device says so", () => {
    expect(row(session(), here).status).toBe("This device");
    expect(row(session({ devices: [device(here), device("mac")], film: { liveSourceId: "s" }, liveSources: [{ ...screen, deviceId: here }] }), here).status).toBe("This device · Sharing this source");
  });

  test("rows name only devices, never the Couch, a playback or a group", () => {
    const state = session({ installationName: "Couch", outputs: [both("tv")], film: { hostOnly: true }, others: [radio([sound("kitchen")])] });
    expect(JSON.stringify(picker(state, { here }))).not.toMatch(/\b(Couch|zone|group|room|speaker|Playback|House|Listeners)\b/i);
  });
});

describe("consent", () => {
  const foreign = (sharing: DeviceSummary["sharing"]) => [device(here, { sharing: { audio: false, video: false } }), device("phone", { sharing })];

  test("another device's private picture disables Picture for others, and its shared sound stays operable", () => {
    const state = session({ devices: foreign({ audio: true, video: false }), outputs: [both("phone", { local: true })] });
    expect(row(state, "phone")).toMatchObject({ picture: { enabled: false, reason: "Private" }, sound: { enabled: true }, level: { enabled: true } });
  });

  test("a private sound disables Sound and the fader for others", () => {
    const state = session({ devices: foreign({ audio: false, video: true }), outputs: [both("phone", { local: true })] });
    expect(row(state, "phone")).toMatchObject({ picture: { enabled: true }, sound: { enabled: false }, level: { enabled: false, reason: "Private" } });
  });

  test("a device playing privately in another playback can't be moved here", () => {
    const state = session({ devices: foreign({ audio: true, video: false }), others: [{ id: "own", title: "Own", status: "playing", outputs: [both("phone", { local: true })] }] });
    expect(row(state, "phone")).toMatchObject({ picture: { enabled: false }, sound: { enabled: false }, level: { enabled: false, reason: "Private" }, move: { enabled: false } });
  });

  test("this device keeps its own controls while viewing another playback, its private output included", () => {
    const own = session({ devices: [device(here, { sharing: { audio: false, video: false } }), device("tv")], outputs: [both("tv")], others: [{ id: "mine", title: "Mine", status: "playing", outputs: [both(here, { local: true })] }] });
    expect(row(own, here)).toMatchObject({ mine: true, status: "This device · Playing Mine", picture: { enabled: true }, sound: { enabled: true }, move: { enabled: true } });
  });

  test("a device that doesn't share its speakers offers others no fader, and one without a shared screen offers no Picture", () => {
    const state = session({ devices: [device(here), device("phone", { sharing: { audio: false, video: true } }), device("speaker", { sharing: { audio: true, video: false } })] });
    expect(row(state, "phone")).toMatchObject({ level: { enabled: false }, picture: { enabled: true } });
    expect(row(state, "speaker")).toMatchObject({ level: { enabled: true }, picture: { enabled: false, reason: "Private" } });
  });
});

describe("fader and Sync", () => {
  test("the fader is the device's volume while its sound is in, else 0", () => {
    const state = session({ devices: [device("tv", { volume: 40 }), device("kitchen", { volume: 70 })], outputs: [both("tv"), picture("kitchen")] });
    expect(row(state, "tv").level).toEqual({ value: 40, sound: true, enabled: true });
    expect(row(state, "kitchen").level).toEqual({ value: 0, sound: false, enabled: true });
  });

  test("Sync shows only while the device's sound plays in sync with others, Lip sync while another shows the picture", () => {
    expect(row(session({ outputs: [sound("tv", { delay: 80, delayActive: true }), sound("kitchen")] }), "tv").sync).toEqual({ delay: 80, lip: false });
    expect(row(session({ outputs: [sound("tv", { delay: 80, delayActive: true }), both("kitchen")] }), "tv").sync).toEqual({ delay: 80, lip: true });
    expect(row(session({ outputs: [both("tv", { delay: 80 })] }), "tv").sync).toBeUndefined();
    expect(row(session({ outputs: [picture("tv", { delayActive: true })] }), "tv").sync).toBeUndefined();
  });
});

describe("Move here", () => {
  test("is offered for any device, but not for the only output, where it would change nothing", () => {
    expect(row(session({ outputs: [both("tv")] }), "tv").move).toBeUndefined();
    expect(row(session({ outputs: [both("tv"), sound("kitchen")] }), "tv").move).toEqual({ enabled: true });
    expect(row(session(), "tv").move).toEqual({ enabled: true });
    expect(row(session({ outputs: [both("tv")] }), "kitchen").move).toEqual({ enabled: true });
  });

  test("stays offered for the only output while a held publisher would return after its source", () => {
    const state = session({ devices: [device(here), device("tv"), device("mac")], outputs: [both("tv")], film: { liveSourceId: "s", held: both("mac") }, liveSources: [screen] });
    expect(row(state, "tv").move).toEqual({ enabled: true });
  });

  test("is unavailable everywhere while another device's private output plays in it", () => {
    const state = session({ devices: [device(here), device("tv"), device("phone", { sharing: { audio: false, video: false } })], outputs: [both("tv"), both("phone", { local: true })] });
    expect(rows(state).map(item => [item.device.id, item.move?.enabled, item.move?.reason])).toEqual([["tv", false, "Private"], ["phone", false, "Private"], [here, false, "Private"]]);
  });

  test("is unavailable while a publisher's private output waits to return after its source", () => {
    const state = session({ devices: [device(here), device("tv"), device("mac", { sharing: { audio: false, video: false } })], outputs: [both("tv")], film: { liveSourceId: "s", held: both("mac", { local: true }) }, liveSources: [screen] });
    expect(row(state, "tv").move?.enabled).toBe(false);
  });

  test("this device's own private output blocks nobody, since it may leave", () => {
    const state = session({ devices: [device(here, { sharing: { audio: false, video: false } }), device("tv")], outputs: [both("tv"), both(here, { local: true })] });
    expect(row(state, "tv").move?.enabled).toBe(true);
    expect(row(state, here).move?.enabled).toBe(true);
  });

  test("needs a channel the media can use", () => {
    const state = session({ devices: [device("screen", { sharing: { audio: false, video: true } })], film: { audioOnly: true } });
    expect(row(state, "screen").move?.enabled).toBe(false);
  });
});

describe("the panel", () => {
  const many = (count: number, extra: (index: number) => Partial<DeviceSummary> = () => ({})) => Array.from({ length: count }, (_, index) => device(`d${index}`, extra(index)));

  test("counts picture, sound, in sync, behind, can't play and offline, leaving out zeros", () => {
    const state = session({ devices: [...many(3), device("away", { online: false })], outputs: [both("d0", { delayActive: true }), sound("d1", { buffered: true }), picture("d2", { error: "Gone" })] });
    expect(counts(rows(state)).map(item => `${item.label} ${item.count}`)).toEqual(["Picture 2", "Sound 2", "In sync 1", "Behind 1", "Can't play 1", "Offline 1"]);
    expect(counts(rows(session({ devices: many(2) })))).toEqual([]);
  });

  test("lists the playback's devices, then the rest, and folds offline devices out of it into one line", () => {
    const state = session({ devices: [device("tv"), device("away", { online: false }), device("gone", { online: false }), device("kitchen")], outputs: [both("kitchen"), both("gone")] });
    const { playing, rest, offline } = arrange(rows(state));
    expect([playing.map(item => item.device.id), rest.map(item => item.device.id), offline.map(item => item.device.id)]).toEqual([["gone", "kitchen"], ["tv"], ["away"]]);
  });

  test("keeps the order it opened with while it is open, new devices appended", () => {
    const opened = orderOf(rows(session({ devices: [device("tv"), device("kitchen")], outputs: [both("tv")] })));
    // The TV leaves and the kitchen joins; a new device arrives. Nothing jumps.
    const later = rows(session({ devices: [device("tv"), device("kitchen"), device("garden")], outputs: [both("kitchen")] }));
    const { playing, rest } = arrange(later, opened);
    expect([playing.map(item => item.device.id), rest.map(item => item.device.id)]).toEqual([["tv"], ["kitchen", "garden"]]);
    // Opened again, it sorts afresh.
    expect(arrange(later).playing.map(item => item.device.id)).toEqual(["kitchen"]);
  });

  test("filters by a count and by name without reordering", () => {
    const state = session({ devices: many(12), outputs: [sound("d5"), both("d3"), sound("d9")] });
    const listed = arrange(rows(state));
    expect(listed.listed).toBe(12);
    expect(listed.listed > crowded).toBe(true);
    expect(arrange(rows(state), undefined, "sound").playing.map(item => item.device.id)).toEqual(["d3", "d5", "d9"]);
    expect(arrange(rows(state), undefined, "picture").playing.map(item => item.device.id)).toEqual(["d3"]);
    expect(arrange(rows(state), undefined, null, "D1").rest.map(item => item.device.id)).toEqual(["d1", "d10", "d11"]);
  });
});

describe("live inputs", () => {
  const live = (outputs: Output[], film: Partial<PlaybackSummary> = {}, source = screen) => session({ devices: [device("mac"), device("tv"), device("kitchen")], outputs, film: { liveSourceId: "s", ...film }, liveSources: [source] });

  test("In sync applies once the source plays on several devices, and while it is on", () => {
    expect(picker(live([both("tv")]), { here }).inSync).toBeUndefined();
    expect(picker(live([both("tv"), sound("kitchen")]), { here }).inSync).toBe(false);
    expect(picker(live([both("tv")], { inSync: true }), { here }).inSync).toBe(true);
    expect(picker(session({ outputs: [both("tv"), sound("kitchen")] }), { here }).inSync).toBeUndefined();
  });

  test("a source without sound offers Picture, and its Sound and faders say it has no sound", () => {
    const silent = live([picture("tv")], {}, { ...screen, audio: false });
    expect(row(silent, "tv")).toMatchObject({ sound: { enabled: false, reason: "No sound" }, level: { enabled: false, reason: "No sound" }, picture: { enabled: true } });
  });

  test("a source without sound plays none on a device that chose sound, and its Picture, the last channel it plays, still takes the sound out", () => {
    const silent = live([both("tv"), sound("kitchen")], {}, { ...screen, audio: false });
    expect(row(silent, "tv")).toMatchObject({ level: { value: 0, sound: false, enabled: false, reason: "No sound" }, picture: { on: true, action: { type: "output", deviceId: "tv", picture: false, level: 0 } } });
    expect(row(silent, "kitchen")).toMatchObject({ picture: { on: false }, sound: { on: false } });
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

describe("band volume", () => {
  test("Mute reads muted while every device in the playback's sound is muted, else the controlled device", () => {
    const devices = [device("tv", { muted: true }), device("kitchen", { muted: false })];
    expect(muted(session({ devices, outputs: [sound("tv"), sound("kitchen")] }))).toBe(false);
    expect(muted(session({ devices: devices.map(item => ({ ...item, muted: true })), outputs: [sound("tv"), picture("kitchen")] }))).toBe(true);
    expect(muted(session({ devices, outputs: [], controlling: "tv" }))).toBe(true);
  });

  test("Mute reads only the sound this device may control, as Core's Volume does, while there is any", () => {
    const phone = device("phone", { sharing: { audio: false, video: true } });
    expect(muted(session({ devices: [device("tv", { muted: true }), phone], outputs: [sound("tv"), sound("phone")] }))).toBe(true);
    expect(muted(session({ devices: [{ ...phone, muted: true }], outputs: [both("phone")] }))).toBe(true);
  });
});

describe("Play on", () => {
  test("offers this device first, then the other online devices that share, and nothing while this is the only one", () => {
    const state = session({ devices: [device("tv"), device("phone", { sharing: { audio: false, video: false } }), device("kitchen", { online: false }), device(here, { sharing: { audio: false, video: false } })] });
    expect(playOnTargets(state, here).map(item => item.id)).toEqual([here, "tv"]);
    expect(playOnTargets(session({ devices: [device(here)] }), here)).toEqual([]);
  });

  test("a play that lands on another device says Playing on its name", () => {
    const state = session();
    expect(playingOn(state, "tv", here)).toBe("Tv");
    expect(playingOn(state, here, here)).toBeUndefined();
    expect(playingOn(state, undefined, here)).toBeUndefined();
  });

  test("the bar says on {name} +N whenever the playback plays anywhere but only here", () => {
    const at = (outputs: Output[], controlling?: string, status = "playing") => playsOn({ outputs, controlling, devices: [device("tv"), device("kitchen")], player: { status } } as never);
    expect(at([sound("kitchen"), both("tv")], "kitchen")).toMatchObject({ name: "Kitchen", more: 1, elsewhere: true });
    expect(at([sound("kitchen"), both("tv")], "elsewhere")).toMatchObject({ name: "Tv", more: 1 });
    expect(at([both("tv")], undefined, "idle")?.elsewhere).toBe(false);
    expect(at([])).toBeNull();
  });
});
