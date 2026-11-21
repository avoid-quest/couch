import { afterEach, expect, mock, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const directory = mkdtempSync(join(tmpdir(), "couch-ts-repack-test-"));
const pidFile = join(directory, "ffmpeg.pid");
// An FFmpeg that never lists a segment, as when a channel doesn't answer.
const ffmpeg = join(directory, "ffmpeg");
writeFileSync(
  ffmpeg,
  `#!${process.execPath}\nrequire("node:fs").writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));\nsetInterval(() => {}, 1000);\n`,
  { mode: 0o755 },
);
mock.module("../src/server/helpers", () => ({
  useHelper: async () => ({ path: ffmpeg, release() {} }),
}));
const { createRepacks } = await import("../src/server/ts-repack");

const previousTemp = process.env.TMPDIR;
process.env.TMPDIR = directory;
afterEach(() => {
  if (existsSync(pidFile) && alive(Number(readFileSync(pidFile, "utf8"))))
    process.kill(Number(readFileSync(pidFile, "utf8")), "SIGKILL");
  if (previousTemp === undefined) delete process.env.TMPDIR;
  else process.env.TMPDIR = previousTemp;
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
  const repacks = createRepacks(() => true);
  const controller = new AbortController();
  const playlist = repacks.playlist("load", "http://127.0.0.1:9/channel.ts", controller.signal);
  playlist.catch(() => {});
  expect(await until(() => existsSync(pidFile))).toBe(true);
  const pid = Number(readFileSync(pidFile, "utf8"));
  controller.abort(new Error("Playback changed."));
  await expect(playlist).rejects.toThrow("Playback changed.");
  expect(await until(() => !alive(pid))).toBe(true);
  expect(
    await until(() => !readdirSync(directory).some((name) => name.startsWith("couch-ts-repack-"))),
  ).toBe(true);
  await repacks.close();
});
