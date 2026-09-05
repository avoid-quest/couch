import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installMediaTools, mediaReleases, mediaToolsDirectory } from "../scripts/setup-media";

const temporary: string[] = [];
afterEach(async () => { for (const directory of temporary.splice(0)) await rm(directory, { recursive: true, force: true }); });

async function existingTools() {
  const directory = await mkdtemp(join(tmpdir(), "couch-media-test-"));
  temporary.push(directory);
  await Bun.write(join(directory, "yt-dlp"), "working yt-dlp");
  await Bun.write(join(directory, "deno"), "working deno");
  return directory;
}

// A ZIP containing one shell executable that reports the pinned Deno version.
const denoZip = Buffer.from("UEsDBBQAAAAAAGV3JV3bsxWvLwAAAC8AAAAEAAAAZGVubyMhL2Jpbi9zaApwcmludGYgJ2Rlbm8gMi45LjYgKHN0YWJsZSwgdGVzdClcbicKUEsBAhQDFAAAAAAAZXclXduzFa8vAAAALwAAAAQAAAAAAAAAAAAAAIABAAAAAGRlbm9QSwUGAAAAAAEAAQAyAAAAUQAAAAAA", "base64");

function releaseFiles() {
  const files = new Map<string, string | Uint8Array>();
  for (const release of mediaReleases()) {
    const body = release.name === "deno" ? denoZip : Buffer.from("#!/bin/sh\nprintf '2026.08.19\\n'\n");
    files.set(`${release.base}/${release.file}`, body);
    files.set(`${release.base}/${release.sums}`, `${new Bun.CryptoHasher("sha256").update(body).digest("hex")}  ${release.file}\n`);
  }
  return files;
}

function fetchFiles(files: Map<string, string | Uint8Array>) {
  return async (url: string, options: RequestInit) => {
    expect(options.signal).toBeInstanceOf(AbortSignal);
    const body = files.get(url);
    return new Response(body, { status: body === undefined ? 404 : 200 });
  };
}

async function expectUnchanged(directory: string) {
  expect(await Bun.file(join(directory, "yt-dlp")).text()).toBe("working yt-dlp");
  expect(await Bun.file(join(directory, "deno")).text()).toBe("working deno");
  expect((await readdir(directory)).sort()).toEqual(["deno", "yt-dlp"]);
}

test("installs verified executable releases and removes staging files", async () => {
  const directory = await existingTools();
  await installMediaTools(directory, fetchFiles(releaseFiles()));
  expect(await Bun.file(join(directory, "yt-dlp")).text()).toContain("2026.08.19");
  expect(await Bun.file(join(directory, "deno")).text()).toContain("deno 2.9.6");
  for (const name of ["deno", "yt-dlp"]) expect((await stat(join(directory, name))).mode & 0o777).toBe(0o755);
  expect((await readdir(directory)).sort()).toEqual(["deno", "yt-dlp"]);
});

test("a bad second download preserves both installed tools", async () => {
  const directory = await existingTools();
  const files = releaseFiles();
  const deno = mediaReleases()[1]!;
  files.set(`${deno.base}/${deno.file}`, "corrupt download");
  await expect(installMediaTools(directory, fetchFiles(files))).rejects.toThrow("SHA-256 checksum mismatch");
  await expectUnchanged(directory);
});

test("requires a checksum for the exact release filename", async () => {
  const directory = await existingTools();
  const files = releaseFiles();
  const ytDlp = mediaReleases()[0]!;
  files.set(`${ytDlp.base}/${ytDlp.sums}`, `${"a".repeat(64)}  ${ytDlp.file}.zip\n`);
  await expect(installMediaTools(directory, fetchFiles(files))).rejects.toThrow("Missing or ambiguous SHA-256");
  await expectUnchanged(directory);
});

test("archive extraction failures preserve both installed tools", async () => {
  const directory = await existingTools();
  const files = releaseFiles();
  const deno = mediaReleases()[1]!;
  const body = "invalid ZIP";
  files.set(`${deno.base}/${deno.file}`, body);
  files.set(`${deno.base}/${deno.sums}`, `${new Bun.CryptoHasher("sha256").update(body).digest("hex")}  ${deno.file}\n`);
  await expect(installMediaTools(directory, fetchFiles(files))).rejects.toThrow("failed");
  await expectUnchanged(directory);
});

test("rejects a verified binary that cannot report the pinned version", async () => {
  const directory = await existingTools();
  const files = releaseFiles();
  const ytDlp = mediaReleases()[0]!;
  const body = "#!/bin/sh\nprintf '2025.01.01\\n'\n";
  files.set(`${ytDlp.base}/${ytDlp.file}`, body);
  files.set(`${ytDlp.base}/${ytDlp.sums}`, `${new Bun.CryptoHasher("sha256").update(body).digest("hex")}  ${ytDlp.file}\n`);
  await expect(installMediaTools(directory, fetchFiles(files))).rejects.toThrow("Unexpected yt-dlp version");
  await expectUnchanged(directory);
});

test("failed HTTP requests clean staging without replacing tools", async () => {
  const directory = await existingTools();
  await expect(installMediaTools(directory, fetchFiles(new Map()))).rejects.toThrow("Download failed (404)");
  await expectUnchanged(directory);
});

test("oversized checksum responses fail before installing tools", async () => {
  const directory = await existingTools();
  const files = releaseFiles();
  const ytDlp = mediaReleases()[0]!;
  files.set(`${ytDlp.base}/${ytDlp.sums}`, " ".repeat(65 * 1024));
  await expect(installMediaTools(directory, fetchFiles(files))).rejects.toThrow("Download exceeds");
  await expectUnchanged(directory);
});

test("selects standalone releases on all supported desktop architectures", () => {
  expect(mediaReleases("linux", "x64").map(release => release.file)).toEqual(["yt-dlp_linux", "deno-x86_64-unknown-linux-gnu.zip"]);
  expect(mediaReleases("linux", "arm64").map(release => release.file)).toEqual(["yt-dlp_linux_aarch64", "deno-aarch64-unknown-linux-gnu.zip"]);
  expect(mediaReleases("darwin", "x64").map(release => release.file)).toEqual(["yt-dlp_macos", "deno-x86_64-apple-darwin.zip"]);
  expect(mediaReleases("darwin", "arm64").map(release => release.file)).toEqual(["yt-dlp_macos", "deno-aarch64-apple-darwin.zip"]);
  expect(() => mediaReleases("linux", "arm")).toThrow("supports Linux and macOS on x64 or arm64");
});

test("uses Tauri app data paths and ignores relative XDG_DATA_HOME", () => {
  expect(mediaToolsDirectory("linux", "/home/test", "/data")).toBe("/data/quest.avoid.couch/tools");
  expect(mediaToolsDirectory("linux", "/home/test", "relative")).toBe("/home/test/.local/share/quest.avoid.couch/tools");
  expect(mediaToolsDirectory("darwin", "/Users/test", "/ignored")).toBe("/Users/test/Library/Application Support/quest.avoid.couch/tools");
});
