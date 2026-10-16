import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { DeviceIcon, signalOf, type Signal } from "../src/client/components/DeviceIcon";
import { muted } from "../src/client/components/PlaybackTransport";
import { playsOn } from "../src/client/session/device-id";
import type { ClientSessionState } from "../src/client/session/session";
import { chooserFor, chooserRequest, picker, playingOn, playOnTargets, reopens } from "../src/client/session/where-it-plays";
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
const rows = (state: ClientSessionState, tv = false) => picker(state, { here, tv }).rows;
const row = (state: ClientSessionState, id: string) => rows(state).find(item => item.device.id === id)!;
const radio = (outputs: Output[]): PlaybackSummary => ({ id: "radio", title: "avoid radio", status: "paused", outputs, audioOnly: true });
const screen = { id: "s", deviceId: "mac", name: "Mac · Screen", kind: "screen", audio: true, video: true } as const;

describe("the picker's header", () => {
  test("shows what plays and its status, or asks you to choose for a waiting source", () => {
    expect(picker(session(), { here })).toMatchObject({ title: "Montalbano", status: "Playing" });
    expect(picker(session({ film: { status: "idle" } }), { here }).status).toBe("Not playing");
    expect(picker(session({ currentEntryId: null }), { here }).title).toBeUndefined();
    expect(picker(session({ film: { liveSourceId: "s", status: "paused" }, liveSources: [screen] }), { here }).status).toBe("Choose where it plays");
  });

  test("has one hint line, and only on the TV, where it says how faders take the arrows", () => {
    expect(picker(session(), { here }).hint).toBeUndefined();
    expect(picker(session(), { here, tv: true }).hint).toBe("Press OK to adjust a level, then OK or Back to finish.");
  });
});

describe("device rows", () => {
  test("lists every device once: the playback's first, then the others, offline ones last", () => {
    const state = session({ outputs: [sound("kitchen")], devices: [device("away", { online: false }), device(here, { sharing: { audio: false, video: false } }), device("phone", { sharing: { audio: false, video: false } }), device("kitchen")] });
    expect(rows(state).map(item => item.device.id)).toEqual(["kitchen", here, "phone", "away"]);
  });

  test("a device you can't change stays listed, its check disabled with a one-word status", () => {
    const state = session({ devices: [device("phone", { sharing: { audio: false, video: false } }), device("away", { online: false })] });
    expect(row(state, "phone")).toMatchObject({ status: "Private", check: { enabled: false, reason: "Private" } });
    expect(row(state, "away")).toMatchObject({ status: "Offline", check: { enabled: false, reason: "Offline" } });
  });

  test("an offline output keeps its check, disabled, and every control", () => {
    const state = session({ devices: [device("tv", { online: false })], outputs: [both("tv")] });
    expect(row(state, "tv")).toMatchObject({ status: "Offline", check: { enabled: false }, picture: { enabled: false, reason: "Offline" }, level: { enabled: false }, mute: { enabled: false }, only: { enabled: false } });
  });

  test("a row's picture is pressed while it shows the playback's picture, never for media without one", () => {
    expect(row(session({ outputs: [both("tv")] }), "tv").picture.on).toBe(true);
    expect(row(session({ outputs: [sound("tv")] }), "tv").picture.on).toBe(false);
    expect(row(session({ outputs: [both("tv")], film: { audioOnly: true } }), "tv").picture).toEqual({ on: false, enabled: false, reason: "No picture" });
  });
});

