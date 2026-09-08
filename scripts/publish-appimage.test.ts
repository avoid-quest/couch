import { afterAll, expect, test } from "bun:test";
import { chmod, mkdtemp, mkdir, rm } from "node:fs/promises";
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
  expect(metadata.dataFormat).toBe(1);
  expect(Date.parse(metadata.pub_date) % 1000).toBe(0);
  expect(metadata.expiresAt - Date.parse(metadata.pub_date)).toBe(7 * 86400_000);
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

test("local publisher and installed-update CLIs need no GitHub download", async () => {
  const artifact = await fixture(34172088325), localFeed = join(directory, "local-feed");
  const bin = join(directory, "bin"), evidence = join(directory, "installed"), called = join(directory, "gh-called");
  await mkdir(bin);
  await Bun.write(join(bin, "gh"), `#!/bin/sh\ntouch '${called}'\nexit 97\n`);
  // Exercise real local feed/signing orchestration without starting the systemd Docker fixture.
  await Bun.write(join(bin, "bash"), `#!${process.execPath}
import { strict as assert } from "node:assert";
const [script, mode, appimage, evidence] = Bun.argv.slice(2);
assert.equal(script, "scripts/test-appliance-systemd.sh");
assert.equal(mode, "--appimage");
assert.ok(await Bun.file(appimage).exists());
const target = await Bun.file(process.env.COUCH_QUALIFY_UPDATE_RECEIPT).json();
const enrollment = await Bun.file(evidence + "/appimage-update.json").json();
const metadata = await (await fetch(enrollment.endpoint + "preview.json")).json();
assert.equal(metadata.version, target.version);
assert.equal(metadata.revision, target.revision);
assert.ok(enrollment.pubkey.length > 50 && metadata.platforms["linux-x86_64"].signature.length > 50);
const bytes = await (await fetch(metadata.platforms["linux-x86_64"].url)).arrayBuffer();
assert.equal(new Bun.CryptoHasher("sha256").update(bytes).digest("hex"), target.archiveSha256);
assert.equal(process.env.TAURI_SIGNING_PRIVATE_KEY_PATH, undefined);
await Bun.write(evidence + "/fixture-invoked", "local signed target accepted");
`);
  await Promise.all(["gh", "bash"].map(name => chmod(join(bin, name), 0o700)));
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}` };
  const execute = async (script: string, args: string[]) => {
    const child = Bun.spawn([process.execPath, join(import.meta.dir, script), ...args], { cwd: join(import.meta.dir, ".."), env, stdout: "pipe", stderr: "pipe" });
    const errors = await new Response(child.stderr).text();
    expect(await child.exited, errors).toBe(0);
  };
  const retained = await fixture(34172088324);
  await publish(retained, localFeed, "http://localhost:8765/tauri/", "preview", "Retained build");
  await execute("publish-appimage.ts", [artifact, localFeed, "http://localhost:8765/tauri/", "preview", "Local qualification"]);
  expect((await Bun.file(join(localFeed, "preview.json")).json()).releaseId).toBe("34172088325.1");
  await expect(publish(retained, localFeed, "http://localhost:8765/tauri/", "preview", "Older build")).rejects.toThrow("backwards");
  await execute("test-installed-update.ts", [join(artifact, "Couch.AppImage"), artifact, evidence]);
  expect(await Bun.file(join(evidence, "fixture-invoked")).text()).toBe("local signed target accepted");
  expect(await Bun.file(called).exists()).toBe(false);
  expect(await Bun.file(join(artifact, "Couch.AppImage")).text()).toBe("fixture AppImage 34172088325");
  const futureHosted = await fixture(34206078781);
  await publish(futureHosted, localFeed, "http://localhost:8765/tauri/", "preview", "Future hosted build");
  expect((await Bun.file(join(localFeed, "preview.json")).json()).releaseId).toBe("34206078781.1");
  // The retained artifact forms must still reach the verifier when Actions resumes.
  // The failing local gh stub proves dispatch without accessing GitHub.
  for (const [script, args] of [
    ["publish-appimage.ts", ["123", join(directory, "downloaded"), localFeed, "http://localhost:8765/tauri/", "preview", "Hosted qualification"]],
    ["test-installed-update.ts", [join(artifact, "Couch.AppImage"), "123", evidence]],
  ] as const) {
    const child = Bun.spawn([process.execPath, join(import.meta.dir, script), ...args], { cwd: join(import.meta.dir, ".."), env, stdout: "pipe", stderr: "pipe" });
    const errors = await new Response(child.stderr).text();
    expect(await child.exited).not.toBe(0);
    expect(errors).not.toContain("Usage:");
    expect(await Bun.file(called).exists()).toBe(true);
    await rm(called);
  }
}, 30_000);
