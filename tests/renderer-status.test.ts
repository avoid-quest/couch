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
    [Symbol.dispose]: () => rmSync(directory, { recursive: true, force: true }),
  };
}

test("each run identifies itself before its page loads, then reports ready", () => {
  using first = fixture(), second = fixture();
  const starting = first.read();
  expect(starting).toMatchObject({ state: "starting", page: "local", pid: process.pid, version: "9.9.9" });
  expect(starting.run).not.toBe(second.read().run);
  expect(Date.parse(starting.startedAt)).toBeLessThanOrEqual(Date.parse(starting.at));
  first.navigate();
  expect(first.read().state).toBe("loading");
  // Same-document and child-frame navigations don't restart the page.
  first.contents.emit("did-finish-load");
  first.navigate(true, true);
  first.navigate(false);
  expect(first.read()).toMatchObject({ state: "ready", run: starting.run });
});

test("a failed page stays failed through Chromium's error page until the next navigation", () => {
  using renderer = fixture("remote");
  renderer.navigate();
  renderer.contents.emit("did-fail-load", {}, -3, "ERR_ABORTED", "https://couch.lan/", true);
  renderer.contents.emit("did-fail-load", {}, -105, "ERR_NAME_NOT_RESOLVED", "https://couch.lan/", false);
  expect(renderer.read().state).toBe("loading");
  renderer.contents.emit("did-fail-load", {}, -102, "ERR_CONNECTION_REFUSED", "https://couch.lan/?token=secret", true);
  renderer.contents.emit("did-finish-load");
  const failed = renderer.read();
  expect(failed).toMatchObject({ state: "failed", page: "remote", reason: "-102 ERR_CONNECTION_REFUSED" });
  expect(JSON.stringify(failed)).not.toContain("couch.lan");
  renderer.navigate();
  renderer.contents.emit("did-finish-load");
  expect(renderer.read()).toMatchObject({ state: "ready" });
  expect(renderer.read().reason).toBeUndefined();
});

test("another Couch that Main can't reach is a remote failure, not a local one", () => {
  using renderer = fixture("remote");
  renderer.status.unreachable();
  expect(renderer.read()).toMatchObject({ state: "failed", page: "remote", reason: "unreachable" });
  renderer.navigate();
  renderer.contents.emit("did-finish-load");
  expect(renderer.read().state).toBe("ready");
});

test("a hung page recovers its state and a crashed one reports why", () => {
  using renderer = fixture();
  renderer.navigate();
  renderer.contents.emit("did-finish-load");
  renderer.contents.emit("unresponsive");
  renderer.contents.emit("unresponsive");
  expect(renderer.read().state).toBe("unresponsive");
  renderer.contents.emit("responsive");
  expect(renderer.read().state).toBe("ready");
  renderer.contents.emit("render-process-gone", {}, { reason: "oom", exitCode: 9 });
  expect(renderer.read()).toMatchObject({ state: "gone", reason: "oom" });
});
