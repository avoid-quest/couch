import { afterEach, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runYtDlp } from "./yt-dlp";

const directories: string[] = [];
const originalExecutable = process.env.COUCH_YT_DLP;
const originalDeno = process.env.COUCH_DENO;

async function fixture(body: string) {
  const directory = mkdtempSync(join(tmpdir(), "couch-yt-dlp-"));
  directories.push(directory);
  const executable = join(directory, "yt-dlp");
  await Bun.write(executable, `#!${process.execPath}\n${body}\n`);
  chmodSync(executable, 0o755);
  return { directory, executable };
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
  if (originalExecutable === undefined) delete process.env.COUCH_YT_DLP;
  else process.env.COUCH_YT_DLP = originalExecutable;
  if (originalDeno === undefined) delete process.env.COUCH_DENO;
  else process.env.COUCH_DENO = originalDeno;
});

test("honors bundled executable and Deno paths without imposing resolver playlist or format flags", async () => {
  const { executable } = await fixture("console.log(JSON.stringify(process.argv.slice(2)));");
  process.env.COUCH_YT_DLP = executable;
  process.env.COUCH_DENO = "/Application Support/Couch/deno";
  const options = ["--flat-playlist", "--playlist-items", "1:20", "--dump-single-json", "--", "ytsearch20:$(touch private) --exec"];
  const args = JSON.parse(await runYtDlp(options)) as string[];
  expect(args.slice(-options.length)).toEqual(options);
  for (const flag of ["--ignore-config", "--no-config-locations", "--no-plugin-dirs", "--no-remote-components", "--no-cache-dir", "--skip-download"]) expect(args).toContain(flag);
  expect(args).not.toContain("--no-playlist");
  expect(args).not.toContain("--format");
  expect(args[args.indexOf("--js-runtimes") + 1]).toBe("deno:/Application Support/Couch/deno");
  process.env.COUCH_YT_DLP = "/missing-couch-test/yt-dlp";
  await expect(runYtDlp([], { executable })).resolves.toContain("--ignore-config");
});

test("cancels a catalog extractor, reaps its process, and does not start for an aborted signal", async () => {
  const { directory, executable } = await fixture("await Bun.write(import.meta.dir + '/pid', String(process.pid)); await Bun.sleep(60_000);");
  const controller = new AbortController();
  const pending = runYtDlp(["--flat-playlist", "--", "ytsearch20:example"], { executable, signal: controller.signal, timeoutMs: 2_000 });
  const started = join(directory, "pid");
  const limit = Date.now() + 1_500;
  try {
    while (!existsSync(started)) { if (Date.now() > limit) throw new Error("Extractor did not start"); await Bun.sleep(10); }
  } catch (error) { controller.abort(); await pending.catch(() => {}); throw error; }
  const pid = Number(await Bun.file(started).text());
  controller.abort();
  await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  expect(() => process.kill(pid, 0)).toThrow();
  rmSync(started);
  await expect(runYtDlp([], { executable, signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
  expect(existsSync(started)).toBeFalse();
});

test("limits active and waiting extractors and cancels queued work without spawning", async () => {
  const { directory, executable } = await fixture("await Bun.write(import.meta.dir + '/started-' + process.argv.at(-1), String(process.pid)); await Bun.sleep(60_000);");
  const controllers = Array.from({ length: 19 }, () => new AbortController());
  const pending = controllers.map((controller, index) => {
    const result = runYtDlp(["--", String(index)], { executable, signal: controller.signal, timeoutMs: 5_000 });
    void result.catch(() => {});
    return result;
  });
  try {
    await expect(runYtDlp(["--", "overflow"], { executable })).rejects.toThrow("Too many website requests");
    const limit = Date.now() + 1_500;
    while (![0, 1, 2].every(index => existsSync(join(directory, `started-${index}`)))) {
      if (Date.now() > limit) throw new Error("Extractors did not start");
      await Bun.sleep(10);
    }
    for (let index = 3; index < 19; index++) expect(existsSync(join(directory, `started-${index}`))).toBeFalse();
    controllers[3]!.abort();
    await expect(pending[3]!).rejects.toMatchObject({ name: "AbortError" });
    await expect(runYtDlp(["--", "queued-timeout"], { executable, timeoutMs: 30 })).rejects.toThrow("too long");
    expect(existsSync(join(directory, "started-queued-timeout"))).toBeFalse();
    controllers[0]!.abort();
    await expect(pending[0]!).rejects.toMatchObject({ name: "AbortError" });
    const promoted = join(directory, "started-4");
    const promotedLimit = Date.now() + 1_500;
    while (!existsSync(promoted)) { if (Date.now() > promotedLimit) throw new Error("Queued extractor did not start"); await Bun.sleep(10); }
    expect(existsSync(join(directory, "started-3"))).toBeFalse();
    expect(existsSync(join(directory, "started-5"))).toBeFalse();
    expect(existsSync(join(directory, "started-overflow"))).toBeFalse();
  } finally {
    for (const controller of controllers) controller.abort();
    await Promise.allSettled(pending);
  }
  const available = await fixture("console.log('available');");
  await expect(runYtDlp([], { executable: available.executable })).resolves.toBe("available\n");
});
