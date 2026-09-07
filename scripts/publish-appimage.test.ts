import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const directory = mkdtempSync(join(tmpdir(), "couch-appimage-publisher-"));
const key = join(directory, "test.key");
const cli = join(import.meta.dir, "../node_modules/.bin/tauri");
const generated = Bun.spawnSync([cli, "signer", "generate", "--ci", "-p", "", "-w", key]);
if (generated.exitCode) throw new Error("Cannot generate the disposable Tauri test signer");
const feed = join(directory, "feed");
const env = { ...process.env, TAURI_SIGNING_PRIVATE_KEY_PATH: key, TAURI_SIGNING_PRIVATE_KEY_PASSWORD: "" };
function fixture(run: number) {
  const artifact = join(directory, `artifact-${run}`);
  mkdirSync(artifact);
  const build = { version: `0.1.0+build.${run}.1`, revision: "a".repeat(40), packaged: true, dirty: false, target: "x86_64-unknown-linux-gnu", dataFormat: 1 };
  const archive = new TextEncoder().encode(`fixture AppImage ${run}`);
  writeFileSync(join(artifact, "Couch.AppImage"), archive);
  writeFileSync(join(artifact, "build-info.json"), JSON.stringify(build));
  writeFileSync(join(artifact, "couch-source.tar.gz"), "private source fixture");
  const evidence = join(artifact, "result.json");
  writeFileSync(evidence, JSON.stringify({ build, packageSha256: new Bun.CryptoHasher("sha256").update(archive).digest("hex"), format: "AppImage", checks: ["fixture"] }));
  return { artifact, evidence };
}
function publish(input: ReturnType<typeof fixture>, channel = "preview") {
  return Bun.spawnSync(["python3", "-c", "import runpy,sys; from pathlib import Path; m=runpy.run_path(sys.argv[1]); m['publish'](Path(sys.argv[2]),Path(sys.argv[3]),Path(sys.argv[4]),sys.argv[5],sys.argv[6],'Qualified fixture')", join(import.meta.dir, "publish-appimage.py"), input.artifact, input.evidence, feed, "http://localhost:8765/tauri/", channel], { env });
}
afterAll(() => rmSync(directory, { recursive: true, force: true }));

test("publication preserves signed bytes, promotes them and rejects tampering or rollback", () => {
  const first = fixture(9), second = fixture(10);
  let result = publish(first);
  expect(result.stderr.toString()).toBe("");
  expect(result.exitCode).toBe(0);
  const manifest = JSON.parse(readFileSync(join(feed, "preview.json"), "utf8"));
  expect(manifest.version).toBe("0.1.0+build.9.1");
  expect(manifest.platforms["linux-x86_64"].signature).toBe(readFileSync(join(feed, "releases/9.1/Couch.AppImage.sig"), "utf8").trim());
  const signature = readFileSync(join(feed, "releases/9.1/Couch.AppImage.sig"), "utf8");
  expect(publish(first, "stable").exitCode).toBe(0);
  expect(readFileSync(join(feed, "releases/9.1/Couch.AppImage.sig"), "utf8")).toBe(signature);
  expect(readFileSync(join(feed, "stable.json.sig"), "utf8").length).toBeGreaterThan(50);
  expect(publish(second).exitCode).toBe(0);
  const before = readFileSync(join(feed, "preview.json"), "utf8");
  expect(publish(first).exitCode).not.toBe(0);
  expect(readFileSync(join(feed, "preview.json"), "utf8")).toBe(before);
  writeFileSync(join(second.artifact, "Couch.AppImage"), "tampered");
  expect(publish(second).exitCode).not.toBe(0);
  expect(readFileSync(join(feed, "preview.json"), "utf8")).toBe(before);
  // Matching forged local evidence still cannot overwrite an existing release identity.
  const forged = JSON.parse(readFileSync(second.evidence, "utf8"));
  forged.packageSha256 = new Bun.CryptoHasher("sha256").update("tampered").digest("hex");
  writeFileSync(second.evidence, JSON.stringify(forged));
  expect(publish(second).exitCode).not.toBe(0);
  expect(readFileSync(join(feed, "releases/10.1/Couch.AppImage"), "utf8")).toBe("fixture AppImage 10");
}, 30_000);
