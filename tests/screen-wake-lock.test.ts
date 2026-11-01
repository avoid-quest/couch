import { expect, test } from "bun:test";
import { keepScreenAwake } from "../src/client/screen-wake-lock";

class ScreenLock extends EventTarget {
  released = false;
  async release() {
    this.released = true;
    this.dispatchEvent(new Event("release"));
  }
}

const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};
function fixture() {
  const locks: ScreenLock[] = [];
  const requests: string[] = [];
  const statuses: string[] = [];
  const view = Object.assign(new EventTarget(), {
    isSecureContext: true,
    navigator: {
      wakeLock: {
        request: async (type: string) => {
          requests.push(type);
          const lock = new ScreenLock();
          locks.push(lock);
          return lock;
        },
      },
    },
  });
  const document = Object.assign(new EventTarget(), {
    defaultView: view,
    visibilityState: "visible",
  });
  const visibility = (state: string) => {
    document.visibilityState = state;
    document.dispatchEvent(new Event("visibilitychange"));
  };
  const start = () =>
    keepScreenAwake(document as unknown as Document, (status) => statuses.push(status));
  return { document, view, locks, requests, statuses, visibility, start };
}

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
  f.visibility("hidden");
  f.visibility("visible");
  f.view.dispatchEvent(new Event("pageshow"));
  await flush();
  expect(f.requests).toHaveLength(2);
});

test("a late grant is released after teardown or hiding", async () => {
  for (const cleanup of [true, false]) {
    const f = fixture(),
      grant = Promise.withResolvers<ScreenLock>();
    f.view.navigator.wakeLock.request = () => grant.promise;
    const stop = f.start();
    if (cleanup) stop();
    else f.visibility("hidden");
    const lock = new ScreenLock();
    grant.resolve(lock);
    await flush();
    expect(lock.released).toBe(true);
    expect(f.statuses).toEqual([]);
    stop();
  }
});
