import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore } from "../src/server/store";
import { Database } from "../src/server/sqlite";
import { defaultLiveAudioSettings, isLiveAudioSettings, outputLatencyHint, outputBufferOptions } from "../src/shared/audio-settings";
import { readNativeInputBufferPreference, readOutputBufferPreference } from "../src/client/audio-settings";

test("client latency requests use seconds; missing, invalid or inaccessible storage uses browser defaults", () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  let saved: string | null = null;
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: () => saved } });
  try {
    expect(readOutputBufferPreference()).toBe("auto");
    for (const value of outputBufferOptions) {
      saved = value;
      expect(readOutputBufferPreference()).toBe(value);
      expect(outputLatencyHint(readOutputBufferPreference())).toBe(value === "auto" ? undefined : Number(value) / 48000);
    }
    for (const invalid of ["-512", "NaN", "2048", "", "0"]) { saved = invalid; expect(readOutputBufferPreference()).toBe("auto"); }
    Object.defineProperty(globalThis, "localStorage", { configurable: true, get: () => { throw new Error("Denied"); } });
    expect(readOutputBufferPreference()).toBe("auto");
  } finally { if (original) Object.defineProperty(globalThis, "localStorage", original); else Reflect.deleteProperty(globalThis, "localStorage"); }
});

test("Live audio starts from a 128-frame native capture, a 100 ms maximum and a 256-frame listener buffer", () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  let saved: string | null = null;
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: () => saved } });
  try {
    expect(readNativeInputBufferPreference()).toBe("128");
    saved = "512"; expect(readNativeInputBufferPreference()).toBe("512");
    saved = "64"; expect(readNativeInputBufferPreference()).toBe("128");
  } finally { if (original) Object.defineProperty(globalThis, "localStorage", original); else Reflect.deleteProperty(globalThis, "localStorage"); }
  expect(defaultLiveAudioSettings).toEqual({ codec: "pcm", opusBitrate: 192000, lead: "automatic", leadMs: 100, minLeadMs: 0, maxLeadMs: 100, raiseForSlowest: true, listenerBufferFrames: 256 });
  // A device's own buffer wins; Automatic asks for the host's.
  expect(outputLatencyHint("auto", 256)).toBe(256 / 48000);
  expect(outputLatencyHint("512", 256)).toBe(512 / 48000);
  expect(isLiveAudioSettings({ ...defaultLiveAudioSettings, listenerBufferFrames: 300 })).toBe(false);
  const directory = mkdtempSync(join(tmpdir(), "live-audio-settings-")), path = join(directory, "test.sqlite");
  try {
    // Settings saved before the listener buffer existed keep their values and take its default.
    openStore(path).close();
    const database = new Database(path);
    database.query("INSERT INTO installation_live_audio VALUES (1, ?)").run(JSON.stringify({ codec: "opus", opusBitrate: 320000, lead: "fixed", leadMs: 60, minLeadMs: 0, maxLeadMs: 100, raiseForSlowest: false }));
    database.close();
    const store = openStore(path);
    try {
      expect(store.liveAudioSettings()).toEqual({ codec: "opus", opusBitrate: 320000, lead: "fixed", leadMs: 60, minLeadMs: 0, maxLeadMs: 100, raiseForSlowest: false, listenerBufferFrames: 256 });
      store.saveLiveAudioSettings({ ...store.liveAudioSettings(), listenerBufferFrames: 512 });
      expect(store.liveAudioSettings().listenerBufferFrames).toBe(512);
    } finally { store.close(); }
  } finally { rmSync(directory, { recursive: true }); }
});
