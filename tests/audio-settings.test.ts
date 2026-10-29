import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore } from "../src/server/store";
import { defaultLiveAudioSettings, isLiveAudioSettings } from "../src/shared/audio-settings";

test("Live settings expose codec negotiation and the SDK buffer, ignoring obsolete engine policy", () => {
  const directory = mkdtempSync(join(tmpdir(), "couch-sdk-settings-"));
  const store = openStore(join(directory, "couch.sqlite"));
  try {
    expect(store.liveAudioSettings()).toEqual(defaultLiveAudioSettings);
    store.saveLiveAudioSettings({ codec: "opus", minBufferMs: 600 });
    expect(store.liveAudioSettings()).toEqual({ codec: "opus", minBufferMs: 600 });
    expect(isLiveAudioSettings({ codec: "pcm", minBufferMs: -1 })).toBe(false);
    expect(isLiveAudioSettings({ codec: "pcm", minBufferMs: 5001 })).toBe(false);
    expect(() => store.saveLiveAudioSettings({ codec: "pcm", lead: "fixed", leadMs: 50 })).toThrow();
  } finally { store.close(); rmSync(directory, { recursive: true }); }
});
