import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { seedConfiguredFixture, seedFirstUseLocalFixture } from "./configured-fixture";

const directories: string[] = [];
const directory = () => {
  const value = mkdtempSync(join(tmpdir(), "couch-fixture-"));
  directories.push(value);
  return value;
};

afterEach(() => directories.splice(0).forEach(value => rmSync(value, { recursive: true })));

test("first-use fixture leaves the device chooser unconfigured", () => {
  const fixture = directory();
  seedFirstUseLocalFixture(fixture);
  expect(existsSync(join(fixture, "couch.sqlite"))).toBe(true);
  expect(existsSync(join(fixture, "operating-mode.json"))).toBe(false);
});

test("configured fixture records the selected local player", async () => {
  const fixture = directory();
  seedConfiguredFixture(fixture);
  expect(await Bun.file(join(fixture, "operating-mode.json")).json()).toMatchObject({ mode: "local", localSetupComplete: true });
});
