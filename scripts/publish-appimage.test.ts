import { afterAll, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { publish } from "./publish-appimage";

const directory = await mkdtemp(join(tmpdir(), "couch-tauri-publisher-"));
const key = join(directory, "test.key"), feed = join(directory, "feed");
const generated = Bun.spawnSync([join(import.meta.dir, "../node_modules/.bin/tauri"), "signer", "generate", "--ci", "-p", "", "-w", key]);
if (generated.exitCode) throw new Error("Could not create disposable Tauri signer");
const previousKey = process.env.TAURI_SIGNING_PRIVATE_KEY_PATH, previousPassword = process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD;
process.env.TAURI_SIGNING_PRIVATE_KEY_PATH = key;
process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD = "";
afterAll(async () => {
  if (previousKey === undefined) delete process.env.TAURI_SIGNING_PRIVATE_KEY_PATH; else process.env.TAURI_SIGNING_PRIVATE_KEY_PATH = previousKey;
  if (previousPassword === undefined) delete process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD; else process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD = previousPassword;
  await rm(directory, { recursive: true, force: true });
});
async function fixture(run: number) {
  const artifact = join(directory, `artifact-${run}`);
  await mkdir(join(artifact, "appimage-qualification", "fixture"), { recursive: true });
  const build = { version: `0.1.0+build.${run}.1`, revision: "a".repeat(40), packaged: true, dirty: false, target: "x86_64-unknown-linux-gnu", dataFormat: 1 };
  const data = `fixture AppImage ${run}`;
  await Bun.write(join(artifact, "Couch.AppImage"), data);
  await Bun.write(join(artifact, "build-info.json"), JSON.stringify(build));
  await Bun.write(join(artifact, "couch-source.tar.gz"), "private source fixture");
  await Bun.write(join(artifact, "appimage-qualification/fixture/result.json"), JSON.stringify({ build, packageSha256: new Bun.CryptoHasher("sha256").update(data).digest("hex"), format: "AppImage", checks: ["fixture"] }));
  return artifact;
}
const release = (artifact: string, channel: "stable" | "preview" = "preview") => publish(artifact, feed, "http://localhost:8765/tauri/", channel, "Qualified fixture");

test("official signing, promotion and renewal preserve bytes; rollback and tampering fail", async () => {
  const first = await fixture(9), second = await fixture(10);
  const metadata = await release(first);
  expect(metadata.version).toBe("0.1.0+build.9.1");
  const signature = await Bun.file(join(feed, "releases/9.1/Couch.AppImage.sig")).text();
  expect(metadata.platforms["linux-x86_64"].signature).toBe(signature.trim());
  await release(first, "stable");
  expect(await Bun.file(join(feed, "releases/9.1/Couch.AppImage.sig")).text()).toBe(signature);
  expect((await Bun.file(join(feed, "stable.json.sig")).text()).length).toBeGreaterThan(50);
  expect(await Bun.file(join(feed, "couch-source.tar.gz")).exists()).toBe(false);
  await release(second);
  const before = await Bun.file(join(feed, "preview.json")).text();
  await expect(release(first)).rejects.toThrow("backwards");
  await Bun.write(join(second, "Couch.AppImage"), "tampered");
  await expect(release(second)).rejects.toThrow();
  expect(await Bun.file(join(feed, "preview.json")).text()).toBe(before);
  const evidence = Bun.file(join(second, "appimage-qualification/fixture/result.json"));
  const forged = await evidence.json();
  forged.packageSha256 = new Bun.CryptoHasher("sha256").update("tampered").digest("hex");
  await Bun.write(evidence, JSON.stringify(forged));
  await expect(release(second)).rejects.toThrow("Release bytes cannot change");
  expect(await Bun.file(join(feed, "releases/10.1/Couch.AppImage")).text()).toBe("fixture AppImage 10");
}, 30_000);
