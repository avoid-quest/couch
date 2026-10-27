import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore } from "../src/server/store";
import { Database } from "../src/server/sqlite";
import { defaultLiveAudioSettings, isLiveAudioLead, isLiveAudioSettings, liveAudioLeadOptions, outputLatencyHint, outputBufferOptions } from "../src/shared/audio-settings";
import { readNativeInputBufferPreference, readOutputBufferPreference } from "../src/client/audio-settings";

test("host lead survives reopening and refuses unsupported values without changing saved state", () => {
  const directory = mkdtempSync(join(tmpdir(), "audio-settings-"));
  let store = openStore(join(directory, "test.sqlite"));
  try {
    expect(store.liveAudioLeadMs()).toBe(100);
    for (const lead of [45, 50, 55, 75, 95, 100, 150, 250]) {
      expect(isLiveAudioLead(lead)).toBe(true);
      store.saveLiveAudioLeadMs(lead);
      for (const value of [null, "45", 0, -1, 44, 54, 96, 10000, Infinity, NaN]) expect(() => store.saveLiveAudioLeadMs(value)).toThrow();
      expect(store.liveAudioLeadMs()).toBe(lead);
      store.close(); store = openStore(join(directory, "test.sqlite"));
      expect(store.liveAudioLeadMs()).toBe(lead);
    }
  } finally { store.close(); rmSync(directory, { recursive: true }); }
});

test.each([45, 50, 55, 75, 95])("an existing saved %i ms lead is preserved", lead => {
  const directory = mkdtempSync(join(tmpdir(), "audio-settings-saved-")), path = join(directory, "test.sqlite");
  openStore(path).close();
  const database = new Database(path);
  database.query("INSERT INTO installation_audio VALUES (1, ?)").run(lead); database.close();
  const store = openStore(path);
  try { expect(store.liveAudioLeadMs()).toBe(lead); }
  finally { store.close(); rmSync(directory, { recursive: true }); }
});

test("an unsupported saved lead falls back to the current default without blocking a new publication", () => {
  const directory = mkdtempSync(join(tmpdir(), "audio-settings-legacy-")), path = join(directory, "test.sqlite");
  openStore(path).close();
  const database = new Database(path);
  database.exec("INSERT INTO installation_audio VALUES (1, 44)"); database.close();
  const store = openStore(path);
  try {
    expect(store.liveAudioLeadMs()).toBe(100);
    store.saveLiveAudioLeadMs(150);
    expect(store.liveAudioLeadMs()).toBe(150);
  } finally { store.close(); rmSync(directory, { recursive: true }); }
});

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


test("every selectable lead is saved and accepted for a new publication", () => {
  const store = openStore(":memory:");
  try {
    for (const lead of liveAudioLeadOptions) {
      store.saveLiveAudioLeadMs(lead);
      expect(store.liveAudioLeadMs()).toBe(lead);
    }
    expect(liveAudioLeadOptions).toEqual([45, 50, 55, 75, 95, 100, 150, 250]);
    for (const lead of [44, 54, 96, -1, Infinity, NaN]) {
      expect(isLiveAudioLead(lead)).toBe(false);
    }
  } finally { store.close(); }
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
