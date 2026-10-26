import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore } from "../src/server/store";
import { Database } from "../src/server/sqlite";
import { liveOutputAdmission } from "../src/server/output-admission";
import type { SendspinSession } from "@sonn-audio/node-sendspin";
import { requireLiveAudioLead } from "../src/server/live-audio-policy";
import { createScheduledCapture } from "../src/server/scheduled-capture";
import { serverNowUs } from "@sonn-audio/node-sendspin";
import { isLiveAudioLead, liveAudioLeadOptions, outputLatencyHint, outputBufferOptions } from "../src/shared/audio-settings";
import { readOutputBufferPreference } from "../src/client/audio-settings";

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
    expect(requireLiveAudioLead(store.liveAudioLeadMs())).toBe(100);
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
      expect(requireLiveAudioLead(lead)).toBe(lead);
    }
    expect(liveAudioLeadOptions).toEqual([45, 50, 55, 75, 95, 100, 150, 250]);
    expect(requireLiveAudioLead()).toBe(100);
    for (const lead of [44, 54, 96, -1, Infinity, NaN]) {
      expect(isLiveAudioLead(lead)).toBe(false);
      expect(() => requireLiveAudioLead(lead)).toThrow("Choose a supported live audio scheduling lead.");
    }
  } finally { store.close(); }
});

test("a receiver's measured budget follows the host's chosen lead", async () => {
  while (serverNowUs() < 100_000) await Bun.sleep(10);
  for (const lead of liveAudioLeadOptions) {
    const capture = createScheduledCapture({ intent: "live", liveAudioLeadMs: lead }, () => new Promise(() => {}), () => {});
    const capturedAtUs = Math.round(serverNowUs() - 5000);
    capture.write({ generation: "g", sequence: 0, samplePosition: 0, capturedAtUs, sampleRate: 48_000, channels: 2, pcm: new Float32Array(960) });
    const budget = capture.outputBudgetMs("pcm")!, sentUs = serverNowUs();
    expect(budget).toBeLessThanOrEqual(lead - 5);
    expect(budget).toBeGreaterThanOrEqual(Math.floor((capturedAtUs + lead * 1000 - sentUs) / 1000));
    capture.close();
  }
});
