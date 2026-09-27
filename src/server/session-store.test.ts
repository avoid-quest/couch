import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSessionStore } from "./session-store";
import { openStore } from "./store";
import { createSession } from "./session";

const entry = { id: "movie", title: "Private movie", source: "https://example.com/movie.mp4" };
const checkpoint = { entryId: entry.id, source: entry.source, position: 42, duration: 100, speed: 1, seekable: true };
const progress = { mediaId: "same-media", title: entry.title, libraryItemId: null, position: 42, duration: 100, watched: false, lastPlayedAt: 100 };

test("private playback persists independently while household data remains intact", () => {
  const directory = mkdtempSync(join(tmpdir(), "couch-session-store-"));
  const shared = openStore(join(directory, "household.db"));
  let personal = openStore(join(directory, "personal.db"));
  const other = openStore(join(directory, "other.db"));
  try {
    const household = createSessionStore(shared);
    household.saveQueue([{ ...entry, title: "Household movie" }]);
    household.saveProgress("household", { ...progress, position: 8 }, entry);
    const privateStore = createSessionStore(shared, personal);
    const profile = privateStore.createProfile("Private profile");
    privateStore.selectProfile(profile.id);
    privateStore.saveQueue([entry], entry.id);
    privateStore.savePlaybackCheckpoint(checkpoint);
    privateStore.savePlaybackContinuation({ title: "Private album", entries: [entry] });
    privateStore.saveProgress(profile.id, progress, entry);
    privateStore.saveVolume(35);
    privateStore.saveProfilePreferences(profile.id, { ...privateStore.playbackPreferences(profile.id).profile, speed: 1.5 });
    expect(household.sharedProgress(progress.mediaId)?.position).toBe(8);
    expect(household.playbackCheckpoint()).toBeNull();
    expect(household.playbackContinuation()).toBeNull();
    expect(household.profiles()).toHaveLength(1);
    expect(createSessionStore(shared, other).sharedHistory()).toEqual([]);
    expect(createSessionStore(shared, other).queue).toEqual([]);
    personal.close();
    personal = openStore(join(directory, "personal.db"));
    const reopened = createSessionStore(shared, personal);
    expect(reopened.queue).toEqual([entry]);
    expect(reopened.queueCursorEntryId()).toBe(entry.id);
    expect(reopened.playbackCheckpoint()).toEqual(checkpoint);
    expect(reopened.playbackContinuation()?.title).toBe("Private album");
    expect(reopened.activeProfile().id).toBe(profile.id);
    expect(reopened.playbackPreferences(profile.id).profile.speed).toBe(1.5);
    expect(reopened.volume).toBe(35);
    expect(reopened.sharedHistory()).toEqual([progress]);
    expect(reopened.historySource(progress.mediaId)?.title).toBe(entry.title);
    reopened.takeSharedProgress(progress.mediaId);
    expect(household.sharedProgress(progress.mediaId)?.position).toBe(8);
  } finally { personal.close(); other.close(); shared.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("facade reads current shared installation/device settings without exposing authority APIs", () => {
  const shared = openStore(":memory:");
  const personal = openStore(":memory:");
  try {
    const store = createSessionStore(shared, personal);
    shared.renameInstallation("Living room");
    shared.saveAudioDelay(0.25);
    personal.saveAudioDelay(9);
    personal.saveProfilePreferences("household", { ...personal.playbackPreferences("household").profile, speed: 2 });
    expect(store.installationName()).toBe("Living room");
    expect(store.installationId()).toBe(shared.installationId());
    expect(store.playbackPreferences("household").device.audioDelay).toBe(0.25);
    expect(store.playbackPreferences("household").profile.speed).toBe(2);
    store.saveAudioDelay(0.5);
    expect(shared.playbackPreferences("household").device.audioDelay).toBe(0.5);
    expect(personal.playbackPreferences("household").device.audioDelay).toBe(9);
    for (const key of ["controller", "controllers", "pair", "claimAdministrator", "renameInstallation", "close"]) expect(key in store).toBe(false);
    const session = createSession(store, () => {}, () => {}, { sessionId: "personal-session", nativeTarget: () => false });
    expect(session.state.sessionId).toBe("personal-session");
    session.close();
    const household = createSession(createSessionStore(shared), () => {}, () => {});
    expect(household.state.sessionId).toBe(shared.installationId());
    household.close();
  } finally { personal.close(); shared.close(); }
});

test("shared metadata cache refreshes only the requested playback history", async () => {
  const { createProviderMetadata } = await import("./provider-metadata");
  const shared = openStore(":memory:");
  const personal = openStore(":memory:");
  const source = { ...entry, source: "web:https://example.com/movie" };
  shared.saveProgress("household", progress, source);
  personal.saveProgress("household", progress, source);
  let sharedChanges = 0;
  let privateChanges = 0;
  const metadata = createProviderMetadata({ store: createSessionStore(shared), cachedItem: () => ({ id: "movie", kind: "media", provider: "youtube", title: "Movie", url: "https://example.com/movie", description: "New description" }), onChange: () => { sharedChanges++; } });
  try {
    metadata.refreshHistory([progress], createSessionStore(shared, personal), () => { privateChanges++; });
    await Promise.resolve();
    await Promise.resolve();
    expect(personal.historySource(progress.mediaId)?.description).toBe("New description");
    expect(shared.historySource(progress.mediaId)?.description).toBeUndefined();
    expect(privateChanges).toBe(1);
    expect(sharedChanges).toBe(0);
  } finally { metadata.close(); personal.close(); shared.close(); }
});
