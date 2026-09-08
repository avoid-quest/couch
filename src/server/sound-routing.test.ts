import { expect, test } from "bun:test";
import { createSoundRouting } from "./sound-routing";
import { openStore } from "./store";
import { createSession } from "./session";
import type { PlaybackCommand } from "../shared/protocol";
import type { SoundInventory } from "../shared/sound";

async function fixture() {
  const inventory: SoundInventory = { defaultOutput: "hdmi", outputs: ["hdmi", "analog"].map(id => ({ id, name: id, state: "RUNNING", availability: "available", volume: 64, muted: false })) };
  let saved: string | null = null, stream: string | null = null, active = false, lost = 0, failDefault = false;
  const pins: string[] = [];
  const backend = {
    inventory: async () => structuredClone(inventory), route: async () => stream,
    default: async (name: string) => { if (failDefault) throw new Error("backend refused"); inventory.defaultOutput = name; },
    volume: async (name: string, value: number) => { inventory.outputs.find(output => output.id === name)!.volume = value; },
    mute: async (name: string, value: boolean) => { inventory.outputs.find(output => output.id === name)!.muted = value; },
  };
  const sound = createSoundRouting({ backend, saved: () => saved, save: name => { saved = name; }, active: () => active, pin: name => { pins.push(name); if (stream) stream = name; }, lost: () => { lost++; active = false; }, changed: () => {} });
  await Bun.sleep(1);
  return { sound, inventory, backend, pins, saved: () => saved, lost: () => lost, stream: (name: string | null) => { stream = name; }, active: () => { active = true; }, failDefault: () => { failDefault = true; } };
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
  const store = openStore(":memory:"); const commands: PlaybackCommand[] = [];
  const session = createSession(store, command => commands.push(command), () => {}, { systemAudio: true, prepareAudio: () => "hdmi" });
  try {
    session.observe({ playbackId: null, status: "idle", position: 0, duration: null, volume: 100, seekable: false, error: null });
    session.command({ type: "enqueue", entry: { id: "first", title: "First", source: "file:///first.mp4" }, playNow: true });
    session.command({ type: "enqueue", entry: { id: "next", title: "Next", source: "file:///next.mp4" } });
    const playbackId = session.state.player.playbackId!;
    session.observe({ playbackId, status: "playing", position: 25, duration: 100, volume: 100, seekable: true, error: null });
    session.updateSystemAudio({ selectedOutput: "hdmi", observedOutput: "hdmi", volume: 37, muted: true, error: null });
    session.audioLost("HDMI disconnected");
    expect(commands.at(-1)).toEqual({ type: "pause", playbackId, paused: true });
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
  const store = openStore(":memory:"); const commands: PlaybackCommand[] = [];
  const session = createSession(store, command => commands.push(command), () => {});
  try {
    session.observe({ playbackId: null, status: "idle", position: 0, duration: null, volume: 100, seekable: false, error: null });
    session.command({ type: "enqueue", entry: { id: "radio", title: "Radio", source: "https://example.test/live", kind: "radio" }, playNow: true });
    const old = session.state.player;
    session.audioLost("Output disconnected");
    expect(commands.at(-1)).toEqual({ type: "stop" });
    session.observe({ ...old, status: "error", error: "native disconnected" });
    expect(session.state.player.error).toBe("Output disconnected"); expect(session.state.radioRetry).toBeNull();
    expect(session.state.currentEntryId).toBe("radio");
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
