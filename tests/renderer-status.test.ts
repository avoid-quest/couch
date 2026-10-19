import { expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rendererStatus } from "../app/renderer-status";

// Electron's webContents emits these with the same positional arguments.
function fixture(page: "local" | "remote" = "local") {
  const directory = mkdtempSync(join(tmpdir(), "couch-renderer-"));
  const path = join(directory, "renderer-status.json"), contents = new EventEmitter();
  const status = rendererStatus(path, { run: `run-${directory.slice(-6)}`, version: "9.9.9" }, () => page);
  status.watch(contents);
  return {
    contents, status, read: () => JSON.parse(readFileSync(path, "utf8")),
    navigate: (mainFrame = true, inPlace = false) => contents.emit("did-start-navigation", {}, "http://localhost:4100/", inPlace, mainFrame),
    commit: () => contents.emit("did-navigate", {}, "http://localhost:4100/", 200, "OK"),
    loaded: () => contents.emit("did-finish-load"),
    [Symbol.dispose]: () => rmSync(directory, { recursive: true, force: true }),
  };
}

test("each run identifies itself before its page loads", () => {
  using first = fixture(), second = fixture();
  const starting = first.read();
  expect(starting).toMatchObject({ state: "starting", page: "local", pid: process.pid, version: "9.9.9", navigation: 0 });
  expect(starting.run).not.toBe(second.read().run);
  expect(Date.parse(starting.startedAt)).toBeLessThanOrEqual(Date.parse(starting.at));
});

test("a loaded page is only page-loaded until its mounted shell acknowledges", () => {
  using renderer = fixture();
  renderer.navigate();
  expect(renderer.status.acknowledge()).toBe(false);
  expect(renderer.read()).toMatchObject({ state: "loading", navigation: 1 });
  renderer.commit();
  renderer.loaded();
  // HTML and scripts loaded, but nothing mounted: an app that failed to start, or an older Couch.
  expect(renderer.read().state).toBe("page-loaded");
  // Same-document and child-frame navigations don't restart the page.
  renderer.navigate(true, true);
  renderer.navigate(false);
  expect(renderer.status.acknowledge()).toBe(true);
  expect(renderer.read()).toMatchObject({ state: "ready", navigation: 1 });
});

test("a shell that mounts before the load event stays ready", () => {
  using renderer = fixture();
  renderer.navigate();
  renderer.commit();
  expect(renderer.status.acknowledge()).toBe(true);
  renderer.loaded();
  expect(renderer.read().state).toBe("ready");
});

test("the replaced document can't make the next navigation ready", () => {
  using renderer = fixture();
  renderer.navigate();
  renderer.commit();
  renderer.loaded();
  renderer.status.acknowledge();
  renderer.navigate();
  // The old page's late acknowledgement, before the new document commits.
  expect(renderer.status.acknowledge()).toBe(false);
  expect(renderer.read()).toMatchObject({ state: "loading", navigation: 2 });
  renderer.commit();
  renderer.loaded();
  expect(renderer.read().state).toBe("page-loaded");
});

test("a failed page stays failed through Chromium's error page until the next navigation", () => {
  using renderer = fixture("remote");
  renderer.navigate();
  renderer.contents.emit("did-fail-load", {}, -3, "ERR_ABORTED", "https://couch.lan/", true);
  renderer.contents.emit("did-fail-load", {}, -105, "ERR_NAME_NOT_RESOLVED", "https://couch.lan/", false);
  expect(renderer.read().state).toBe("loading");
  renderer.contents.emit("did-fail-load", {}, -102, "ERR_CONNECTION_REFUSED", "https://couch.lan/?token=secret", true);
  renderer.loaded();
  expect(renderer.status.acknowledge()).toBe(false);
  const failed = renderer.read();
  expect(failed).toMatchObject({ state: "failed", page: "remote", reason: "-102 ERR_CONNECTION_REFUSED" });
  expect(JSON.stringify(failed)).not.toContain("couch.lan");
  renderer.navigate();
  renderer.commit();
  renderer.loaded();
  renderer.status.acknowledge();
  expect(renderer.read()).toMatchObject({ state: "ready" });
  expect(renderer.read().reason).toBeUndefined();
});

test("another Couch that Main can't reach is a remote failure, not a local one", () => {
  using renderer = fixture("remote");
  renderer.status.unreachable();
  expect(renderer.read()).toMatchObject({ state: "failed", page: "remote", reason: "unreachable" });
  renderer.navigate();
  renderer.commit();
  renderer.loaded();
  expect(renderer.read().state).toBe("page-loaded");
});

test("a hung page recovers its state, and a crashed one reports why and can't be acknowledged", () => {
  using renderer = fixture();
  renderer.navigate();
  renderer.commit();
  renderer.loaded();
  renderer.status.acknowledge();
  renderer.contents.emit("unresponsive");
  renderer.contents.emit("unresponsive");
  expect(renderer.read().state).toBe("unresponsive");
  renderer.contents.emit("responsive");
  expect(renderer.read().state).toBe("ready");
  renderer.contents.emit("render-process-gone", {}, { reason: "oom", exitCode: 9 });
  expect(renderer.status.acknowledge()).toBe(false);
  expect(renderer.read()).toMatchObject({ state: "gone", reason: "oom" });
});
