import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { releaseNotes } from "./release-notes";
import { syncVersions } from "./sync-versions";

const changelog = `# couch

## 0.1.6-preview.3

### Patch Changes

- Fixed the thing [#340](https://github.com/avoid-quest/couch/pull/340) [\`@someone\`](https://github.com/someone)!

## 0.1.6-preview.2

### Patch Changes

- Earlier work [#339](https://github.com/avoid-quest/couch/pull/339)`;

describe("release notes", () => {
  test("extracts the current version section from the changelog", () => {
    expect(releaseNotes("0.1.6-preview.3", changelog)).toContain("Fixed the thing [#340]");
    expect(releaseNotes("0.1.6-preview.3", changelog)).not.toContain("Earlier work");
    expect(releaseNotes("0.1.6-preview.2", changelog)).toContain("Earlier work");
  });
  test("falls back when the changelog or the section is missing", () => {
    expect(releaseNotes("0.1.6", null)).toBe("Release 0.1.6");
    expect(releaseNotes("0.1.6", changelog)).toBe("Release 0.1.6");
  });
  test("rejects non-release versions", () => {
    expect(() => releaseNotes("0.1.6+build.1.1", changelog)).toThrow();
  });
});

describe("version sync", () => {
  test("mirrors the package.json version into Tauri, Cargo.toml and Cargo.lock", async () => {
    const directory = await mkdtemp(join(tmpdir(), "couch-sync-versions-"));
    try {
      await Bun.write(join(directory, "package.json"), JSON.stringify({ name: "couch", version: "0.1.6-preview.0" }));
      await Bun.write(join(directory, "tauri.conf.json"), JSON.stringify({ version: "0.1.5-preview.2", identifier: "quest.avoid.couch" }, null, 2));
      await Bun.write(join(directory, "Cargo.toml"), `[package]\nname = "couch"\nversion = "0.1.5-preview.2"\nedition = "2021"\n`);
      await Bun.write(join(directory, "Cargo.lock"), `[[package]]\nname = "other"\nversion = "9.9.9"\n\n[[package]]\nname = "couch"\nversion = "0.1.5-preview.2"\ndependencies = [\n "base64 0.22.1",\n]\n`);
      expect(await syncVersions({ packageJson: join(directory, "package.json"), tauriConf: join(directory, "tauri.conf.json"), cargoToml: join(directory, "Cargo.toml"), cargoLock: join(directory, "Cargo.lock") })).toBe("0.1.6-preview.0");
      expect(await Bun.file(join(directory, "tauri.conf.json")).json()).toMatchObject({ version: "0.1.6-preview.0" });
      const cargo = await Bun.file(join(directory, "Cargo.toml")).text();
      const lock = await Bun.file(join(directory, "Cargo.lock")).text();
      expect(cargo).toContain('version = "0.1.6-preview.0"');
      expect(lock).toContain('name = "couch"\nversion = "0.1.6-preview.0"');
      expect(lock).toContain('name = "other"\nversion = "9.9.9"');
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
  test("rejects inconsistent sources instead of guessing", async () => {
    const directory = await mkdtemp(join(tmpdir(), "couch-sync-mismatch-"));
    try {
      await Bun.write(join(directory, "package.json"), JSON.stringify({ name: "couch", version: "0.1.6" }));
      await Bun.write(join(directory, "tauriConf.json"), JSON.stringify({ version: "0.1.5" }));
      await Bun.write(join(directory, "Cargo.toml"), `[package]\nname = "couch"\nversion = "0.1.4"\n`);
      await Bun.write(join(directory, "Cargo.lock"), `[[package]]\nname = "couch"\nversion = "0.1.5"\n`);
      await expect(syncVersions({ packageJson: join(directory, "package.json"), tauriConf: join(directory, "tauriConf.json"), cargoToml: join(directory, "Cargo.toml"), cargoLock: join(directory, "Cargo.lock") })).rejects.toThrow("must match");
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});
