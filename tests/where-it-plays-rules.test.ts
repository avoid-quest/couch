import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { DeviceIcon, signalOf, type Signal } from "../src/client/components/DeviceIcon";
import { muted } from "../src/client/components/PlaybackTransport";
import { playsOn } from "../src/client/session/device-id";
import type { ClientSessionState } from "../src/client/session/session";
import { chooserFor, chooserRequest, outputStatus, picker, playingOn, playOnTargets, reopens } from "../src/client/session/where-it-plays";
import type { DeviceSummary, Output, PlaybackSummary } from "../src/shared/protocol";

// One rule per test, in the order of docs/design/where-it-plays.md. "here" is this device; every other device
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

describe("the Sheet", () => {
  test("its title is what plays, or says nothing is playing", () => {
    expect(picker(session(), { here }).title).toBe("Montalbano");
    expect(picker(session({ currentEntryId: null }), { here }).title).toBeUndefined();
  });
});

describe("device rows", () => {
  test("the playback's devices come first, then this device and the other online devices that share", () => {
    const state = session({ outputs: [sound("kitchen")], devices: [device(here, { sharing: { audio: false, video: false } }), device("tv"), device("kitchen")] });
    expect(rows(state).map(item => item.device.id)).toEqual(["kitchen", here, "tv"]);
  });

  test("this device is listed even when it shares neither, so it can add itself", () => {
    const state = session({ devices: [device(here, { sharing: { audio: false, video: false } })] });
    expect(rows(state).map(item => item.device.id)).toEqual([here]);
    expect(row(state, here)).toMatchObject({ picture: { enabled: true }, level: { enabled: true } });
  });

  test("another device that shares neither is listed only while it is an output", () => {
    const quiet = device("phone", { sharing: { audio: false, video: false } });
    expect(rows(session({ devices: [quiet] })).length).toBe(0);
    expect(rows(session({ devices: [quiet], outputs: [both("phone", { local: true })] })).map(item => item.device.id)).toEqual(["phone"]);
  });

  test("an offline device is listed only while it is an output, dimmed with its controls disabled", () => {
    expect(rows(session({ devices: [device("tv", { online: false })] })).length).toBe(0);
    const state = session({ devices: [device("tv", { online: false })], outputs: [both("tv")] });
    expect(row(state, "tv")).toMatchObject({ status: "Offline", picture: { enabled: false }, level: { enabled: false }, mute: { enabled: false }, only: { enabled: false } });
  });

  test("a shared source's publisher is listed, even when it shares neither", () => {
    const state = session({ devices: [device("mac", { sharing: { audio: false, video: false } }), device("tv")], outputs: [both("tv")], film: { liveSourceId: "s" }, liveSources: [screen] });
    expect(rows(state).map(item => item.device.id)).toEqual(["tv", "mac"]);
  });

  test("a row's picture is pressed while it shows the playback's picture, never for media without one", () => {
    expect(row(session({ outputs: [both("tv")] }), "tv").picture.on).toBe(true);
    expect(row(session({ outputs: [sound("tv")] }), "tv").picture.on).toBe(false);
    expect(row(session({ outputs: [both("tv")], film: { audioOnly: true } }), "tv").picture).toEqual({ on: false, enabled: false });
  });
});

describe("what a device is doing", () => {
  test("a joined output keeps the current playback's factual status", () => {
    for (const [status, text] of [["playing", "Playing"], ["paused", "Paused"], ["loading", "Loading"], ["ended", "Finished"], ["error", "Can't play"], ["idle", "Not playing here"], ["unavailable", "Unavailable"]] as const) {
      expect(row(session({ outputs: [both("tv")], film: { status } }), "tv").status).toBe(text);
    }
  });

  test("a device busy elsewhere names that playback before a move", () => {
    const state = session({ others: [radio([sound("kitchen")])] });
    expect(row(state, "kitchen").status).toBe("Paused avoid radio");
    expect(outputStatus(session({ others: [{ ...radio([sound("kitchen")]), title: null }] }), device("kitchen"), "film")).toBe("Paused something else");
  });

  test("an unused device is not playing here, and an offline one says so first", () => {
    expect(row(session(), "tv").status).toBe("Not playing here");
    expect(outputStatus(session({ outputs: [both("tv")] }), device("tv", { online: false }), "film")).toBe("Offline");
  });

  test("a shared source's publisher is sharing this source, and offers nothing that would make it receive", () => {
    const state = session({ devices: [device("mac"), device("tv")], outputs: [both("tv")], film: { liveSourceId: "s" }, liveSources: [screen] });
    expect(row(state, "mac")).toMatchObject({ capturing: true, status: "Sharing this source", picture: { enabled: false }, level: { enabled: false }, only: { enabled: false } });
    expect(row(state, "tv").capturing).toBe(false);
  });
});