describe("the check", () => {
  test("adds a device with picture and sound, at its own level", () => {
    expect(row(session({ devices: [device("tv", { volume: 40 })] }), "tv").check).toEqual({ enabled: true, action: { type: "output", deviceId: "tv", picture: true, level: 40 } });
  });

  test("adds sound at 50 when the device's level is 0, since 0 would leave it out", () => {
    expect(row(session({ devices: [device("tv", { volume: 0 })] }), "tv").check.action).toMatchObject({ level: 50 });
  });

  test("adds only what the device shares and the media has", () => {
    const devices = [device("speaker", { sharing: { audio: true, video: false } }), device("screen", { sharing: { audio: false, video: true } }), device("tv")];
    expect(row(session({ devices }), "speaker").check.action).toEqual({ type: "output", deviceId: "speaker", level: 50 });
    expect(row(session({ devices }), "screen").check.action).toEqual({ type: "output", deviceId: "screen", picture: true });
    expect(row(session({ devices, film: { audioOnly: true } }), "tv").check.action).toEqual({ type: "output", deviceId: "tv", level: 50 });
    expect(row(session({ devices, film: { audioOnly: true } }), "screen").check).toEqual({ enabled: false, reason: "Private", action: undefined });
    const silent = session({ devices: [device("mac"), ...devices], film: { liveSourceId: "s" }, liveSources: [{ ...screen, audio: false }] });
    expect(row(silent, "tv").check.action).toEqual({ type: "output", deviceId: "tv", picture: true });
  });

  test("this device adds itself without sharing anything", () => {
    expect(row(session(), here).check.action).toEqual({ type: "output", deviceId: here, picture: true, level: 50 });
  });

  test("removes a device by taking out each channel it plays here", () => {
    expect(row(session({ outputs: [both("tv")] }), "tv").check.action).toEqual({ type: "output", deviceId: "tv", picture: false, level: 0 });
    expect(row(session({ outputs: [sound("tv")] }), "tv").check.action).toEqual({ type: "output", deviceId: "tv", level: 0 });
    expect(row(session({ outputs: [picture("tv")] }), "tv").check.action).toEqual({ type: "output", deviceId: "tv", picture: false });
  });

  test("can't take out another device's private channel, but its owner can", () => {
    const devices = [device(here, { sharing: { audio: false, video: false } }), device("phone", { sharing: { audio: true, video: false } })];
    expect(row(session({ devices, outputs: [both("phone", { local: true })] }), "phone")).toMatchObject({ status: "Private", check: { enabled: false, reason: "Private" } });
    expect(row(session({ devices, outputs: [sound("phone", { local: true })] }), "phone").check.enabled).toBe(true);
    expect(row(session({ devices, outputs: [both(here, { local: true })] }), here).check.enabled).toBe(true);
  });

  test("a device busy elsewhere moves here, unless its output there is private", () => {
    expect(row(session({ others: [radio([sound("kitchen")])] }), "kitchen").check.enabled).toBe(true);
    const state = session({ devices: [device("phone", { sharing: { audio: true, video: false } })], others: [{ id: "own", title: "Own", status: "playing", outputs: [both("phone", { local: true })] }] });
    expect(row(state, "phone")).toMatchObject({ status: "Private", check: { enabled: false, reason: "Private" } });
  });

  test("a held publisher's private output counts as its place in that playback", () => {
    const state = session({ devices: [device("phone", { sharing: { audio: true, video: false } })], others: [{ id: "src", title: "Screen", status: "playing", outputs: [], held: both("phone", { local: true }) }] });
    expect(row(state, "phone")).toMatchObject({ status: "Private", check: { enabled: false, reason: "Private" } });
  });

  test("a shared source's publisher never plays it", () => {
    const state = session({ devices: [device("mac"), device("tv")], outputs: [both("tv")], film: { liveSourceId: "s" }, liveSources: [screen] });
    expect(row(state, "mac")).toMatchObject({ status: "Sharing this source", check: { enabled: false, reason: "Sharing this source" }, level: { enabled: false }, picture: { enabled: false }, only: { enabled: false } });
  });

  test("a channel only the host can play locks every device that isn't its output", () => {
    const state = session({ outputs: [both("tv")], film: { hostOnly: true } });
    expect(row(state, "kitchen")).toMatchObject({ status: "Can't play this channel", check: { enabled: false }, picture: { enabled: false }, level: { enabled: false }, mute: { enabled: false }, only: { enabled: false } });
    expect(row(state, "tv")).toMatchObject({ check: { enabled: true }, level: { enabled: true } });
  });
});

