import { expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rendererStatus } from "../app/renderer-status";

// Electron's webContents emits these with the same positional arguments.
function fixture(page: "local" | "remote" = "local") {
  const directory = mkdtempSync(join(tmpdir(), "couch-renderer-"));
  const path = join(directory, "renderer-status.json"),
    contents = new EventEmitter();
  const status = rendererStatus(
    path,
    { run: `run-${directory.slice(-6)}`, version: "9.9.9" },
    () => page,
  );
  status.watch(contents);
  return {
    contents,
    status,
    read: () => JSON.parse(readFileSync(path, "utf8")),
    navigate: (mainFrame = true, inPlace = false) =>
      contents.emit("did-start-navigation", {}, "http://localhost:4100/", inPlace, mainFrame),
    commit: () => contents.emit("did-navigate", {}, "http://localhost:4100/", 200, "OK"),
    loaded: () => contents.emit("did-finish-load"),
    [Symbol.dispose]: () => rmSync(directory, { recursive: true, force: true }),
  };
}

test("a failed page stays failed through Chromium's error page until the next navigation", () => {
  using renderer = fixture("remote");
  renderer.navigate();
  renderer.contents.emit("did-fail-load", {}, -3, "ERR_ABORTED", "https://couch.lan/", true);
  renderer.contents.emit(
    "did-fail-load",
    {},
    -105,
    "ERR_NAME_NOT_RESOLVED",
    "https://couch.lan/",
    false,
  );
  expect(renderer.read().state).toBe("loading");
  renderer.contents.emit(
    "did-fail-load",
    {},
    -102,
    "ERR_CONNECTION_REFUSED",
    "https://couch.lan/?token=secret",
    true,
  );
  renderer.loaded();
  expect(renderer.status.acknowledge()).toBe(false);
  const failed = renderer.read();
  expect(failed).toMatchObject({
    state: "failed",
    page: "remote",
    reason: "-102 ERR_CONNECTION_REFUSED",
  });
  expect(JSON.stringify(failed)).not.toContain("couch.lan");
  renderer.navigate();
  renderer.commit();
  renderer.loaded();
  renderer.status.acknowledge();
  expect(renderer.read()).toMatchObject({ state: "ready" });
  expect(renderer.read().reason).toBeUndefined();
});
