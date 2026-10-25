import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore } from "../src/server/store";
import { liveOutputBudget } from "../src/server/live-audio-policy";
import { liveAudioLeadOptions, outputLatencyHint, outputBufferOptions } from "../src/shared/audio-settings";
import { readOutputBufferPreference } from "../src/client/audio-settings";

test("host lead survives reopening and refuses unsupported values without changing saved state", () => {
  const directory = mkdtempSync(join(tmpdir(), "audio-settings-"));
  let store = openStore(join(directory, "test.sqlite"));
  try {
    expect(store.liveAudioLeadMs()).toBe(95);
    store.saveLiveAudioLeadMs(55);
    for (const value of [null, "55", 0, -1, 54, 10000, Infinity, NaN]) expect(() => store.saveLiveAudioLeadMs(value)).toThrow();
    expect(store.liveAudioLeadMs()).toBe(55);
    store.close(); store = openStore(join(directory, "test.sqlite"));
    expect(store.liveAudioLeadMs()).toBe(55);
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


test("all selectable leads keep a usable receiver budget, with the default unchanged", () => {
  const store = openStore(":memory:");
  try {
    for (const lead of liveAudioLeadOptions) {
      store.saveLiveAudioLeadMs(lead);
      expect(store.liveAudioLeadMs()).toBe(lead);
      expect(liveOutputBudget(lead)).toBeGreaterThanOrEqual(25);
    }
    expect(liveOutputBudget(45)).toBe(37);
    expect(liveOutputBudget(50)).toBe(42);
    expect(liveOutputBudget(55)).toBe(47);
    expect(liveOutputBudget()).toBe(70);
  } finally { store.close(); }
});