describe("what a device is doing", () => {
  test("an output says what it plays here, Mute included, never whether it can be heard", () => {
    const status = (output: Output, extra: Partial<DeviceSummary> = {}, film: Partial<PlaybackSummary> = {}) => row(session({ devices: [device("tv", extra)], outputs: [output], film }), "tv").status;
    expect(status(both("tv"))).toBe("Picture and sound");
    expect(status(sound("tv"))).toBe("Sound");
    expect(status(picture("tv"))).toBe("Picture");
    expect(status(sound("tv"), { muted: true })).toBe("Muted");
    expect(status(both("tv"), { muted: true })).toBe("Picture, muted");
    expect(status(both("tv"), {}, { audioOnly: true })).toBe("Sound");
    expect(status(picture("tv"), {}, { audioOnly: true })).toBe("No picture");
    expect(status(both("tv"), { volume: 0 })).toBe("Picture and sound");
  });

  test("a live input's receiver says when it plays buffered, or can't play", () => {
    const status = (output: Output) => row(session({ outputs: [output] }), "tv").status;
    expect(status(both("tv", { buffered: true }))).toBe("Buffered");
    expect(status(both("tv", { error: "stopped" }))).toBe("Can't play");
  });

  test("a device busy elsewhere names what it plays there before you press", () => {
    expect(row(session({ others: [radio([sound("kitchen")])] }), "kitchen").status).toBe("Paused avoid radio");
    expect(row(session({ others: [{ ...radio([sound("kitchen")]), status: "playing", title: null }] }), "kitchen").status).toBe("Playing something else");
    expect(row(session({ others: [{ ...radio([sound("kitchen")]), status: "idle" }] }), "kitchen").status).toBe("Not playing");
  });

  test("a free device is not playing", () => {
    expect(row(session(), "tv").status).toBe("Not playing");
  });

  test("this device's status starts with This device", () => {
    expect(row(session(), here).status).toBe("This device · Not playing");
    expect(row(session({ outputs: [sound(here)] }), here).status).toBe("This device · Sound");
    expect(row(session({ devices: [device(here), device("mac")], film: { liveSourceId: "s" }, liveSources: [{ ...screen, deviceId: here }] }), here).status).toBe("This device · Sharing this source");
  });

  test("rows name only devices, never the Couch, a playback or a group", () => {
    const state = session({ installationName: "Couch", outputs: [both("tv")], film: { hostOnly: true }, others: [radio([sound("kitchen")])] });
    const text = picker(state, { here, tv: true });
    expect(JSON.stringify(text)).not.toMatch(/\b(Couch|zone|group|room|speaker|Playback)\b/i);
  });
});

describe("consent", () => {
  const foreign = (sharing: DeviceSummary["sharing"]) => [device(here, { sharing: { audio: false, video: false } }), device("phone", { sharing })];

  test("another device's private picture disables Picture for others, and its shared sound stays operable and mutable", () => {
    const state = session({ devices: foreign({ audio: true, video: false }), outputs: [both("phone", { local: true })] });
    expect(row(state, "phone")).toMatchObject({ picture: { enabled: false, reason: "Private" }, level: { enabled: true }, mute: { enabled: true } });
  });

  test("a private sound disables the fader and Mute for others", () => {
    const state = session({ devices: foreign({ audio: false, video: true }), outputs: [both("phone", { local: true })] });
    expect(row(state, "phone")).toMatchObject({ picture: { enabled: true }, level: { enabled: false, reason: "Private" }, mute: { enabled: false, reason: "Private" } });
  });

  test("a device playing privately in another playback can't be moved here, but its shared sound can still be muted", () => {
    const state = session({ devices: foreign({ audio: true, video: false }), others: [{ id: "own", title: "Own", status: "playing", outputs: [both("phone", { local: true })] }] });
    expect(row(state, "phone")).toMatchObject({ picture: { enabled: false }, level: { enabled: false, reason: "Private" }, mute: { enabled: true }, only: { enabled: false } });
  });

  test("this device keeps its own controls while viewing another playback, its private output included", () => {
    const own = session({ devices: [device(here, { sharing: { audio: false, video: false } }), device("tv")], outputs: [both("tv")], others: [{ id: "mine", title: "Mine", status: "playing", outputs: [both(here, { local: true })] }] });
    expect(row(own, here)).toMatchObject({ mine: true, status: "This device · Playing Mine", check: { enabled: true }, picture: { enabled: true }, level: { enabled: true }, mute: { enabled: true }, only: { enabled: true } });
  });

  test("a device that doesn't share its speakers can't be muted by others, and one without a shared screen offers no Picture", () => {
    const state = session({ devices: [device(here), device("phone", { sharing: { audio: false, video: true } }), device("speaker", { sharing: { audio: true, video: false } })] });
    expect(row(state, "phone")).toMatchObject({ mute: { enabled: false }, level: { enabled: false }, picture: { enabled: true } });
    expect(row(state, "speaker")).toMatchObject({ mute: { enabled: true }, level: { enabled: true }, picture: { enabled: false, reason: "Private" } });
  });
});

