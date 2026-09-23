import { strict as assert } from "node:assert";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { verifyReceipt, type Manifest } from "./hosted-release";

type Format = "deb" | "appimage" | "dmg" | "nsis";
const workflows: Record<Format, string> = {
  deb: ".github/workflows/package.yml",
  appimage: ".github/workflows/package.yml",
  dmg: ".github/workflows/package-desktop.yml",
  nsis: ".github/workflows/package-desktop.yml",
};

function gh(args: string[]) {
  assert.ok(process.env.GH_TOKEN && process.env.GITHUB_REPOSITORY, "Use the Actions token and repository.");
  const result = Bun.spawnSync(["gh", ...args, ...(args[0] === "api" ? [] : ["--repo", process.env.GITHUB_REPOSITORY])], { stderr: "inherit", maxBuffer: 16 * 1024 * 1024 });
  assert.equal(result.exitCode, 0, `Could not read the source run: ${args[0]}`);
  return result.stdout.toString();
}

function validateRun(format: Format, source: Record<string, unknown>, revision: string) {
  assert.equal(source.path, workflows[format], "The source run used another workflow.");
  assert.equal(source.event, "workflow_dispatch");
  assert.equal(source.head_branch, "main");
  assert.equal(source.head_sha, revision);
}

export function validateSource(format: Format, manifest: Manifest, source: Record<string, unknown>, runId: number, attempt: number, revision: string, original?: Record<string, unknown>) {
  assert.equal(manifest.format, format, "The source receipt has another format.");
  assert.equal(manifest.revision, revision, "The source run used another revision.");
  assert.ok(manifest.buildRun, "The signed receipt must name its original build run.");
  validateRun(format, source, revision);
  assert.equal(source.conclusion, "success", "The source build did not complete successfully.");
  if (manifest.buildRun.id !== runId || manifest.buildRun.attempt !== attempt) {
    assert.ok(original, "Check the original build run named by the signed manifest.");
    validateRun(format, original, revision);
  }
}

export async function checkSource(format: Format, directory: string, runId: number, attempt: number, revision: string) {
  const manifest = await verifyReceipt(directory);
  const source = JSON.parse(gh(["api", `repos/${process.env.GITHUB_REPOSITORY}/actions/runs/${runId}/attempts/${attempt}`]));
  const original = manifest.buildRun && (manifest.buildRun.id !== runId || manifest.buildRun.attempt !== attempt)
    ? JSON.parse(gh(["api", `repos/${process.env.GITHUB_REPOSITORY}/actions/runs/${manifest.buildRun.id}/attempts/${manifest.buildRun.attempt}`]))
    : undefined;
  validateSource(format, manifest, source, runId, attempt, revision, original);
  return manifest;
}

if (import.meta.main) {
  const [formatInput, directory, runInput, attemptInput] = process.argv.slice(2);
  assert.ok(formatInput in workflows && directory, "Use <format> <receipt-directory> <run-id> <attempt>.");
  const format = formatInput as Format;
  const runId = Number(runInput), attempt = Number(attemptInput);
  assert.ok(Number.isSafeInteger(runId) && runId > 0 && Number.isSafeInteger(attempt) && attempt > 0);
  const name = `release-receipts-${runId}.${attempt}`;
  const downloaded = Bun.spawnSync(["gh", "run", "download", String(runId), "--name", name, "--dir", directory, "--repo", process.env.GITHUB_REPOSITORY!], { stderr: "inherit" });
  if (downloaded.exitCode !== 0) {
    await rm(directory, { recursive: true, force: true });
    await mkdir(directory, { recursive: true });
    const log = gh(["run", "view", String(runId), "--attempt", String(attempt), "--log"]);
    const logPath = join(directory, "source-run.log");
    await Bun.write(logPath, log);
    const restored = Bun.spawnSync([process.execPath, "scripts/hosted-receipts.ts", "restore", logPath, directory], { stderr: "inherit" });
    assert.equal(restored.exitCode, 0, "No valid artifact or log receipts were retained.");
    await rm(logPath);
  }
  const revision = Bun.spawnSync(["git", "rev-parse", "HEAD"]).stdout.toString().trim();
  await checkSource(format, directory, runId, attempt, revision);
  console.log(`Verified ${format} receipt from ${runId}.${attempt} at ${revision}.`);
}
