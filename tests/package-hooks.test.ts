import { expect, test } from "bun:test";
import { createRequire } from "node:module";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { build } from "../package.json";
import { buildLiveAudio } from "../scripts/build-live-audio";

// electron-builder loads afterPack with Node, whose loader, unlike Bun's, needs each import's extension.
test("Node loads the afterPack hook as electron-builder does", () => {
  const builder = dirname(createRequire(Bun.resolveSync("electron-builder/package.json", import.meta.dir)).resolve("app-builder-lib/package.json"));
  const script = `require(${JSON.stringify(join(builder, "helpers/dynamic-import.js"))}).dynamicImportMaybe(${JSON.stringify(resolve(build.afterPack))}).then(hook => process.exit(typeof (hook.default ?? hook) === "function" ? 0 : 2))`;
  const result = Bun.spawnSync(["node", "-e", script], { stderr: "pipe" });
  expect(result.stderr.toString()).toBe("");
  expect(result.exitCode).toBe(0);
});

test("native capture packaging is a no-op outside macOS, including with a foreign target architecture", async () => {
  const directory = await mkdtemp(join(tmpdir(), "couch-capture-package-"));
  try {
    for (const platform of ["linux", "win32"]) {
      await buildLiveAudio(platform, "x64", join(directory, platform));
      await expect(readFile(join(directory, platform, "couch-capture"))).rejects.toMatchObject({ code: "ENOENT" });
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});

// Contract with the builder/updater: a single Mac build must keep both
// DMGs and both updater ZIPs in one feed, on production and preview alike.
test("Mac update metadata merges architectures and the updater selects the matching zip", async () => {
  const require = createRequire(Bun.resolveSync("electron-builder/package.json", import.meta.dir));
  const builder = dirname(require.resolve("app-builder-lib/package.json"));
  const { writeUpdateInfoFiles } = require(join(builder, "out/publish/updateInfoBuilder.js"));
  const { load } = createRequire(join(builder, "package.json"))("js-yaml");
  const { MacUpdater } = await import("electron-updater/out/MacUpdater.js");
  const { findFile } = await import("electron-updater/out/providers/Provider.js");
  const directory = await mkdtemp(join(tmpdir(), "couch-mac-feed-"));
  try {
    for (const [channel, version] of [["latest", "1.0.0"], ["preview", "1.1.0-preview.1"]]) {
      const file = join(directory, `${channel}-mac.yml`);
      const expected = ["x64", "arm64"].flatMap(arch => ["dmg", "zip"].map(ext => `Couch-${version}-${arch}.${ext}`));
      const tasks = expected.map((url, index) => ({
        file, arch: index < 2 ? 1 : 3,
        publishConfiguration: { provider: "github", owner: "avoid-quest", repo: "couch", channel },
        info: { version, files: [{ url, sha512: `hash-${index}`, size: index + 100 }], path: url, sha512: `hash-${index}` },
      }));
      const emitted: string[] = [];
      await writeUpdateInfoFiles(tasks, { emitArtifactCreated: async (event: { file: string }) => { emitted.push(event.file); } });
      const info = load(await readFile(file, "utf8"));
      expect(emitted).toEqual([file]);
      expect(info.version).toBe(version);
      expect(info.files.map((entry: { url: string }) => entry.url).sort()).toEqual(expected.toSorted());
      for (const [index, url] of expected.entries()) expect(info.files.find((entry: { url: string }) => entry.url === url)).toEqual({ url, sha512: `hash-${index}`, size: index + 100 });
      const files = info.files.map((entry: { url: string; sha512: string }) => ({ url: new URL(entry.url, "https://example.com/"), info: entry }));
      for (const [arm, arch] of [[false, "x64"], [true, "arm64"]] as const) {
        const selected = findFile(MacUpdater.filterFilesForArch(files, arm), "zip", ["pkg", "dmg"]);
        expect(selected?.url.pathname).toBe(`/Couch-${version}-${arch}.zip`);
      }
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