describe("consent", () => {
  const foreign = (sharing: DeviceSummary["sharing"]) => [device(here, { sharing: { audio: false, video: false } }), device("phone", { sharing })];

  test("another device's private picture disables Picture for others, and its shared sound stays operable and mutable", () => {
    const state = session({ devices: foreign({ audio: true, video: false }), outputs: [both("phone", { local: true })] });
    expect(row(state, "phone")).toMatchObject({ private: "picture", picture: { enabled: false }, level: { enabled: true }, mute: { enabled: true } });
  });

  test("a private sound disables the fader and Mute for others", () => {
    const state = session({ devices: foreign({ audio: false, video: true }), outputs: [both("phone", { local: true })] });
    expect(row(state, "phone")).toMatchObject({ private: "sound", picture: { enabled: true }, level: { enabled: false }, mute: { enabled: false } });
    expect(row(session({ devices: foreign({ audio: false, video: false }), outputs: [both("phone", { local: true })] }), "phone").private).toBe("both");
  });

  test("a device playing privately in another playback can't be moved here, but its shared sound can still be muted", () => {
    const state = session({ devices: foreign({ audio: true, video: false }), others: [{ id: "own", title: "Own", status: "playing", outputs: [both("phone", { local: true })] }] });
    expect(row(state, "phone")).toMatchObject({ status: "Playing Own", private: "picture", picture: { enabled: false }, level: { enabled: false }, mute: { enabled: true }, only: { enabled: false } });
  });

  test("an unselected shared device busy elsewhere stays operable", () => {
    const state = session({ others: [radio([sound("kitchen")])] });
    expect(row(state, "kitchen")).toMatchObject({ level: { enabled: true }, picture: { enabled: true }, only: { enabled: true } });
  });

  test("a held publisher's private output counts as its place in that playback", () => {
    const state = session({ devices: foreign({ audio: true, video: false }), others: [{ id: "src", title: "Screen", status: "playing", outputs: [], held: both("phone", { local: true }) }] });
    expect(row(state, "phone")).toMatchObject({ status: "Not playing here", private: "picture", level: { enabled: false }, picture: { enabled: false } });
  });

  test("this device keeps its own controls while viewing another playback, its private output included", () => {
    const own = session({ devices: [device(here, { sharing: { audio: false, video: false } }), device("tv")], outputs: [both("tv")], others: [{ id: "mine", title: "Mine", status: "playing", outputs: [both(here, { local: true })] }] });
    expect(row(own, here)).toMatchObject({ mine: true, private: "both", picture: { enabled: true }, level: { enabled: true }, mute: { enabled: true }, only: { enabled: true } });
  });

  test("a device that doesn't share its speakers can't be muted by others, and one without a screen offers no Picture", () => {
    const state = session({ devices: [device(here), device("phone", { sharing: { audio: false, video: true } }), device("speaker", { sharing: { audio: true, video: false } })] });
    expect(row(state, "phone")).toMatchObject({ mute: { enabled: false }, level: { enabled: false }, picture: { enabled: true } });
    expect(row(state, "speaker")).toMatchObject({ mute: { enabled: true }, level: { enabled: true }, picture: { enabled: false } });
  });
});

describe("fader and Sync", () => {
  test("the fader is the device's volume while its sound is in, else 0", () => {
    const state = session({ devices: [device("tv", { volume: 40 }), device("kitchen", { volume: 70 })], outputs: [both("tv"), picture("kitchen")] });
    expect(row(state, "tv").level).toEqual({ value: 40, sound: true, enabled: true });
    expect(row(state, "kitchen").level).toEqual({ value: 0, sound: false, enabled: true });
  });

  test("Sync is adjustable only while the device plays in sync, else it shows the saved value", () => {
    expect(row(session({ outputs: [both("tv", { delay: 80, delayActive: true }), sound("kitchen")] }), "tv").sync).toEqual({ adjustable: true, delay: 80 });
    expect(row(session({ outputs: [both("tv", { delay: 80 })] }), "tv").sync).toEqual({ adjustable: false, delay: 80 });
  });

  test("Sync shows only for sound that is in and that you may change", () => {
    expect(row(session({ outputs: [picture("tv")] }), "tv").sync).toBeUndefined();
    expect(row(session({ devices: [device("tv", { online: false })], outputs: [both("tv")] }), "tv").sync).toBeUndefined();
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
    expect(rows(state).map(item => [item.device.id, item.only.enabled])).toEqual([["tv", false], ["phone", false], [here, false]]);
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

describe("a channel only the host can play", () => {
  test("locks every device that isn't its output and names the host", () => {
    const state = session({ outputs: [both("tv")], film: { hostOnly: true } });
    expect(row(state, "kitchen")).toMatchObject({ picture: { enabled: false }, level: { enabled: false }, mute: { enabled: false }, only: { enabled: false } });
    expect(row(state, "tv").level.enabled).toBe(true);
    expect(picker(state, { here }).hint).toBe("This channel plays only on Tv.");
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

  test("a waiting source asks you to choose, and a silent one offers only Picture", () => {
    expect(picker(live([]), { here }).hint).toBe("Choose where this source plays: raise a level or turn on Picture.");
    const silent = live([picture("tv")], {}, { ...screen, audio: false });
    expect(picker(silent, { here }).hint).toBe("This source has no sound. Enable Picture on devices to watch it.");
    expect(row(silent, "tv")).toMatchObject({ level: { enabled: false }, mute: { enabled: false }, picture: { enabled: true } });
  });
});

describe("the hint", () => {
  test("says how faders work, and on the TV how OK hands them the arrows", () => {
    expect(picker(session(), { here }).hint).toBe("Raise a device level to add its sound; at 0 its sound is off.");
    expect(picker(session(), { here, tv: true }).hint).toEndWith(" Press OK to adjust a level, then OK or Back to finish.");
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

  test("reads a device's output in whichever playback it serves", () => {
    const state = session({ devices: [device("kitchen", { volume: 30, muted: true })], others: [radio([sound("kitchen")])] });
    expect(signalOf(state, "kitchen")).toEqual({ picture: false, sound: true, volume: 30, muted: true, online: true });
  });
});