describe("fader and Sync", () => {
  test("the fader is the device's volume while its sound is in, else 0", () => {
    const state = session({ devices: [device("tv", { volume: 40 }), device("kitchen", { volume: 70 })], outputs: [both("tv"), picture("kitchen")] });
    expect(row(state, "tv").level).toEqual({ value: 40, sound: true, enabled: true });
    expect(row(state, "kitchen").level).toEqual({ value: 0, sound: false, enabled: true });
  });

  test("Sync shows only while the device's sound plays in sync with others", () => {
    expect(row(session({ outputs: [both("tv", { delay: 80, delayActive: true }), sound("kitchen")] }), "tv").sync).toEqual({ delay: 80 });
    expect(row(session({ outputs: [both("tv", { delay: 80 })] }), "tv").sync).toBeUndefined();
    expect(row(session({ outputs: [picture("tv", { delayActive: true })] }), "tv").sync).toBeUndefined();
  });
});

describe("Only here", () => {
  test("is pressed while the device is the only output", () => {
    expect(row(session({ outputs: [both("tv")] }), "tv").only.on).toBe(true);
    expect(row(session({ outputs: [both("tv"), sound("kitchen")] }), "tv").only.on).toBe(false);
    expect(row(session(), "tv").only.on).toBe(false);
  });

  test("is unavailable everywhere while another device's private output plays in it", () => {
    const state = session({ devices: [device(here), device("tv"), device("phone", { sharing: { audio: false, video: false } })], outputs: [both("tv"), both("phone", { local: true })] });
    expect(rows(state).map(item => [item.device.id, item.only.enabled, item.only.reason])).toEqual([["tv", false, "Private"], ["phone", false, "Private"], [here, false, "Private"]]);
  });

  test("is unavailable while a publisher's private output waits to return after its source", () => {
    const state = session({ devices: [device(here), device("tv"), device("mac", { sharing: { audio: false, video: false } })], outputs: [both("tv")], film: { liveSourceId: "s", held: both("mac", { local: true }) }, liveSources: [screen] });
    expect(row(state, "tv").only.enabled).toBe(false);
  });

  test("this device's own private output blocks nobody, since it may leave", () => {
    const state = session({ devices: [device(here, { sharing: { audio: false, video: false } }), device("tv")], outputs: [both("tv"), both(here, { local: true })] });
    expect(row(state, "tv").only.enabled).toBe(true);
    expect(row(state, here).only.enabled).toBe(true);
  });

  test("needs a channel the media can use", () => {
    const state = session({ devices: [device("screen", { sharing: { audio: false, video: true } })], film: { audioOnly: true } });
    expect(row(state, "screen").only.enabled).toBe(false);
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

  test("a source without sound offers Picture, and its faders and Mute say it has no sound", () => {
    const silent = live([picture("tv")], {}, { ...screen, audio: false });
    expect(row(silent, "tv")).toMatchObject({ level: { enabled: false, reason: "No sound" }, mute: { enabled: false, reason: "No sound" }, picture: { enabled: true } });
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

describe("DeviceIcon", () => {
  const icon = (signal: Partial<Signal>) => renderToStaticMarkup(DeviceIcon({ picture: false, sound: false, volume: 50, muted: false, online: true, ...signal }));
  test("shows picture and sound, picture, or sound by its volume, crossed out while muted", () => {
    expect(icon({ picture: true, sound: true })).toContain("lucide-monitor-speaker");
    expect(icon({ picture: true })).toContain("lucide-monitor ");
    expect(icon({ sound: true, volume: 0 })).toContain("lucide-volume ");
    expect(icon({ sound: true, volume: 50 })).toContain("lucide-volume1");
    expect(icon({ sound: true, volume: 51 })).toContain("lucide-volume2");
    expect(icon({ sound: true, picture: true, muted: true })).toContain("lucide-volume-x");
  });

  test("an idle device is a plain muted screen, dimmer still offline, and always hidden from assistive tech", () => {
    expect(icon({})).toMatch(/lucide-monitor .*text-muted-foreground/);
    expect(icon({ online: false, picture: true })).toContain("opacity-50");
    expect(icon({})).toContain('aria-hidden="true"');
  });

  test("reads a device's output in whichever playback it serves, with no picture for media that has none", () => {
    const state = session({ devices: [device("kitchen", { volume: 30, muted: true })], others: [radio([both("kitchen")])] });
    expect(signalOf(state, "kitchen")).toEqual({ picture: false, sound: true, volume: 30, muted: true, online: true });
    expect(signalOf(session({ outputs: [both("tv")] }), "tv")).toMatchObject({ picture: true, sound: true });
  });
});
