import { expect, test } from "bun:test";
import type { PlaybackSummary } from "../src/shared/protocol";
import { keepScreenAwake, playingOnDevice } from "../src/client/screen-wake-lock";

class ScreenLock extends EventTarget {
  released = false;
  async release() { this.released = true; this.dispatchEvent(new Event("release")); }
}

const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };
function fixture() {
  const locks: ScreenLock[] = [];
  const requests: string[] = [];
  const statuses: string[] = [];
  const view = Object.assign(new EventTarget(), {
    isSecureContext: true,
    navigator: { wakeLock: { request: async (type: string) => {
      requests.push(type);
      const lock = new ScreenLock(); locks.push(lock); return lock;
    } } },
  });
  const document = Object.assign(new EventTarget(), { defaultView: view, visibilityState: "visible" });
  const visibility = (state: string) => { document.visibilityState = state; document.dispatchEvent(new Event("visibilitychange")); };
  const start = () => keepScreenAwake(document as unknown as Document, status => statuses.push(status));
  return { document, view, locks, requests, statuses, visibility, start };
}

test("only this device's playing or loading picture/sound keeps it awake", () => {
  const playback = (status: PlaybackSummary["status"], deviceId = "phone", picture = false, sound = true): PlaybackSummary =>
    ({ id: "playback", title: "Radio", status, outputs: [{ deviceId, picture, sound }] });
  expect(playingOnDevice(undefined, "phone")).toBe(false);
  expect(playingOnDevice([playback("playing", "tv")], "phone")).toBe(false);
  expect(playingOnDevice([playback("playing", "phone", false, false)], "phone")).toBe(false);
  for (const status of ["idle", "paused", "ended", "error", "unavailable"] as const) {
    expect(playingOnDevice([playback(status)], "phone")).toBe(false);
  }
  for (const status of ["playing", "loading"] as const) {
    expect(playingOnDevice([playback(status)], "phone")).toBe(true);
    expect(playingOnDevice([playback(status, "phone", true, false)], "phone")).toBe(true);
    expect(playingOnDevice([playback("paused", "tv"), playback(status)], "phone")).toBe(true);
  }
});

test("releases on hiding, reacquires on return, and removes listeners at cleanup", async () => {
  const f = fixture();
  const stop = f.start();
  await flush();
  expect(f.requests).toEqual(["screen"]);
  expect(f.statuses).toEqual(["active"]);
  f.view.dispatchEvent(new Event("pageshow"));
  await flush();
  expect(f.requests).toHaveLength(1);
  f.visibility("hidden");
  expect(f.locks[0]!.released).toBe(true);
  f.visibility("visible");
  await flush();
  expect(f.requests).toHaveLength(2);
  stop();
  expect(f.locks[1]!.released).toBe(true);
  f.visibility("hidden"); f.visibility("visible"); f.view.dispatchEvent(new Event("pageshow"));
  await flush();
  expect(f.requests).toHaveLength(2);
});

test("hidden pages, insecure origins and unsupported browsers do not request a lock", async () => {
  for (const kind of ["hidden", "insecure", "unsupported"]) {
    const f = fixture();
    if (kind === "hidden") f.visibility("hidden");
    if (kind === "insecure") f.view.isSecureContext = false;
    if (kind === "unsupported") Object.assign(f.view.navigator, { wakeLock: undefined });
    const stop = f.start();
    await flush();
    expect(f.requests).toEqual([]);
    stop();
  }
});

test("a late grant is released after teardown or hiding", async () => {
  for (const cleanup of [true, false]) {
    const f = fixture(), grant = Promise.withResolvers<ScreenLock>();
    f.view.navigator.wakeLock.request = () => grant.promise;
    const stop = f.start();
    if (cleanup) stop(); else f.visibility("hidden");
    const lock = new ScreenLock(); grant.resolve(lock);
    await flush();
    expect(lock.released).toBe(true);
    expect(f.statuses).toEqual([]);
    stop();
  }
});

test("a retired mount cannot release the next mount's lock", async () => {
  const f = fixture(), grant = Promise.withResolvers<ScreenLock>();
  const request = f.view.navigator.wakeLock.request;
  f.view.navigator.wakeLock.request = () => grant.promise;
  f.start()();
  f.view.navigator.wakeLock.request = request;
  const stop = f.start();
  await flush();
  const stale = new ScreenLock(); grant.resolve(stale);
  await flush();
  expect(stale.released).toBe(true);
  expect(f.locks[0]!.released).toBe(false);
  stop();
});

test("browser refusal and revocation do not spin; returning to Couch retries", async () => {
  const f = fixture();
  const request = f.view.navigator.wakeLock.request;
  f.view.navigator.wakeLock.request = async type => { f.requests.push(type); throw new Error("NotAllowedError"); };
  const stop = f.start();
  await flush();
  expect(f.requests).toHaveLength(1);
  expect(f.statuses).toEqual(["blocked"]);
  f.view.navigator.wakeLock.request = request;
  f.visibility("hidden"); f.visibility("visible");
  await flush();
  await f.locks[0]!.release();
  await flush();
  expect(f.statuses).toEqual(["blocked", "active", "released"]);
  expect(f.requests).toHaveLength(2);
  f.visibility("hidden"); f.visibility("visible");
  await flush();
  expect(f.requests).toHaveLength(3);
  stop();
});

test("returning while a request is pending recovers if that request was released", async () => {
  const f = fixture(), grant = Promise.withResolvers<ScreenLock>();
  const request = f.view.navigator.wakeLock.request;
  f.view.navigator.wakeLock.request = () => grant.promise;
  const stop = f.start();
  f.visibility("hidden"); f.visibility("visible");
  f.view.navigator.wakeLock.request = request;
  const expired = new ScreenLock(); await expired.release(); grant.resolve(expired);
  await flush();
  expect(f.requests).toEqual(["screen"]);
  expect(f.locks[0]!.released).toBe(false);
  stop();
});
