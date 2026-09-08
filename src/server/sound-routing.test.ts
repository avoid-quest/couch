import { expect, test } from "bun:test";
import { createSoundRouting } from "./sound-routing";
import { openStore } from "./store";
import { createSession } from "./session";
import type { PlaybackCommand } from "../shared/protocol";
import type { SavedSoundProfile, SoundInventory } from "../shared/sound";

async function fixture() {
  const inventory: SoundInventory = { defaultOutput: "hdmi", outputs: ["hdmi", "analog"].map(id => ({ id, name: id, state: "RUNNING", availability: "available", volume: 64, muted: false })) };
  let savedProfile: SavedSoundProfile | null = null;
  let saved: string | null = null, stream: string | null = null, active = false, lost = 0, failDefault = false;
  const pins: string[] = [];
  const backend = {
    inventory: async () => structuredClone(inventory), route: async () => stream,
    profile: async (_card: string, _profile: string) => {},
    default: async (name: string) => { if (failDefault) throw new Error("backend refused"); inventory.defaultOutput = name; },
    volume: async (name: string, value: number) => { inventory.outputs.find(output => output.id === name)!.volume = value; },
    mute: async (name: string, value: boolean) => { inventory.outputs.find(output => output.id === name)!.muted = value; },
  };
  const sound = createSoundRouting({ backend, saved: () => saved, savedProfile: () => savedProfile, save: (name, profile) => { saved = name; savedProfile = profile ?? null; }, active: () => active, pin: name => { pins.push(name); if (stream) stream = name; }, lost: () => { lost++; active = false; }, changed: () => {} });
  await Bun.sleep(1);
  return { sound, inventory, backend, pins, savedProfile: () => savedProfile, saved: () => saved, lost: () => lost, stream: (name: string | null) => { stream = name; }, active: () => { active = true; }, failDefault: () => { failDefault = true; } };
}

test("saved sink names control idle selection, active route confirmation and effective system volume/mute", async () => {
  const f = await fixture();
  try {
    expect(f.saved()).toBe("hdmi"); expect(f.sound.state.observedOutput).toBeNull();
    await f.sound.select("analog", () => {});
    expect(f.sound.prepare()).toBe("analog"); expect(f.sound.state.observedOutput).toBeNull();
    f.stream("analog"); f.active();
    await f.sound.select("hdmi", () => {});
    expect(f.sound.state.observedOutput).toBe("hdmi");
    await f.sound.volume(31, () => {}); await f.sound.mute(true, () => {});
    expect(f.sound.state).toMatchObject({ volume: 31, muted: true });
    f.inventory.outputs[0]!.volume = 48; f.inventory.outputs[0]!.muted = false;
    await f.sound.check();
    expect(f.sound.state).toMatchObject({ volume: 48, muted: false });
  } finally { f.sound.close(); }
});

test("missing output, wrong route and audio-server failure interrupt playback and reconnection never resumes", async () => {
  const f = await fixture();
  try {
    f.active(); f.stream("hdmi"); f.inventory.outputs[0]!.availability = "unavailable";
    await f.sound.check();
    expect(f.lost()).toBe(1); expect(() => f.sound.prepare()).toThrow("unavailable");
    f.inventory.outputs[0]!.availability = "available";
    await f.sound.check();
    expect(f.sound.prepare()).toBe("hdmi"); expect(f.lost()).toBe(1); expect(f.pins).toEqual([]);
    f.inventory.defaultOutput = "analog"; await f.sound.check();
    expect(f.inventory.defaultOutput).toBe("hdmi"); expect(f.lost()).toBe(1);
    f.active(); f.stream("analog"); await f.sound.check(); expect(f.lost()).toBe(2);
    f.active(); f.backend.inventory = async () => { throw new Error("offline"); };
    await f.sound.check(); expect(f.lost()).toBe(3); expect(f.sound.state.volume).toBeNull();
  } finally { f.sound.close(); }
});

test("a failed route mutation retains saved route and restores the previous native device", async () => {
  const f = await fixture();
  try {
    f.stream("hdmi"); f.failDefault();
    await expect(f.sound.select("analog", () => {})).rejects.toThrow("backend refused");
    expect(f.saved()).toBe("hdmi"); expect(f.pins).toEqual(["analog", "hdmi"]);
    await expect(f.sound.select("missing", () => {})).rejects.toThrow("unavailable");
  } finally { f.sound.close(); }
});

test("revoked administration during asynchronous inventory cannot change an output", async () => {
  const f = await fixture();
  try {
    let authorized = true;
    f.backend.inventory = async () => { authorized = false; return structuredClone(f.inventory); };
    await expect(f.sound.select("analog", () => { if (!authorized) throw new Error("revoked"); })).rejects.toThrow("revoked");
    expect(f.pins).toEqual([]); expect(f.saved()).toBe("hdmi");
  } finally { f.sound.close(); }
});

