import { expect, test } from "bun:test";
import { validateSource } from "./preview-receipt-source";
import type { Manifest } from "./hosted-release";

const revision = "a".repeat(40);
const manifest = { format: "dmg", revision, buildRun: { id: 42, attempt: 2 } } as Manifest;
const source = { path: ".github/workflows/package-desktop.yml", event: "workflow_dispatch", head_branch: "main", head_sha: revision, conclusion: "success" };

test("native receipt provenance requires the original successful main run", () => {
  expect(() => validateSource("dmg", manifest, source, 42, 2, revision)).not.toThrow();
  for (const changed of [
    { ...source, path: ".github/workflows/package.yml" },
    { ...source, head_branch: "feature" },
    { ...source, conclusion: "failure" },
    { ...source, head_sha: "b".repeat(40) },
  ]) expect(() => validateSource("dmg", manifest, changed, 42, 2, revision)).toThrow();
  expect(() => validateSource("dmg", manifest, source, 43, 1, revision)).toThrow();
  expect(() => validateSource("dmg", manifest, source, 43, 1, revision, source)).not.toThrow();
  expect(() => validateSource("dmg", manifest, source, 43, 1, revision, { ...source, head_sha: "b".repeat(40) })).toThrow();
  expect(() => validateSource("nsis", manifest, source, 42, 2, revision)).toThrow();
});
