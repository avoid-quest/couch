import { afterEach, expect, test } from "bun:test";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { macSound } from "./sound-mac";

const original = process.env.COUCH_MPV;
afterEach(() => { if (original === undefined) delete process.env.COUCH_MPV; else process.env.COUCH_MPV = original; });

test("Mac sound test uses the bundled mpv path supplied by the sidecar", async () => {
  const dir = await mkdtemp(join(tmpdir(), "couch-mac-mpv-"));
  try {
    const mpv = join(dir, "mpv");
    await writeFile(mpv, "#!/bin/sh\nexit 23\n");
    await chmod(mpv, 0o755);
    process.env.COUCH_MPV = mpv;
    const sound = macSound(async () => null);
    expect(sound.canTest).toBe(true);
    expect(await sound.test.start("unused-output").exited).toBe(23);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
