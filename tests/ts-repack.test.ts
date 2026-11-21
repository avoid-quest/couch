import { afterEach, expect, mock, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runHelperScript } from "./helper-script.fixture";

const directory = mkdtempSync(join(tmpdir(), "couch-ts-repack-test-"));
const startedFile = join(directory, "started.json");
const childInfo = () =>
  JSON.parse(readFileSync(startedFile, "utf8")) as { pid: number; cwd: string };
// An FFmpeg that never lists a segment, as when a channel doesn't answer.
const ffmpeg = join(directory, "ffmpeg.cjs");
writeFileSync(
  ffmpeg,
  `const fs = require("node:fs");
const file = ${JSON.stringify(startedFile)};
fs.writeFileSync(file + ".tmp", JSON.stringify({ pid: process.pid, cwd: process.cwd() }));
fs.renameSync(file + ".tmp", file);
setInterval(() => {}, 1000);
`,
);
mock.module("../src/server/helpers", () => ({
  useHelper: async () => ({ path: ffmpeg, release() {} }),
}));
const { createRepacks } = await import("../src/server/ts-repack");

afterEach(() => {
  if (existsSync(startedFile)) {
    const { pid } = childInfo();
    if (alive(pid)) process.kill(pid, "SIGKILL");
  }
  rmSync(directory, { recursive: true, force: true });
});

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
const until = async (predicate: () => boolean) => {
  for (let tries = 0; tries < 300 && !predicate(); tries++) await Bun.sleep(10);
  return predicate();
};

test("a load that stops waiting for its playlist stops FFmpeg and removes its folder", async () => {
  using _script = runHelperScript(ffmpeg);
  const repacks = createRepacks(() => true);
  const controller = new AbortController();
  const playlist = repacks.playlist("load", "http://127.0.0.1:9/channel.ts", controller.signal);
  playlist.catch(() => {});
  expect(await until(() => existsSync(startedFile))).toBe(true);
  const { pid, cwd } = childInfo();
  expect(existsSync(cwd)).toBe(true);
  controller.abort(new Error("Playback changed."));
  await expect(playlist).rejects.toThrow("Playback changed.");
  expect(await until(() => !alive(pid))).toBe(true);
  expect(await until(() => !existsSync(cwd))).toBe(true);
  await repacks.close();
});