test("session pauses seekable media on audio loss, suppresses stale EOF and requires explicit resume", () => {
  const store = openStore(":memory:"); const commands: PlaybackCommand[] = []; const reported: string[] = [];
  const session = createSession(store, command => commands.push(command), () => {}, { observe: player => { reported.push(player.status); }, systemAudio: true, prepareAudio: () => "hdmi" });
  try {
    session.observe({ playbackId: null, status: "idle", position: 0, duration: null, volume: 100, seekable: false, error: null });
    session.command({ type: "enqueue", entry: { id: "first", title: "First", source: "file:///first.mp4" }, playNow: true });
    session.command({ type: "enqueue", entry: { id: "next", title: "Next", source: "file:///next.mp4" } });
    const playbackId = session.state.player.playbackId!;
    session.observe({ playbackId, status: "playing", position: 25, duration: 100, volume: 100, seekable: true, error: null });
    session.updateSystemAudio({ selectedOutput: "hdmi", observedOutput: "hdmi", volume: 37, muted: true, error: null });
    session.audioLost("HDMI disconnected");
    expect(commands.at(-1)).toEqual({ type: "audioPause" });
    session.observe({ ...session.state.player, status: "paused", volume: 100 });
    expect(reported.at(-1)).toBe("paused");
    session.observe({ ...session.state.player, status: "ended", volume: 100 });
    expect(session.state.player.status).toBe("paused"); expect(session.state.currentEntryId).toBe("first");
    session.command({ type: "pause", playbackId, paused: false });
    session.observe({ ...session.state.player, status: "playing", volume: 100 });
    expect(session.state.player.volume).toBe(37); expect(session.state.player.error).toBeNull();
    session.saveAudioDelay(-0.35);
    expect(store.playbackPreferences(store.activeProfile().id).device.audioDelay).toBe(-0.35);
    session.command({ type: "stop" }); session.saveAudioDelay(0.5);
    expect(session.state.preferences!.device.audioDelay).toBe(0.5);
  } finally { store.close(); }
});

test("live media audio loss stops, cancels retry and rejects retired playback observations", () => {
  const store = openStore(":memory:"); const commands: PlaybackCommand[] = []; const stops: (string | null)[] = [];
  const session = createSession(store, command => commands.push(command), () => {}, { stopped: id => { stops.push(id); } });
  try {
    session.observe({ playbackId: null, status: "idle", position: 0, duration: null, volume: 100, seekable: false, error: null });
    session.command({ type: "enqueue", entry: { id: "radio", title: "Radio", source: "https://example.test/live", kind: "radio" }, playNow: true });
    stops.length = 0;
    const old = session.state.player;
    session.audioLost("Output disconnected");
    expect(commands.at(-1)).toEqual({ type: "stop" });
    session.observe({ ...old, status: "error", error: "native disconnected" });
    expect(session.state.player.error).toBe("Output disconnected"); expect(session.state.radioRetry).toBeNull();
    expect(session.state.currentEntryId).toBe("radio");
    session.observe({ ...old, playbackId: null, status: "idle" });
    expect(stops).toEqual([null]);
    expect(session.state.player.error).toBe("Output disconnected");
  } finally { store.close(); }
});

test("saved stable sink identity and idle TV delay survive a reopened store without autoplay", () => {
  const path = `/tmp/couch-sound-store-${crypto.randomUUID()}.sqlite`;
  let store = openStore(path);
  try {
    store.saveAudioOutput("alsa_output.pci-0000_00_1f.3.hdmi-stereo");
    const session = createSession(store, () => { throw new Error("Idle delay must not play"); }, () => {});
    session.saveAudioDelay(-0.2);
    store.close(); store = openStore(path);
    createSession(store, () => { throw new Error("Restart must not play"); }, () => {});
    expect(store.audioOutput()).toBe("alsa_output.pci-0000_00_1f.3.hdmi-stereo");
    expect(store.playbackPreferences(store.activeProfile().id).device.audioDelay).toBe(-0.2);
  } finally { store.close(); for (const suffix of ["", "-shm", "-wal"]) { try { require("node:fs").unlinkSync(path + suffix); } catch {} } }
});

test("inactive output profiles activate by stable card identity, persist and restore after restart/hotplug", async () => {
  const f = await fixture();
  try {
    f.inventory.outputs = [{ ...f.inventory.outputs[0]!, card: "alsa_card.stable" }];
    f.inventory.profiles = ["hdmi", "analog"].map(name => ({ card: "alsa_card.stable", id: `output:${name}`, name, active: name === "hdmi", available: true, selectable: true }));
    const changes: string[] = [];
    f.backend.profile = async (card, profile) => {
      assertCard(card); changes.push(profile);
      f.inventory.profiles!.forEach(item => { item.active = item.id === profile; });
      f.inventory.outputs = [{ ...f.inventory.outputs[0]!, id: profile.slice(7), card }];
    };
    f.active();
    await f.sound.profile({ card: "alsa_card.stable", profile: "output:analog" }, () => {});
    expect(f.saved()).toBe("analog");
    expect(f.savedProfile()).toEqual({ card: "alsa_card.stable", profile: "output:analog" });
    expect(f.lost()).toBe(1);
    await f.backend.profile("alsa_card.stable", "output:hdmi");
    await f.sound.check();
    expect(changes).toEqual(["output:analog", "output:hdmi", "output:analog"]);
    expect(f.sound.prepare()).toBe("analog");
  } finally { f.sound.close(); }
  function assertCard(value: string) { expect(value).toBe("alsa_card.stable"); }
});

test("profile rejection restores the previous card profile and saved sink without resuming", async () => {
  const f = await fixture();
  try {
    f.inventory.outputs = [{ ...f.inventory.outputs[0]!, card: "card" }];
    f.inventory.profiles = ["hdmi", "analog"].map(name => ({ card: "card", id: `output:${name}`, name, active: name === "hdmi", available: true, selectable: true }));
    const profiles: string[] = [];
    f.backend.profile = async (_card, profile) => { profiles.push(profile); if (profile.endsWith("analog")) throw new Error("device rejected profile"); };
    f.active();
    await expect(f.sound.profile({ card: "card", profile: "output:analog" }, () => {})).rejects.toThrow("device rejected");
    expect(profiles).toEqual(["output:analog", "output:hdmi"]); expect(f.saved()).toBe("hdmi"); expect(f.lost()).toBe(1);
  } finally { f.sound.close(); }
});
